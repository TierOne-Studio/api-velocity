import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { assertSafeAgentHost } from '../../../../../shared/security/host-validator';
import type { ResolvedSqlConnection, SqlLimits } from './types';

/**
 * Request-scoped factory for TypeORM DataSources. One instance per chat turn.
 * Callers must `destroyAll()` in a `finally` block.
 *
 * The previous host+port app-DB guard (`checkForbiddenAppDatabase` /
 * `assertNotAppDatabase`, with `AGENT_FORBIDDEN_DATABASES`-driven config)
 * was removed in favor of a read-only contract enforced at three other
 * layers:
 *   - SQL validator deny-list including instance-metadata catalogs and
 *     `SHOW`-sensitive parameters (`sql-validator.ts`);
 *   - `SET TRANSACTION READ ONLY` chokepoint in `read-only-sql-database.ts`;
 *   - operator-provisioned `SELECT`-only Postgres role grants on the agent
 *     connection (documented in `docs/sql-connections-operations.md`).
 * Rationale and threat-model trade-offs are recorded in ADR-010 (which
 * supersedes ADR-0001's code-level Layer C enforcement).
 *
 * The SSRF guard (`assertSafeAgentHost`) is unchanged — it still blocks
 * RFC1918 / loopback / link-local / cloud-metadata destinations regardless
 * of the agent's read-only contract.
 */
export class SqlDataSourceFactory {
  private static readonly logger = new Logger('SqlDataSourceFactory');
  private readonly dataSources = new Map<string, DataSource>();

  constructor(private readonly limits: SqlLimits) {}

  async get(connection: ResolvedSqlConnection): Promise<DataSource> {
    const cached = this.dataSources.get(connection.id);
    if (cached) return cached;

    // SSRF guard (C1+S3): re-validate the host at every dial. DNS rebinding
    // between save-time and dial-time can change resolution; we revalidate
    // every time the chat agent attempts a query.
    await assertSafeAgentHost(connection.host);

    // Audit log. ADR-010 removed the host+port app-DB guard; this log is
    // the SRE-facing tripwire that replaces it. Pipe into a SIEM and alert
    // on `host == <parsed DATABASE_URL host>` to catch operators who
    // mis-configured a chat connection at the application DB. The log
    // SHOULD NOT carry credentials, username, or SQL text — host/port/
    // database/connectionId are sufficient to identify the dial.
    SqlDataSourceFactory.logger.log(
      `[agent.dial] connectionId=${connection.id} host=${connection.host} port=${connection.port} database=${connection.database}`,
    );

    const ds = new DataSource({
      type: 'postgres',
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl: (connection.ssl ?? false) as
        | boolean
        | { rejectUnauthorized?: boolean },
      synchronize: false,
      entities: [],
      extra: { max: this.limits.poolMax },
    });
    await this.raceInit(ds, this.limits.connectTimeoutMs);
    this.dataSources.set(connection.id, ds);
    return ds;
  }

  async destroyAll(): Promise<void> {
    const all = Array.from(this.dataSources.values());
    this.dataSources.clear();
    await Promise.all(
      all.map((ds) =>
        ds.isInitialized ? ds.destroy().catch(() => undefined) : undefined,
      ),
    );
  }

  private raceInit(ds: DataSource, timeoutMs: number): Promise<DataSource> {
    return new Promise<DataSource>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('connect timeout'));
      }, timeoutMs);
      ds.initialize()
        .then(async (value) => {
          clearTimeout(timer);
          if (timedOut) {
            // M1: await the destroy and log if it fails. We've already
            // rejected with 'connect timeout' so the outer caller has
            // moved on, but the late-init DataSource MUST be cleaned up
            // (or visibly fail to clean up) — silently swallowing the
            // error was the leak gap flagged in the PR review.
            try {
              await value.destroy();
            } catch (destroyErr) {
              console.warn(
                '[SqlDataSourceFactory] late-init destroy after timeout failed:',
                destroyErr instanceof Error
                  ? destroyErr.message
                  : String(destroyErr),
              );
            }
            return;
          }
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          if (timedOut) return;
          reject(err);
        });
    });
  }
}
