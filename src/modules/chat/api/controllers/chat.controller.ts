import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Session } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { RequirePermissions, PermissionsGuard } from '../../../../shared';
import {
  getActiveOrganizationId,
  getPlatformRole,
} from '../../../admin/users/utils/admin.utils';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ChatService } from '../../application/services/chat.service';

type CreateConversationBody = {
  title?: string | null;
  organizationId?: string;
  projectId?: string;
};

type SendMessageBody = {
  content?: string;
  organizationId?: string;
};

@Controller('api/chat')
@UseGuards(PermissionsGuard, ThrottlerGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  private writeSseEvent(response: Response, event: string, data: unknown) {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
    (response as Response & { flush?: () => void }).flush?.();
  }

  private requireTrimmedString(
    value: string | undefined,
    fieldName: string,
  ): string {
    const trimmedValue = value?.trim();

    if (!trimmedValue) {
      throw new HttpException(
        `${fieldName} is required`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return trimmedValue;
  }

  private getScope(session: UserSession, organizationId?: string) {
    const platformRole = getPlatformRole(session);
    const activeOrganizationId = getActiveOrganizationId(session);

    if (platformRole !== 'superadmin' && !activeOrganizationId) {
      throw new HttpException(
        'Active organization required',
        HttpStatus.FORBIDDEN,
      );
    }

    return {
      platformRole,
      activeOrganizationId,
      organizationId,
    };
  }

  @Get('conversations')
  @RequirePermissions('chat:read')
  async listConversations(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return {
      data: await this.chatService.listConversations({
        ...this.getScope(session, organizationId),
        userId: session.user.id,
        projectId: projectId?.trim() || undefined,
      }),
    };
  }

  @Post('conversations')
  @RequirePermissions('chat:create')
  async createConversation(
    @Session() session: UserSession,
    @Body() body: CreateConversationBody,
  ) {
    const projectId = body.projectId?.trim();
    if (!projectId) {
      throw new HttpException('projectId is required', HttpStatus.BAD_REQUEST);
    }

    return {
      data: await this.chatService.createConversation({
        ...this.getScope(session, body.organizationId),
        title: body.title ?? null,
        userId: session.user.id,
        projectId,
      }),
    };
  }

  @Get('conversations/:conversationId/messages')
  @RequirePermissions('chat:read')
  async listMessages(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return {
      data: await this.chatService.listMessages({
        ...this.getScope(session, organizationId),
        conversationId: this.requireTrimmedString(
          conversationId,
          'conversationId',
        ),
        userId: session.user.id,
      }),
    };
  }

  @Post('conversations/:conversationId/messages')
  @RequirePermissions('chat:stream')
  @Throttle({ chat: {} })
  async sendMessage(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() body: SendMessageBody,
  ) {
    return {
      data: await this.chatService.sendMessage({
        ...this.getScope(session, body.organizationId),
        conversationId: this.requireTrimmedString(
          conversationId,
          'conversationId',
        ),
        content: this.requireTrimmedString(body.content, 'content'),
        userId: session.user.id,
      }),
    };
  }

  @Post('conversations/:conversationId/messages/stream')
  @RequirePermissions('chat:stream')
  @Throttle({ chat: {} })
  async streamMessage(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() body: SendMessageBody,
    @Res() response: Response,
  ) {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    try {
      const scope = this.getScope(session, body.organizationId);
      const validatedConversationId = this.requireTrimmedString(
        conversationId,
        'conversationId',
      );
      const validatedContent = this.requireTrimmedString(
        body.content,
        'content',
      );

      const stream = this.chatService.sendMessageStreaming({
        ...scope,
        conversationId: validatedConversationId,
        content: validatedContent,
        userId: session.user.id,
      });

      let finalReply: {
        content: string;
        metadata: Record<string, unknown>;
      } | null = null;
      let startConversation: unknown = null;
      let startUserMessage: unknown = null;

      for await (const event of stream) {
        if (event.type === 'start') {
          startConversation = event.conversation;
          startUserMessage = event.userMessage;
          this.writeSseEvent(response, 'start', {
            conversation: event.conversation,
            userMessage: event.userMessage,
          });
          continue;
        }

        if (event.type === 'thinking') {
          this.writeSseEvent(response, 'thinking', {});
          continue;
        }

        if (event.type === 'searching') {
          this.writeSseEvent(response, 'searching', { query: event.query });
          continue;
        }

        if (event.type === 'chunk') {
          this.writeSseEvent(response, 'chunk', { content: event.content });
          continue;
        }

        if (event.type === 'done') {
          finalReply = event.reply;

          // Persist the assistant message to DB
          const assistantMessage =
            await this.chatService.persistAssistantMessage(
              validatedConversationId,
              session.user.id,
              scope.organizationId,
              finalReply,
            );

          // Refetch conversation for the complete event
          const updatedConversation =
            await this.chatService.getConversationForComplete(
              validatedConversationId,
              session.user.id,
              scope.organizationId,
            );

          this.writeSseEvent(response, 'complete', {
            conversation: updatedConversation ?? startConversation,
            userMessage: startUserMessage,
            assistantMessage,
          });
        }
      }
    } catch (error) {
      const statusCode =
        error instanceof HttpException
          ? error.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
      const message =
        error instanceof Error ? error.message : 'Failed to stream message';

      this.writeSseEvent(response, 'error', {
        statusCode,
        message,
      });
    } finally {
      response.end();
    }
  }

  @Delete('conversations/:conversationId')
  @RequirePermissions('chat:delete')
  async deleteConversation(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.chatService.deleteConversation({
      ...this.getScope(session, organizationId),
      conversationId: this.requireTrimmedString(
        conversationId,
        'conversationId',
      ),
      userId: session.user.id,
    });
  }
}
