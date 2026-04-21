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
  c.project_id,
  p.name AS project_name,
  ps.project_source_count,
  c.created_at,
  c.updated_at,
  lm.last_message_preview,
  lm.last_message_at,
  mc.message_count
`;

const CONVERSATION_JOINS = `
  LEFT JOIN project p ON p.id = c.project_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS project_source_count
    FROM project_data_source pds
    WHERE pds.project_id = c.project_id
  ) ps ON true
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
    projectId?: string,
  ): Promise<ConversationRow[]> {
    const params: unknown[] = [userId, organizationId];
    let sql = `SELECT ${CONVERSATION_COLUMNS}
       FROM conversation c
       ${CONVERSATION_JOINS}
       WHERE c.user_id = $1
         AND c.organization_id = $2`;

    if (projectId) {
      params.push(projectId);
      sql += ` AND c.project_id = $${params.length}`;
    }

    sql += ' ORDER BY c.updated_at DESC';

    return this.db.query<ConversationRow>(sql, params);
  }

  async listAllUserConversations(
    userId: string,
    projectId?: string,
  ): Promise<ConversationRow[]> {
    const params: unknown[] = [userId];
    let sql = `SELECT ${CONVERSATION_COLUMNS}
       FROM conversation c
       ${CONVERSATION_JOINS}
       WHERE c.user_id = $1`;

    if (projectId) {
      params.push(projectId);
      sql += ` AND c.project_id = $${params.length}`;
    }

    sql += ' ORDER BY c.updated_at DESC';

    return this.db.query<ConversationRow>(sql, params);
  }

  async findConversationById(
    conversationId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<ConversationRow | null> {
    const params: unknown[] = [conversationId, userId];
    let sql = `SELECT ${CONVERSATION_COLUMNS}
       FROM conversation c
       ${CONVERSATION_JOINS}
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
      `WITH inserted AS (
        INSERT INTO conversation (
          id,
          title,
          organization_id,
          user_id,
          project_id,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id, title, organization_id, user_id, project_id, created_at, updated_at
      )
      SELECT
        i.id,
        i.title,
        i.organization_id,
        i.user_id,
        i.project_id,
        p.name AS project_name,
        (SELECT COUNT(*)::int FROM project_data_source pds WHERE pds.project_id = i.project_id) AS project_source_count,
        i.created_at,
        i.updated_at,
        NULL::text AS last_message_preview,
        NULL::timestamptz AS last_message_at,
        0::int AS message_count
      FROM inserted i
      LEFT JOIN project p ON p.id = i.project_id`,
      [
        params.id,
        params.title,
        params.organizationId,
        params.userId,
        params.projectId,
      ],
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
    limit = 200,
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

    params.push(limit);
    sql += ` LIMIT $${params.length}`;

    return this.db.query<MessageRow>(sql, params);
  }

  async createMessage(params: CreateMessageParams): Promise<MessageRow> {
    return this.db.transaction(async (query) => {
      const rows = await query<MessageRow>(
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

      await query('UPDATE conversation SET updated_at = NOW() WHERE id = $1', [
        params.conversationId,
      ]);

      const row = rows[0] ?? null;
      if (!row) {
        throw new Error('Failed to create message');
      }

      return row;
    });
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
