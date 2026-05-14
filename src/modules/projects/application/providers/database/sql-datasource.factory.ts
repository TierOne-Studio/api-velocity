import { DataSource } from 'typeorm';
import { assertSafeAgentHost } from '../../../../../shared/security/host-validator';
import type { ResolvedSqlConnection, SqlLimits } from './types';

/**
 * Pure-function helper exposed for unit testing. Returns `'allow'` when the
 * connection is safe to dial, `'forbidden'` when host+port match any
 * forbidden (application) database URL, and `'invalid-forbidden-url'` when
 * any forbidden URL is malformed (fail-closed, per S2).
 *
 * Notes vs. the prior `assertNotAppDatabase`:
 *   - S1: matches on host+port only. The old impl required `database` to
 *     match too, which let sibling databases on the same physical instance
 *     slip through (`postgres://...@10.0.1.5:5432/app_readonly` was treated
 *     as different from `.../app`, but `dblink` from one to the other was
 *     trivial).
 *   - S2: fails closed on malformed URL. The old impl silently allowed the
 *     connection through. A broken URL is a boot-time bug; the SQL agent
 *     path must NOT proceed without a valid app-DB identity to compare
 *     against.
 *   - S4: accepts a LIST of forbidden URLs (primary + replica + sibling
 *     instances). Empty list = no guard.
 *   - Hostname compare is case-insensitive.
 */
export type ForbiddenAppDbCheck =
  | { result: 'allow' }
  | { result: 'forbidden'; reason: string }
  | { result: 'invalid-forbidden-url'; reason: string };

export function checkForbiddenAppDatabase(
  forbiddenUrls: readonly string[] | null,
  connection: { host: string; port: number },
): ForbiddenAppDbCheck {
  if (!forbiddenUrls || forbiddenUrls.length === 0) return { result: 'allow' };

  const connHost = connection.host.trim().toLowerCase();
  for (const forbiddenUrl of forbiddenUrls) {
    let parsed: URL;
    try {
      parsed = new URL(forbiddenUrl);
    } catch {
      return {
        result: 'invalid-forbidden-url',
        reason: `Forbidden app-DB URL is malformed; cannot verify isolation: ${forbiddenUrl}`,
      };
    }
    const appHost = parsed.hostname.toLowerCase();
    const appPort = Number(parsed.port || '5432');
    if (appHost === connHost && appPort === connection.port) {
      return {
        result: 'forbidden',
        reason:
          'Refusing to connect to the application database via a user SQL connection',
      };
    }
  }
  return { result: 'allow' };
}

/**
 * Request-scoped factory for TypeORM DataSources. One instance per chat turn.
 * Callers must `destroyAll()` in a `finally` block.
 */
export class SqlDataSourceFactory {
  private readonly dataSources = new Map<string, DataSource>();

  constructor(
    private readonly limits: SqlLimits,
    private readonly forbiddenUrls: readonly string[] = [],
  ) {}

  async get(connection: ResolvedSqlConnection): Promise<DataSource> {
    const cached = this.dataSources.get(connection.id);
    if (cached) return cached;

    // Cheap in-memory check first (S1+S2): refuses dials at the app DB and
    // fails closed on a malformed forbidden URL.
    this.assertNotAppDatabase(connection);

    // SSRF guard (C1+S3): re-validate the host at every dial. DNS rebinding
    // between save-time and dial-time can change resolution; we revalidate
    // every time the chat agent attempts a query.
    await assertSafeAgentHost(connection.host);

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

  private assertNotAppDatabase(connection: ResolvedSqlConnection): void {
    const check = checkForbiddenAppDatabase(this.forbiddenUrls, {
      host: connection.host,
      port: connection.port,
    });
    if (check.result === 'forbidden' || check.result === 'invalid-forbidden-url') {
      throw new Error(check.reason);
    }
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
