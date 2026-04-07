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

  private chunkContent(content: string, chunkSize = 120): string[] {
    if (!content) {
      return [];
    }

    const chunks: string[] = [];
    for (let index = 0; index < content.length; index += chunkSize) {
      chunks.push(content.slice(index, index + chunkSize));
    }

    return chunks;
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
  @RequirePermissions('organization:read')
  async listConversations(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
  ) {
    return {
      data: await this.chatService.listConversations({
        ...this.getScope(session, organizationId),
        userId: session.user.id,
      }),
    };
  }

  @Post('conversations')
  @RequirePermissions('organization:read')
  async createConversation(
    @Session() session: UserSession,
    @Body() body: CreateConversationBody,
  ) {
    return {
      data: await this.chatService.createConversation({
        ...this.getScope(session, body.organizationId),
        title: body.title ?? null,
        userId: session.user.id,
      }),
    };
  }

  @Get('conversations/:conversationId/messages')
  @RequirePermissions('organization:read')
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
  @RequirePermissions('organization:read')
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
  @RequirePermissions('organization:read')
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
      const result = await this.chatService.sendMessage({
        ...this.getScope(session, body.organizationId),
        conversationId: this.requireTrimmedString(
          conversationId,
          'conversationId',
        ),
        content: this.requireTrimmedString(body.content, 'content'),
        userId: session.user.id,
      });

      this.writeSseEvent(response, 'start', {
        conversation: result.conversation,
        userMessage: result.userMessage,
      });

      for (const chunk of this.chunkContent(result.assistantMessage.content)) {
        this.writeSseEvent(response, 'chunk', { content: chunk });
      }

      this.writeSseEvent(response, 'complete', result);
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
  @RequirePermissions('organization:read')
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
