import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../../../../shared/config';
import type { SqlProgressCallback } from '../data-source-provider.interface';
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
    /**
     * Optional progress callback. When provided, fires `sql_planning`
     * here (before the sub-agent starts) and `sql_executing` from
     * inside the sub-agent (wrapped query-sql tool). Both events are
     * pushed via the same `onProgress` callback — the caller
     * (chat-agent's runSqlRoute or the query-database-tool wrapper)
     * routes them into `ctx.eventSink` so the streaming loop surfaces
     * them at the next outer-loop message boundary.
     *
     * Optional everywhere; callers that omit it pay no overhead.
     */
    onProgress?: SqlProgressCallback,
  ): Promise<ChatToSqlResult> {
    const startedAt = Date.now();
    const limits = this.buildLimits();

    let db: ReadOnlySqlDatabase;
    try {
      const dataSource = await factory.get(connection);
      // Pipe the per-connection table allowlist into the sub-agent's
      // SqlToolkit. NULL/missing → undefined → SqlToolkit sees the
      // entire schema. Array → SqlToolkit only sees the listed tables
      // in list_tables_sql_db / info_sql_db calls.
      //
      // Sample-row count for `info-sql` is opt-in. When
      // SQL_AGENT_SAMPLE_ROWS is unset the getter returns null and we
      // OMIT `sampleRowsInTableInfo` from the options object →
      // SqlDatabase applies its built-in default (3). Setting
      // SQL_AGENT_SAMPLE_ROWS=0 in env disables sample rows entirely.
      const sampleRows = this.configService.getSqlAgentSampleRows();
      db = await ReadOnlySqlDatabase.fromDataSource(dataSource, limits, {
        includesTables: connection.allowedTables ?? undefined,
        ...(sampleRows !== null && { sampleRowsInTableInfo: sampleRows }),
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
      // Pre-warm the schema deterministically when enabled.
      // `db.getTableInfo()` (no argument) returns the full schema
      // scoped by the connection's `includesTables` allowlist — the
      // library already filters internally. `getTableInfo` is the
      // canonical source.
      //
      // Fail-fast: a schema-read failure surfaces (sanitizeAgentError +
      // explicit error code below). Do NOT silently fall back to the
      // discovery path — operators need to see DB connectivity issues
      // immediately rather than as a slow degraded turn.
      let prewarmedSchema: string | undefined;
      if (this.configService.getSqlAgentPrewarmSchemaEnabled()) {
        try {
          prewarmedSchema = await db.getTableInfo();
        } catch (error) {
          const sanitized = sanitizeAgentError(error);
          this.logger.warn(
            `chat-to-sql schema pre-warm failed [code=${sanitized.code}]: ${sanitized.serverDetail}`,
          );
          return {
            ok: false,
            error: sanitized.message,
            code: sanitized.code,
            durationMs: Date.now() - startedAt,
          };
        }
      }

      // Emit sql_planning BEFORE the sub-agent starts. This surfaces
      // "I'm about to think about your SQL question" to the SPA during
      // the otherwise-silent sub-agent latency window. The caller's
      // onProgress (when provided) routes the event into ctx.eventSink
      // so the chat-agent streaming loop drains it at the next message
      // boundary.
      if (onProgress) {
        onProgress({
          type: 'sql_planning',
          connectionId: connection.id,
          connectionName: connection.name,
        });
      }

      const subAgent = await runSqlSubAgent(
        db,
        question,
        {
          apiKey,
          model,
          systemPrompt,
          maxIterations,
          // Operator-overridable. Defaults to false (keeps the
          // `query-checker` LLM call in the loop). Flip via
          // SQL_AGENT_DROP_CHECKER_ENABLED=true once telemetry confirms
          // first-attempt SQL accuracy is good enough that the
          // checker's pre-validation LLM call is wasted overhead.
          dropCheckerEnabled: this.configService.getSqlAgentDropCheckerEnabled(),
          // Undefined when pre-warm flag is off; the rendered schema
          // string when on.
          prewarmedSchema,
        },
        signal,
        // Forward the same callback so the wrapped query-sql tool can
        // fire sql_executing right before db.run.
        onProgress
          ? {
              connectionId: connection.id,
              connectionName: connection.name,
              onProgress,
            }
          : undefined,
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
