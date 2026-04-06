import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';
import type { ConversationRow, MessageRow } from '../../../api/dto/chat.dto';
import type {
  CreateConversationParams,
  CreateMessageParams,
  IChatRepository,
} from '../../../domain/repositories/chat.repository.interface';

const CONVERSATION_COLUMNS = `
  c.id,
  c.title,
  c.organization_id,
  c.user_id,
  c.created_at,
  c.updated_at,
  lm.last_message_preview,
  lm.last_message_at,
  mc.message_count
`;

const MESSAGE_COLUMNS = `
  m.id,
  m.conversation_id,
  m.role,
  m.content,
  m.metadata,
  m.created_at
`;

@Injectable()
export class ChatDatabaseRepository implements IChatRepository {
  constructor(private readonly db: DatabaseService) {}

  async listConversations(
    userId: string,
    organizationId: string,
  ): Promise<ConversationRow[]> {
    return this.db.query<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS}
       FROM conversation c
       LEFT JOIN LATERAL (
         SELECT LEFT(m.content, 160) AS last_message_preview, m.created_at AS last_message_at
         FROM message m
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC
         LIMIT 1
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS message_count
         FROM message m
         WHERE m.conversation_id = c.id
       ) mc ON true
       WHERE c.user_id = $1
         AND c.organization_id = $2
       ORDER BY c.updated_at DESC`,
      [userId, organizationId],
    );
  }

  async findConversationById(
    conversationId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<ConversationRow | null> {
    const params: unknown[] = [conversationId, userId];
    let sql = `SELECT ${CONVERSATION_COLUMNS}
       FROM conversation c
       LEFT JOIN LATERAL (
         SELECT LEFT(m.content, 160) AS last_message_preview, m.created_at AS last_message_at
         FROM message m
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC
         LIMIT 1
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS message_count
         FROM message m
         WHERE m.conversation_id = c.id
       ) mc ON true
       WHERE c.id = $1 AND c.user_id = $2`;

    if (organizationId) {
      params.push(organizationId);
      sql += ` AND c.organization_id = $${params.length}`;
    }

    return this.db.queryOne<ConversationRow>(sql, params);
  }

  async createConversation(
    params: CreateConversationParams,
  ): Promise<ConversationRow> {
    const row = await this.db.queryOne<ConversationRow>(
      `INSERT INTO conversation (
        id,
        title,
        organization_id,
        user_id,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING
        id,
        title,
        organization_id,
        user_id,
        created_at,
        updated_at,
        NULL::text AS last_message_preview,
        NULL::timestamptz AS last_message_at,
        0::int AS message_count`,
      [params.id, params.title, params.organizationId, params.userId],
    );

    if (!row) {
      throw new Error('Failed to create conversation');
    }

    return row;
  }

  async updateConversationTitle(
    conversationId: string,
    userId: string,
    organizationId: string | null,
    title: string,
  ): Promise<void> {
    const params: unknown[] = [title, conversationId, userId];
    let sql = `UPDATE conversation SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`;

    if (organizationId) {
      params.push(organizationId);
      sql += ` AND organization_id = $${params.length}`;
    }

    await this.db.query(sql, params);
  }

  async listMessages(
    conversationId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<MessageRow[]> {
    const params: unknown[] = [conversationId, userId];
    let sql = `SELECT ${MESSAGE_COLUMNS}
       FROM message m
       JOIN conversation c ON c.id = m.conversation_id
       WHERE m.conversation_id = $1
         AND c.user_id = $2`;

    if (organizationId) {
      params.push(organizationId);
      sql += ` AND c.organization_id = $${params.length}`;
    }

    sql += ' ORDER BY m.created_at ASC';

    return this.db.query<MessageRow>(sql, params);
  }

  async createMessage(params: CreateMessageParams): Promise<MessageRow> {
    const row = await this.db.queryOne<MessageRow>(
      `INSERT INTO message (
        id,
        conversation_id,
        role,
        content,
        metadata,
        created_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
      RETURNING
        id,
        conversation_id,
        role,
        content,
        metadata,
        created_at`,
      [
        params.id,
        params.conversationId,
        params.role,
        params.content,
        JSON.stringify(params.metadata ?? null),
      ],
    );

    await this.db.query(
      'UPDATE conversation SET updated_at = NOW() WHERE id = $1',
      [params.conversationId],
    );

    if (!row) {
      throw new Error('Failed to create message');
    }

    return row;
  }

  async deleteConversation(
    conversationId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<boolean> {
    const params: unknown[] = [conversationId, userId];
    let sql = 'DELETE FROM conversation WHERE id = $1 AND user_id = $2';

    if (organizationId) {
      params.push(organizationId);
      sql += ` AND organization_id = $${params.length}`;
    }

    sql += ' RETURNING id';
    const rows = await this.db.query<{ id: string }>(sql, params);
    return rows.length > 0;
  }
}
