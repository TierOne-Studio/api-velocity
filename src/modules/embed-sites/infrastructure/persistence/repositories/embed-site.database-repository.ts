import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';
import { EmbedSite } from '../../../domain/entities/embed-site';
import { EmbedSiteRepositoryPort } from '../../../domain/repositories/embed-site.repository.interface';

interface EmbedSiteRow {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  public_key: string;
  allowed_origins: string[];
  enabled: boolean;
  theme: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: EmbedSiteRow): EmbedSite {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    publicKey: row.public_key,
    allowedOrigins: row.allowed_origins,
    enabled: row.enabled,
    theme: row.theme,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Raw-SQL adapter for the embed-site port (repo-conventions §4 fallback):
 * the monthly-cap counter needs an atomic `INSERT ... ON CONFLICT ... DO UPDATE
 * ... RETURNING` that TypeORM cannot cleanly express, and this public channel
 * reuses the `DatabaseService` harness shared with the sibling chat/projects
 * modules. The clean-architecture port (EMBED_SITE_REPOSITORY) is preserved.
 */
@Injectable()
export class EmbedSiteDatabaseRepository implements EmbedSiteRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async findByPublicKey(publicKey: string): Promise<EmbedSite | null> {
    const row = await this.db.queryOne<EmbedSiteRow>(
      `SELECT id, organization_id, project_id, name, public_key,
              allowed_origins, enabled, theme, created_at, updated_at
         FROM embed_site
        WHERE public_key = $1`,
      [publicKey],
    );
    return row ? toDomain(row) : null;
  }

  async incrementMonthlyUsage(organizationId: string): Promise<number> {
    // Atomic upsert-increment: the row lock on (organization_id, window_start)
    // serializes concurrent SSE opens, so RETURNING yields a distinct, correct
    // post-increment count with no read-then-write race. The window is the first
    // day of the current calendar month in UTC (SPEC-003 §9.6).
    const row = await this.db.queryOne<{ request_count: string }>(
      `INSERT INTO embed_usage_counter (organization_id, window_start, request_count)
       VALUES ($1, date_trunc('month', (now() AT TIME ZONE 'utc'))::date, 1)
       ON CONFLICT (organization_id, window_start)
       DO UPDATE SET request_count = embed_usage_counter.request_count + 1
       RETURNING request_count`,
      [organizationId],
    );
    if (!row) {
      throw new Error(
        `incrementMonthlyUsage: usage-counter upsert returned no row for org ${organizationId}`,
      );
    }
    return Number(row.request_count);
  }
}
