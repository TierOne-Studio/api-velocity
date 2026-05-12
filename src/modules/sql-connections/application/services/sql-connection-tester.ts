import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '../../../../shared/config';
import { scrubCredentials } from '../../../../shared/security/credential-scrubber';
import { assertSafeAgentHost } from '../../../../shared/security/host-validator';
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
    // SSRF guard: refuse to dial a host that resolves to a private,
    // loopback, link-local, or cloud-metadata address (C1+S3). Runs before
    // any connection attempt so a malicious caller can't probe internal
    // services via timing or error-shape signals.
    try {
      await assertSafeAgentHost(input.host);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

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
        .then(async (value) => {
          clearTimeout(timer);
          if (timedOut) {
            // M1: await the destroy and log if it fails. The outer caller
            // has already rejected with 'connect timeout' and moved on;
            // they can't be made to wait, but the destroy MUST complete
            // (or visibly fail) so a late-init DataSource doesn't leak
            // its pool. Silently swallowing the error was the gap.
            try {
              await value.destroy();
            } catch (destroyErr) {
              console.warn(
                '[SqlConnectionTester] late-init destroy after timeout failed:',
                destroyErr instanceof Error
                  ? destroyErr.message
                  : String(destroyErr),
              );
            }
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
  // Security MED-9: delegate to the shared `scrubCredentials` helper so
  // both the chat-to-SQL error sanitizer and this tester path apply the
  // same patterns (the tester used to only strip `password=...`,
  // leaving URL-form `postgres://user:pass@host/db` credentials in
  // `status_error` visible to operators in the SPA admin UI).
  const raw = err instanceof Error ? err.message : String(err);
  return scrubCredentials(raw).slice(0, 500);
}
