import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminOrganizationsService } from '../../../admin';
import { rowToConversationSummary, rowToMessage } from '../../api/dto/chat.dto';
import {
  CHAT_REPOSITORY,
  type IChatRepository,
} from '../../domain/repositories/chat.repository.interface';
import { ChatAgentService, type ChatStreamEvent } from './chat-agent.service';

type ChatScopeParams = {
  platformRole: 'superadmin' | 'admin' | 'manager' | 'member';
  activeOrganizationId: string | null;
  organizationId?: string;
};

@Injectable()
export class ChatService {
  constructor(
    @Inject(CHAT_REPOSITORY) private readonly chatRepository: IChatRepository,
    private readonly organizationsService: AdminOrganizationsService,
    private readonly chatAgentService: ChatAgentService,
  ) {}

  async listConversations(params: ChatScopeParams & { userId: string }) {
    const organizationId = await this.requireOrganizationId(params, 'read');

    const rows = await this.chatRepository.listConversations(
      params.userId,
      organizationId,
    );

    return rows.map(rowToConversationSummary);
  }

  async createConversation(
    params: ChatScopeParams & {
      userId: string;
      title?: string | null;
    },
  ) {
    const organizationId = await this.requireOrganizationId(params, 'write');

    const row = await this.chatRepository.createConversation({
      id: randomUUID(),
      title: this.normalizeTitle(params.title),
      organizationId,
      userId: params.userId,
    });

    return rowToConversationSummary(row);
  }

  async listMessages(
    params: ChatScopeParams & { conversationId: string; userId: string },
  ) {
    const conversation = await this.requireConversation(params);
    const rows = await this.chatRepository.listMessages(
      conversation.id,
      params.userId,
      this.resolveScopedOrganizationId(params, 'read'),
    );

    return rows.map(rowToMessage);
  }

