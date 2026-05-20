import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../../../../shared/config';
import { ReadOnlySqlDatabase } from './read-only-sql-database';
import { sanitizeAgentError } from './sql-error-sanitizer';
import { SqlDataSourceFactory } from './sql-datasource.factory';
import { shapeQueryResult } from './sql-result-shaper';
import { runSqlSubAgent } from './sql-sub-agent';
import {
  ReadOnlyViolation,
  type ChatToSqlError,
  type ResolvedSqlConnection,
  type SqlLimits,
} from './types';

export type ChatToSqlResult =
  | {
      ok: true;
      sql: string;
      rowCount: number;
      rows: unknown[];
      truncated: boolean;
      durationMs: number;
      finalText: string;
    }
  | {
      ok: false;
      error: string;
      code: ChatToSqlError;
      durationMs: number;
    };

/**
 * Per-request orchestrator for the chat → SQL path. One factory + sub-agent
 * per call. Callers must invoke `askConnection()` inside a try/finally that
 * eventually calls the returned factory's `destroyAll()`.
 */
@Injectable()
export class ChatToSqlService {
  private readonly logger = new Logger(ChatToSqlService.name);

  constructor(private readonly configService: ConfigService) {}

  createFactory(): SqlDataSourceFactory {
    return new SqlDataSourceFactory(this.buildLimits());
  }

  async askConnection(
    factory: SqlDataSourceFactory,
    connection: ResolvedSqlConnection,
    question: string,
    signal?: AbortSignal,
  ): Promise<ChatToSqlResult> {
    const startedAt = Date.now();
    const limits = this.buildLimits();

    let db: ReadOnlySqlDatabase;
    try {
      const dataSource = await factory.get(connection);
      // H1c: pipe the per-connection table allowlist into the sub-agent's
      // SqlToolkit. NULL/missing → undefined → SqlToolkit sees the entire
      // schema (preserves prior behavior). Array → SqlToolkit only sees
      // the listed tables in list_tables_sql_db / info_sql_db calls.
      db = await ReadOnlySqlDatabase.fromDataSource(dataSource, limits, {
        includesTables: connection.allowedTables ?? undefined,
      });
    } catch (error) {
      const sanitized = sanitizeAgentError(error);
      this.logger.warn(
        `chat-to-sql connection setup failed [code=${sanitized.code}]: ${sanitized.serverDetail}`,
      );
      return {
        ok: false,
        error: sanitized.message,
        // Connection-setup failures keep the connection_failed code unless
        // the sanitizer specifically classifies them as something more
        // specific (e.g. timeout).
        code: sanitized.code === 'internal_error' ? 'connection_failed' : sanitized.code,
        durationMs: Date.now() - startedAt,
      };
    }

    const apiKey = this.configService.getOpenAiApiKey();
    if (!apiKey) {
      return {
        ok: false,
        error: 'OpenAI API key not configured',
        code: 'connection_failed',
        durationMs: Date.now() - startedAt,
      };
    }

    const systemPrompt = this.configService.getSqlAgentSystemPrompt();
    const model =
      this.configService.getSqlAgentModel() ??
      this.configService.getOpenAiModel();
    const maxIterations = this.configService.getSqlAgentMaxIterations();

    try {
      const subAgent = await runSqlSubAgent(
        db,
        question,
        { apiKey, model, systemPrompt, maxIterations },
        signal,
      );

      const sql = db.lastExecutedSql;
      if (!sql) {
        return {
          ok: false,
          error: 'The SQL agent did not execute any query',
          code: 'no_query_executed',
          durationMs: Date.now() - startedAt,
        };
      }

      // Reuse the rows captured by the last `run()` call — rerunning to
      // shape the result doubled the load on the remote database and, under
      // concurrent traffic, could even produce divergent snapshots.
      const capturedRows = db.lastExecutedRows;
      const shaped = shapeQueryResult(capturedRows ?? [], {
        maxRows: limits.maxRows,
        maxBytes: limits.maxBytes,
        maxFieldBytes: limits.maxFieldBytes,
      });

      return {
        ok: true,
        sql,
        rowCount: shaped.rowCount,
        rows: shaped.rows,
        truncated: shaped.truncated,
        durationMs: Date.now() - startedAt,
        finalText: subAgent.finalText,
      };
    } catch (error) {
      // Read-only violations are always our explicit `ReadOnlyViolation`
      // subclass — handle them first so the canonical message wins. For
      // everything else, the sanitizer's pattern table categorizes by
      // matching the raw error text (timeout / connection / permission /
      // missing-relation / etc.) and returns a canonical, leak-safe message.
      // The raw error is logged server-side via `serverDetail` so operators
      // still get the full picture.
      const sanitized =
        error instanceof ReadOnlyViolation
          ? {
              code: 'read_only_violation' as ChatToSqlError,
              message: 'The agent attempted a non-read-only operation.',
              serverDetail: error.message.slice(0, 1000),
            }
          : sanitizeAgentError(error);
      this.logger.warn(
        `chat-to-sql sub-agent error [code=${sanitized.code}]: ${sanitized.serverDetail}`,
      );
      return {
        ok: false,
        error: sanitized.message,
        code: sanitized.code,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private buildLimits(): SqlLimits {
    return {
      statementTimeoutMs: this.configService.getSqlAgentStatementTimeoutMs(),
      idleTimeoutMs: this.configService.getSqlAgentIdleTimeoutMs(),
      connectTimeoutMs: this.configService.getSqlAgentConnectTimeoutMs(),
      maxRows: this.configService.getSqlAgentMaxRows(),
      maxBytes: this.configService.getSqlAgentMaxBytes(),
      maxFieldBytes: this.configService.getSqlAgentMaxFieldBytes(),
      maxSqlLength: this.configService.getSqlAgentMaxSqlLength(),
      poolMax: this.configService.getSqlAgentPoolMax(),
    };
  }

}
