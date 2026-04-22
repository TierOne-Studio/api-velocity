import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../../../shared/config';
import { sanitizeError } from '../../../../sql-connections/application/services/sql-connection-tester';
import { ReadOnlySqlDatabase } from './read-only-sql-database';
import { SqlDataSourceFactory } from './sql-datasource.factory';
import { shapeQueryResult } from './sql-result-shaper';
import { runSqlSubAgent } from './sql-sub-agent';
import {
  ReadOnlyViolation,
  type ResolvedSqlConnection,
  type ShapedQueryResult,
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
      code:
        | 'read_only_violation'
        | 'no_query_executed'
        | 'connection_failed'
        | 'timeout'
        | 'internal_error';
      durationMs: number;
    };

/**
 * Per-request orchestrator for the chat → SQL path. One factory + sub-agent
 * per call. Callers must invoke `askConnection()` inside a try/finally that
 * eventually calls the returned factory's `destroyAll()`.
 */
@Injectable()
export class ChatToSqlService {
  constructor(private readonly configService: ConfigService) {}

  createFactory(): SqlDataSourceFactory {
    return new SqlDataSourceFactory(this.buildLimits(), this.safeAppDbUrl());
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
      db = await ReadOnlySqlDatabase.fromDataSource(dataSource, limits);
    } catch (error) {
      return {
        ok: false,
        error: sanitizeError(error),
        code: 'connection_failed',
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

      const shaped = await this.rerunForShapedResult(db, sql, limits);

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
      const message = sanitizeError(error);
      const code: 'read_only_violation' | 'timeout' | 'internal_error' =
        error instanceof ReadOnlyViolation
          ? 'read_only_violation'
          : /statement timeout|timeout/i.test(message)
            ? 'timeout'
            : 'internal_error';
      return {
        ok: false,
        error: message,
        code,
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

  private safeAppDbUrl(): string | null {
    try {
      return this.configService.getDatabaseUrl();
    } catch {
      return null;
    }
  }

  /**
   * Re-run the last SQL under the same RO constraints so we can return a
   * shaped structured result (the sub-agent's tool message contains only the
   * stringified rows the LLM reasoned over).
   */
  private async rerunForShapedResult(
    db: ReadOnlySqlDatabase,
    sql: string,
    limits: SqlLimits,
  ): Promise<ShapedQueryResult> {
    const rows = await db.runRaw(sql);
    return shapeQueryResult(rows, {
      maxRows: limits.maxRows,
      maxBytes: limits.maxBytes,
      maxFieldBytes: limits.maxFieldBytes,
    });
  }
}
