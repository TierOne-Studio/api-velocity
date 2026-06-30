import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';
import { EmbedSite } from '../../../domain/entities/embed-site';
import {
  CreateEmbedSiteData,
  EmbedSiteProjectConflictError,
  EmbedSitePublicKeyCollisionError,
  EmbedSiteRepositoryPort,
  UpdateEmbedSiteData,
} from '../../../domain/repositories/embed-site.repository.interface';

// Column projection reused by every SELECT/RETURNING so the row→domain mapping
// stays in lockstep with the table shape.
const EMBED_SITE_COLUMNS = `id, organization_id, project_id, name, public_key,
        allowed_origins, enabled, theme, created_at, updated_at`;

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
      `SELECT ${EMBED_SITE_COLUMNS}
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

  async findById(
    id: string,
    organizationId: string,
  ): Promise<EmbedSite | null> {
    const row = await this.db.queryOne<EmbedSiteRow>(
      `SELECT ${EMBED_SITE_COLUMNS}
         FROM embed_site
        WHERE id = $1 AND organization_id = $2`,
      [id, organizationId],
    );
    return row ? toDomain(row) : null;
  }

  async listByOrg(organizationId: string): Promise<EmbedSite[]> {
    const rows = await this.db.query<EmbedSiteRow>(
      `SELECT ${EMBED_SITE_COLUMNS}
         FROM embed_site
        WHERE organization_id = $1
        ORDER BY created_at DESC`,
      [organizationId],
    );
    return rows.map(toDomain);
  }

  async create(data: CreateEmbedSiteData): Promise<EmbedSite> {
    try {
      const row = await this.db.queryOne<EmbedSiteRow>(
        `INSERT INTO embed_site
           (id, organization_id, project_id, name, public_key, allowed_origins, theme)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING ${EMBED_SITE_COLUMNS}`,
        [
          data.id,
          data.organizationId,
          data.projectId,
          data.name,
          data.publicKey,
          data.allowedOrigins,
          data.theme === null ? null : JSON.stringify(data.theme),
        ],
      );
      if (!row) throw new Error('embed_site insert returned no row');
      return toDomain(row);
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }
  }

  async update(
    id: string,
    organizationId: string,
    patch: UpdateEmbedSiteData,
  ): Promise<EmbedSite | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (patch.name !== undefined) {
      sets.push(`name = $${i++}`);
      params.push(patch.name);
    }
    if (patch.allowedOrigins !== undefined) {
      sets.push(`allowed_origins = $${i++}`);
      params.push(patch.allowedOrigins);
    }
    if (patch.enabled !== undefined) {
      sets.push(`enabled = $${i++}`);
      params.push(patch.enabled);
    }
    if (patch.theme !== undefined) {
      sets.push(`theme = $${i++}::jsonb`);
      params.push(patch.theme === null ? null : JSON.stringify(patch.theme));
    }
    // No mutable fields supplied — return the current row (org-scoped) so the
    // caller still distinguishes "not found" (null) from "no-op update".
    if (sets.length === 0) {
      return this.findById(id, organizationId);
    }
    sets.push(`updated_at = NOW()`);
    const idParam = i++;
    const orgParam = i;
    params.push(id, organizationId);
    try {
      const row = await this.db.queryOne<EmbedSiteRow>(
        `UPDATE embed_site SET ${sets.join(', ')}
          WHERE id = $${idParam} AND organization_id = $${orgParam}
        RETURNING ${EMBED_SITE_COLUMNS}`,
        params,
      );
      return row ? toDomain(row) : null;
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }
  }

  async rotateKey(
    id: string,
    organizationId: string,
    newPublicKey: string,
  ): Promise<EmbedSite | null> {
    try {
      const row = await this.db.queryOne<EmbedSiteRow>(
        `UPDATE embed_site SET public_key = $1, updated_at = NOW()
          WHERE id = $2 AND organization_id = $3
        RETURNING ${EMBED_SITE_COLUMNS}`,
        [newPublicKey, id, organizationId],
      );
      return row ? toDomain(row) : null;
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM embed_site
        WHERE id = $1 AND organization_id = $2
       RETURNING id`,
      [id, organizationId],
    );
    return rows.length > 0;
  }

  // Translate a Postgres unique-violation (23505) on the embed_site indexes into
  // the domain-specific errors the service knows how to handle: project conflict
  // → 409, public-key collision → regenerate+retry. No-op for other errors.
  private rethrowUniqueViolation(err: unknown): void {
    const e = err as { code?: string; constraint?: string; message?: string };
    if (e?.code !== '23505') return;
    const marker = e.constraint ?? e.message ?? '';
    if (marker.includes('uq_embed_site_project')) {
      throw new EmbedSiteProjectConflictError(
        'An embed site already exists for this project',
      );
    }
    if (marker.includes('uq_embed_site_public_key')) {
      throw new EmbedSitePublicKeyCollisionError('Public key collision');
    }
  }
}
