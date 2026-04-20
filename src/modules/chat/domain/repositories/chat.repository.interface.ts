import type {
  ChatMessageRole,
  ConversationRow,
  MessageRow,
} from '../../api/dto/chat.dto';

export const CHAT_REPOSITORY = 'CHAT_REPOSITORY';

export type CreateConversationParams = {
  id: string;
  title: string | null;
  organizationId: string;
  userId: string;
  projectId: string;
};

export type CreateMessageParams = {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  metadata?: Record<string, unknown> | null;
};

export interface IChatRepository {
  listConversations(
    userId: string,
    organizationId: string,
    projectId?: string,
  ): Promise<ConversationRow[]>;
  findConversationById(
    conversationId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<ConversationRow | null>;
  createConversation(
    params: CreateConversationParams,
  ): Promise<ConversationRow>;
  updateConversationTitle(
    conversationId: string,
    userId: string,
    organizationId: string | null,
    title: string,
  ): Promise<void>;
  listMessages(
    conversationId: string,
    userId: string,
    organizationId: string | null,
    limit?: number,
  ): Promise<MessageRow[]>;
  createMessage(params: CreateMessageParams): Promise<MessageRow>;
  deleteConversation(
    conversationId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<boolean>;
}
