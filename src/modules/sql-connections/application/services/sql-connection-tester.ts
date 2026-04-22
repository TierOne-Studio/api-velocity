import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '../../../../shared/config';
import type { SqlSslConfig } from '../../api/dto/sql-connection.dto';

export type TestConnectionInput = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: SqlSslConfig;
};

export type TestConnectionResult =
  | { ok: true }
  | { ok: false; error: string };

@Injectable()
export class SqlConnectionTester {
  constructor(private readonly configService: ConfigService) {}

  async test(input: TestConnectionInput): Promise<TestConnectionResult> {
    const timeoutMs = this.configService.getSqlAgentConnectTimeoutMs();
    const ds = new DataSource({
      type: 'postgres',
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      password: input.password,
      ssl: input.ssl ?? false,
      synchronize: false,
      entities: [],
      extra: { max: 1 },
    });

    let cleanup = async () => {
      if (ds.isInitialized) {
        await ds.destroy().catch(() => undefined);
      }
    };

    try {
      await this.initWithTimeout(ds, timeoutMs);
      await ds.transaction(async (tx) => {
        await tx.query('SET TRANSACTION READ ONLY');
        await tx.query('SELECT 1');
      });
      await cleanup();
      cleanup = async () => undefined;
      return { ok: true };
    } catch (error) {
      await cleanup();
      return { ok: false, error: sanitizeError(error) };
    }
  }

  /**
   * Wraps `ds.initialize()` with a timeout. If the timer fires first, we
   * still observe the in-flight initialization so a late success can be
   * destroyed instead of leaking its underlying connection pool.
   */
  private initWithTimeout(ds: DataSource, ms: number): Promise<DataSource> {
    return new Promise<DataSource>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('connect timeout'));
      }, ms);
      ds.initialize()
        .then((value) => {
          clearTimeout(timer);
          if (timedOut) {
            void value.destroy().catch(() => undefined);
            return;
          }
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          if (timedOut) return;
          reject(error);
        });
    });
  }
}

export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Strip query strings that might embed credentials or values from the LLM.
  return raw.replace(/password=[^\s&]+/gi, 'password=***').slice(0, 500);
}
