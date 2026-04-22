import { DataSource } from 'typeorm';
import type { ResolvedSqlConnection, SqlLimits } from './types';

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

    this.assertNotAppDatabase(connection);

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
    if (!this.forbiddenUrl) return;
    try {
      const url = new URL(this.forbiddenUrl);
      const host = url.hostname;
      const port = Number(url.port || '5432');
      const database = url.pathname.replace(/^\//, '');
      if (
        host === connection.host &&
        port === connection.port &&
        database === connection.database
      ) {
        throw new Error(
          'Refusing to connect to the application database via a user SQL connection',
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Refusing')) {
        throw error;
      }
      // Malformed DATABASE_URL: we do not enforce the check, fail-open is acceptable.
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
