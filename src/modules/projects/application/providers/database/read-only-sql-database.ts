import { SqlDatabase } from '@langchain/classic/sql_db';
import type { DataSource } from 'typeorm';
import { validateReadOnlySql } from './sql-validator';
import { ReadOnlyViolation, type SqlLimits } from './types';

/**
 * Read-only SqlDatabase. Overrides `run()` to:
 *   1. Gate every SQL through the static validator.
 *   2. Execute inside a `SET TRANSACTION READ ONLY` transaction with
 *      `SET LOCAL statement_timeout` and idle-in-transaction timeout.
 *
 * We do NOT call `super.run()`. The parent's `run()` uses
 * `this.appDataSource.query(...)`, which bypasses the transaction runner —
 * timeouts set via `SET LOCAL` would not apply. Every SqlToolkit call path
 * that ends up executing SQL goes through this single chokepoint.
 */
export class ReadOnlySqlDatabase extends SqlDatabase {
  /**
   * Assigned by `fromDataSource()` after prototype swap. Marked definite so TS
   * accepts the shape without forcing us to duplicate the parent constructor
   * (which is protected).
   */
  private _limits!: SqlLimits;
  /** Updated every time `run()` passes the validator and begins executing. */
  lastExecutedSql: string | null = null;
  /**
   * Captures the raw rows from the most recent `run()` call. Used by the
   * chat-to-SQL orchestrator to shape results without a second round-trip
   * to the remote database — the sub-agent consumes only the JSON string
   * return value, so without this cache we'd have to re-execute the query.
   */
  lastExecutedRows: unknown[] | null = null;

  static async fromDataSource(
    appDataSource: DataSource,
    limits: SqlLimits,
    options?: {
      includesTables?: string[];
      ignoreTables?: string[];
      /**
       * Number of sample rows the parent `SqlDatabase` includes per
       * table in `info-sql`/`getTableInfo()` output. Defaults to the
       * parent's own default (3) when undefined. ChatToSqlService can
       * pass 0 (via SQL_AGENT_SAMPLE_ROWS env) to keep prompt tokens
       * lean for sub-agent SQL generation.
       */
      sampleRowsInTableInfo?: number;
    },
  ): Promise<ReadOnlySqlDatabase> {
    const instance = await SqlDatabase.fromDataSourceParams({
      appDataSource,
      includesTables: options?.includesTables,
      ignoreTables: options?.ignoreTables,
      sampleRowsInTableInfo: options?.sampleRowsInTableInfo,
    });
    Object.setPrototypeOf(instance, ReadOnlySqlDatabase.prototype);
    const ro = instance as ReadOnlySqlDatabase;
    ro._limits = limits;
    return ro;
  }

  override async run(
    command: string,
    fetch: 'all' | 'one' = 'all',
  ): Promise<string> {
    const verdict = validateReadOnlySql(command, {
      maxSqlLength: this._limits.maxSqlLength,
    });
    if (verdict.ok === false) {
      throw new ReadOnlyViolation(verdict.reason);
    }
    this.lastExecutedSql = command.trim();
    this.lastExecutedRows = null;

    // AbortSignal vs statement_timeout
    //
    // The outer chat handler threads AbortSignal through the sub-agent
    // (controller `on('close')` → service → sql-sub-agent.invoke) so a
    // tab close unwinds the agent loop promptly. But once a query has
    // been ISSUED to Postgres via `tx.query(command)` below, the signal
    // CANNOT cancel it server-side — typeorm + node-postgres don't send
    // `pg_cancel_backend()` on abort. The query runs to completion or
    // to `SET LOCAL statement_timeout` (set above, ~5s by default).
    //
    // In practice this is fine: tab-close aborts unwind the JS side
    // immediately; the orphaned server-side query is bounded by the
    // statement timeout. A tighter "cancel mid-flight" defense would
    // need an out-of-band session-id channel and is tracked as a
    // separate concern.
    return this.appDataSource.transaction(async (tx) => {
      await tx.query('SET TRANSACTION READ ONLY');
      await tx.query(
        `SET LOCAL statement_timeout = ${this._limits.statementTimeoutMs}`,
      );
      await tx.query(
        `SET LOCAL idle_in_transaction_session_timeout = ${this._limits.idleTimeoutMs}`,
      );
      const rows = await tx.query(command);
      this.lastExecutedRows = Array.isArray(rows) ? rows : [];
      if (fetch === 'all') return JSON.stringify(rows);
      if (Array.isArray(rows) && rows.length > 0) {
        return JSON.stringify(rows[0]);
      }
      return '';
    });
  }

  /** Returns the last-run row payload as an unknown array. */
  async runRaw(command: string): Promise<unknown[]> {
    const verdict = validateReadOnlySql(command, {
      maxSqlLength: this._limits.maxSqlLength,
    });
    if (verdict.ok === false) {
      throw new ReadOnlyViolation(verdict.reason);
    }
    this.lastExecutedSql = command.trim();
    this.lastExecutedRows = null;
    return this.appDataSource.transaction(async (tx) => {
      await tx.query('SET TRANSACTION READ ONLY');
      await tx.query(
        `SET LOCAL statement_timeout = ${this._limits.statementTimeoutMs}`,
      );
      await tx.query(
        `SET LOCAL idle_in_transaction_session_timeout = ${this._limits.idleTimeoutMs}`,
      );
      const rows = await tx.query(command);
      const out = Array.isArray(rows) ? rows : [];
      this.lastExecutedRows = out;
      return out;
    });
  }
}
