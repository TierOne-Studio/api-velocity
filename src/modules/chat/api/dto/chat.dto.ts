export const CHAT_MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;

export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export interface ConversationRow {
  id: string;
  title: string | null;
  organization_id: string;
  user_id: string;
  created_at: Date;
  updated_at: Date;
  last_message_preview?: string | null;
  last_message_at?: Date | null;
  message_count?: number | string | null;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  organizationId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  messageCount: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: ChatMessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export function rowToConversationSummary(
  row: ConversationRow,
): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    organizationId: row.organization_id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessagePreview: row.last_message_preview ?? null,
    lastMessageAt: row.last_message_at ?? null,
    messageCount: Number(row.message_count ?? 0),
  };
}

export function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata ?? null,
    createdAt: row.created_at,
  };
}