  async sendMessage(
    params: ChatScopeParams & {
      conversationId: string;
      userId: string;
      content: string;
    },
  ) {
    const conversation = await this.requireConversation(params);
    const scopedOrganizationId = this.resolveScopedOrganizationId(
      params,
      'read',
    );
    const existingMessages = await this.chatRepository.listMessages(
      conversation.id,
      params.userId,
      scopedOrganizationId,
    );

    const organization = await this.requireOrganization(
      conversation.organizationId,
    );
    const collectionId = this.getOrganizationCollectionId(
      organization.metadata,
    );

    if (!collectionId) {
      throw new BadRequestException(
        'Organization does not have an Airweave collection configured. Set one in Admin > Organizations.',
      );
    }

    const userMessageRow = await this.chatRepository.createMessage({
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'user',
      content: params.content,
      metadata: null,
    });

    if (!conversation.title) {
      await this.chatRepository.updateConversationTitle(
        conversation.id,
        params.userId,
        scopedOrganizationId,
        this.buildConversationTitle(params.content),
      );
    }

    const assistantReply = await this.chatAgentService.generateReply({
      organizationName: organization.name,
      collectionId,
      question: params.content,
      previousMessages: existingMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    const assistantMessageRow = await this.chatRepository.createMessage({
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'assistant',
      content: assistantReply.content,
      metadata: assistantReply.metadata,
    });

    const updatedConversation = await this.chatRepository.findConversationById(
      conversation.id,
      params.userId,
      scopedOrganizationId,
    );

    if (!updatedConversation) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      conversation: rowToConversationSummary(updatedConversation),
      userMessage: rowToMessage(userMessageRow),
      assistantMessage: rowToMessage(assistantMessageRow),
    };
  }

  /**
   * Streaming version of sendMessage. Performs the same pre-work (validate
   * org, create user message, set title) then delegates to the agent's
   * streaming generator. The controller iterates the returned generator
   * and writes SSE events in real time. The final 'done' event carries
   * the complete reply which the controller persists to DB.
   */
  async *sendMessageStreaming(
    params: ChatScopeParams & {
      conversationId: string;
      userId: string;
      content: string;
    },
  ): AsyncGenerator<
    | ChatStreamEvent
    | {
        type: 'start';
        conversation: ReturnType<typeof rowToConversationSummary>;
        userMessage: ReturnType<typeof rowToMessage>;
      }
  > {
    const conversation = await this.requireConversation(params);
    const scopedOrganizationId = this.resolveScopedOrganizationId(
      params,
      'read',
    );
    const existingMessages = await this.chatRepository.listMessages(
      conversation.id,
      params.userId,
      scopedOrganizationId,
    );

    const organization = await this.requireOrganization(
      conversation.organizationId,
    );
    const collectionId = this.getOrganizationCollectionId(
      organization.metadata,
    );

    if (!collectionId) {
      throw new BadRequestException(
        'Organization does not have an Airweave collection configured. Set one in Admin > Organizations.',
      );
    }

    const userMessageRow = await this.chatRepository.createMessage({
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'user',
      content: params.content,
      metadata: null,
    });

    if (!conversation.title) {
      await this.chatRepository.updateConversationTitle(
        conversation.id,
        params.userId,
        scopedOrganizationId,
        this.buildConversationTitle(params.content),
      );
    }

    // Emit start event immediately so the frontend can display the user message
    const updatedConversationForStart =
      await this.chatRepository.findConversationById(
        conversation.id,
        params.userId,
        scopedOrganizationId,
      );

    yield {
      type: 'start' as const,
      conversation: updatedConversationForStart
        ? rowToConversationSummary(updatedConversationForStart)
        : conversation,
      userMessage: rowToMessage(userMessageRow),
    };

    // Stream agent events
    const agentStream = this.chatAgentService.generateReplyStreaming({
      organizationName: organization.name,
      collectionId,
      question: params.content,
      previousMessages: existingMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    for await (const event of agentStream) {
      yield event;
    }
  }

  async persistAssistantMessage(
    conversationId: string,
    _userId: string,
    _organizationId: string | undefined,
    reply: { content: string; metadata: Record<string, unknown> },
  ) {
    const row = await this.chatRepository.createMessage({
      id: randomUUID(),
      conversationId,
      role: 'assistant',
      content: reply.content,
      metadata: reply.metadata,
    });
    return rowToMessage(row);
  }

  async getConversationForComplete(
    conversationId: string,
    userId: string,
    organizationId: string | undefined,
  ) {
    const row = await this.chatRepository.findConversationById(
      conversationId,
      userId,
      organizationId?.trim() || null,
    );
    return row ? rowToConversationSummary(row) : null;
  }

  async deleteConversation(
    params: ChatScopeParams & { conversationId: string; userId: string },
  ) {
    const deleted = await this.chatRepository.deleteConversation(
      params.conversationId,
      params.userId,
      this.resolveScopedOrganizationId(params, 'read'),
    );

    if (!deleted) {
      throw new NotFoundException('Conversation not found');
    }

    return { success: true };
  }

  private async requireOrganizationId(
    params: ChatScopeParams,
    mode: 'read' | 'write',
  ): Promise<string> {
    const organizationId = this.resolveScopedOrganizationId(params, mode);
    await this.requireOrganization(organizationId);
    return organizationId;
  }

  private async requireOrganization(organizationId: string) {
    const organization =
      await this.organizationsService.findById(organizationId);

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  private async requireConversation(
    params: ChatScopeParams & { conversationId: string; userId: string },
  ) {
    const conversation = await this.chatRepository.findConversationById(
      params.conversationId,
      params.userId,
      this.resolveScopedOrganizationId(params, 'read'),
    );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return rowToConversationSummary(conversation);
  }

  private resolveScopedOrganizationId(
    params: ChatScopeParams,
    _mode: 'read' | 'write',
  ): string {
    const { platformRole, activeOrganizationId, organizationId } = params;
    const explicitOrganizationId = organizationId?.trim() || null;
    const scopedActiveOrganizationId = activeOrganizationId?.trim() || null;

    if (platformRole === 'superadmin') {
      if (organizationId !== undefined && !explicitOrganizationId) {
        throw new BadRequestException('organizationId cannot be blank');
      }

      const resolvedOrganizationId =
        explicitOrganizationId ?? scopedActiveOrganizationId;
      if (!resolvedOrganizationId) {
        throw new BadRequestException(
          'organizationId is required for superadmin',
        );
      }

      return resolvedOrganizationId;
    }

    if (!scopedActiveOrganizationId) {
      throw new ForbiddenException('Active organization required');
    }

    if (
      explicitOrganizationId &&
      explicitOrganizationId !== scopedActiveOrganizationId
    ) {
      throw new ForbiddenException(
        'You can only manage chat in your active organization',
      );
    }

    return scopedActiveOrganizationId;
  }

  private getOrganizationCollectionId(
    metadata: Record<string, unknown> | null,
  ): string | null {
    const collectionId = metadata?.airweaveCollectionId;

    if (typeof collectionId !== 'string') {
      return null;
    }

    const trimmedCollectionId = collectionId.trim();
    return trimmedCollectionId || null;
  }

  private normalizeTitle(title?: string | null): string | null {
    const trimmed = title?.trim();
    return trimmed ? trimmed : null;
  }

  private buildConversationTitle(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 60) {
      return normalized;
    }

    return `${normalized.slice(0, 57)}...`;
  }
}
