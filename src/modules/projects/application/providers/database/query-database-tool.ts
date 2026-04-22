import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type {
  AgentToolContext,
  AgentToolPersistedCall,
} from '../data-source-provider.interface';
import type { ChatToSqlService } from './chat-to-sql.service';
import type { SqlDataSourceFactory } from './sql-datasource.factory';
import type { ResolvedSqlConnection } from './types';

export type CreateQueryDatabaseToolParams = {
  connections: ResolvedSqlConnection[];
  chatToSql: ChatToSqlService;
  factory: SqlDataSourceFactory;
  ctx: AgentToolContext;
  description: string;
};

/**
 * Builds the outer `query_database` tool that the chat agent uses for
 * natural-language questions against attached SQL connections.
 *
 * - 0 connections → caller skips this factory (no tool contributed).
 * - 1 connection  → `source_id` is optional.
 * - ≥2 connections → `source_id` is required. The rendered description lists
 *                    the available ids so the LLM can pick.
 */
export function createQueryDatabaseTool(
  params: CreateQueryDatabaseToolParams,
): StructuredTool {
  const { connections, chatToSql, factory, ctx, description } = params;
  if (connections.length === 0) {
    throw new Error('createQueryDatabaseTool requires at least one connection');
  }

  const sourceIdSchema =
    connections.length === 1
      ? z.string().optional()
      : z
          .string()
          .describe(
            'Required when multiple databases are attached. Must be the id of one of the available connections.',
          );

  const schema = z.object({
    question: z
      .string()
      .min(1)
      .describe(
        'A natural-language question the user wants answered from the database. The inner SQL agent will translate it into a read-only SELECT.',
      ),
    source_id: sourceIdSchema,
  });

  const connectionsById = new Map(connections.map((c) => [c.id, c]));
  const connectionsByName = new Map(
    connections.map((c) => [c.name.toLowerCase(), c] as const),
  );

  return tool(
    async (input) => {
      const { question, source_id: sourceId } = input;

      const resolved = resolveConnection(
        sourceId,
        connections,
        connectionsById,
        connectionsByName,
      );
      if ('error' in resolved) {
        return JSON.stringify(resolved);
      }

      if (ctx.signal.aborted) {
        return JSON.stringify({
          error: 'aborted',
          reason: 'the chat request was cancelled',
        });
      }

      const outcome = await chatToSql.askConnection(
        factory,
        resolved,
        question,
        ctx.signal,
      );

      if (outcome.ok === false) {
        return JSON.stringify({
          error: outcome.code,
          message: outcome.error,
          connectionId: resolved.id,
          connectionName: resolved.name,
          durationMs: outcome.durationMs,
        });
      }

      ctx.eventSink.push({
        type: 'sql_executed',
        connectionId: resolved.id,
        connectionName: resolved.name,
        sql: outcome.sql,
        rowCount: outcome.rowCount,
        rows: outcome.rows,
        truncated: outcome.truncated,
        durationMs: outcome.durationMs,
      });

      const persisted: AgentToolPersistedCall = {
        connectionId: resolved.id,
        connectionName: resolved.name,
        sql: outcome.sql,
        rowCount: outcome.rowCount,
        truncated: outcome.truncated,
        durationMs: outcome.durationMs,
      };
      ctx.persistedCalls.push(persisted);

      return JSON.stringify({
        connectionId: resolved.id,
        connectionName: resolved.name,
        sql: outcome.sql,
        rowCount: outcome.rowCount,
        rows: outcome.rows,
        truncated: outcome.truncated,
        durationMs: outcome.durationMs,
      });
    },
    {
      name: 'query_database',
      description,
      schema,
    },
  ) as unknown as StructuredTool;
}

function resolveConnection(
  sourceId: string | undefined,
  connections: ResolvedSqlConnection[],
  byId: Map<string, ResolvedSqlConnection>,
  byName: Map<string, ResolvedSqlConnection>,
):
  | ResolvedSqlConnection
  | { error: 'ambiguous_source'; available: Array<{ id: string; name: string }> }
  | { error: 'connection_not_found'; available: Array<{ id: string; name: string }> } {
  const available = connections.map((c) => ({ id: c.id, name: c.name }));

  if (!sourceId) {
    if (connections.length === 1) return connections[0]!;
    return { error: 'ambiguous_source', available };
  }

  const byExactId = byId.get(sourceId.trim());
  if (byExactId) return byExactId;

  const byExactName = byName.get(sourceId.trim().toLowerCase());
  if (byExactName) return byExactName;

  return { error: 'connection_not_found', available };
}
