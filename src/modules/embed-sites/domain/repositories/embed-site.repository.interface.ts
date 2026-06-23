import { EmbedSite } from '../entities/embed-site';

/**
 * Data to persist a new embed site. `organizationId`/`projectId` are resolved
 * server-side (never from the client body); `publicKey` is generated server-side
 * (SPEC-003 §4). All origins are already normalized by the service on write.
 */
export interface CreateEmbedSiteData {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  publicKey: string;
  allowedOrigins: string[];
  theme: Record<string, unknown> | null;
}

/** Partial admin update. Absent fields are left unchanged. */
export interface UpdateEmbedSiteData {
  name?: string;
  allowedOrigins?: string[];
  enabled?: boolean;
  theme?: Record<string, unknown> | null;
}

/**
 * Thrown by the adapter when an INSERT/UPDATE collides with
 * `uq_embed_site_public_key`. The service regenerates the key and retries
 * (bounded) — a publishable key collision is astronomically unlikely (≥128-bit
 * CSPRNG) but handled rather than surfaced as a 500.
 */
export class EmbedSitePublicKeyCollisionError extends Error {}

/**
 * Thrown by the adapter when a create collides with `uq_embed_site_project`
 * (a site already exists for that project — the 1:1 invariant, SPEC-003 §9.1).
 * The service maps it to a 409.
 */
export class EmbedSiteProjectConflictError extends Error {}

/**
 * Port for embed-site persistence (clean-architecture domain interface).
 * `findByPublicKey` is the anonymous public hot path (NOT org-scoped — the key
 * IS the scope resolver, ADR-018). Every admin method is org-scoped
 * (defense-in-depth, repo-conventions §3): a row in another org is invisible,
 * so cross-org reads/writes resolve to null/false and the service returns 404.
 */
export interface EmbedSiteRepositoryPort {
  findByPublicKey(publicKey: string): Promise<EmbedSite | null>;

  incrementMonthlyUsage(organizationId: string): Promise<number>;

  // --- Admin CRUD (Slice 2) — all org-scoped ---

  findById(id: string, organizationId: string): Promise<EmbedSite | null>;

  listByOrg(organizationId: string): Promise<EmbedSite[]>;

  /**
   * Insert a new embed site. Throws {@link EmbedSiteProjectConflictError} if the
   * project already has a site, or {@link EmbedSitePublicKeyCollisionError} on a
   * public-key collision (the service regenerates + retries the latter).
   */
  create(data: CreateEmbedSiteData): Promise<EmbedSite>;

  /** Patch an org-scoped site. Returns null if no such site in the org. */
  update(
    id: string,
    organizationId: string,
    patch: UpdateEmbedSiteData,
  ): Promise<EmbedSite | null>;

  /**
   * Replace the public key of an org-scoped site. Returns null if no such site
   * in the org. Throws {@link EmbedSitePublicKeyCollisionError} on collision.
   */
  rotateKey(
    id: string,
    organizationId: string,
    newPublicKey: string,
  ): Promise<EmbedSite | null>;

  /** Delete an org-scoped site. Returns true if a row was removed. */
  delete(id: string, organizationId: string): Promise<boolean>;
}

export const EMBED_SITE_REPOSITORY = Symbol('EMBED_SITE_REPOSITORY');
