import { DataSource } from 'typeorm';
import { assertSafeAgentHost } from '../../../../../shared/security/host-validator';
import type { ResolvedSqlConnection, SqlLimits } from './types';

/**
 * Pure-function helper exposed for unit testing. Returns `'allow'` when the
 * connection is safe to dial, `'forbidden'` when host+port match the
 * forbidden (application) DATABASE_URL, and `'invalid-forbidden-url'` when
 * the forbidden URL is malformed.
 *
 * Notes vs. the prior `assertNotAppDatabase`:
 *   - S1: matches on host+port only. The old impl required `database` to
 *     match too, which let sibling databases on the same physical instance
 *     slip through (`postgres://...@10.0.1.5:5432/app_readonly` was treated
 *     as different from `.../app`, but `dblink` from one to the other was
 *     trivial).
 *   - S2: fails closed on malformed URL. The old impl silently allowed the
 *     connection through. A broken DATABASE_URL is a boot-time bug; the
 *     SQL agent path must NOT proceed without a valid app-DB identity to
 *     compare against.
 *   - Hostname compare is case-insensitive.
 */
export type ForbiddenAppDbCheck =
  | { result: 'allow' }
  | { result: 'forbidden'; reason: string }
  | { result: 'invalid-forbidden-url'; reason: string };

export function checkForbiddenAppDatabase(
  forbiddenUrl: string | null,
  connection: { host: string; port: number },
): ForbiddenAppDbCheck {
  if (!forbiddenUrl) return { result: 'allow' };

  let parsed: URL;
  try {
    parsed = new URL(forbiddenUrl);
  } catch {
    return {
      result: 'invalid-forbidden-url',
      reason: 'Forbidden app-DB URL is malformed; cannot verify isolation',
    };
  }
  const appHost = parsed.hostname.toLowerCase();
  const appPort = Number(parsed.port || '5432');
  const connHost = connection.host.trim().toLowerCase();

  if (appHost === connHost && appPort === connection.port) {
    return {
      result: 'forbidden',
      reason:
        'Refusing to connect to the application database via a user SQL connection',
    };
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
    private readonly forbiddenUrl: string | null = null,
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
    const check = checkForbiddenAppDatabase(this.forbiddenUrl, {
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
        .then((value) => {
          clearTimeout(timer);
          if (timedOut) {
            // We've already rejected — cleanup the pool instead of leaking it.
            void value.destroy().catch(() => undefined);
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
