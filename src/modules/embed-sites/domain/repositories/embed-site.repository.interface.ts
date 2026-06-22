import { EmbedSite } from '../entities/embed-site';

/**
 * Port for embed-site persistence (clean-architecture domain interface).
 * Slice 1 (the public ask channel) needs only the two public-path operations;
 * admin CRUD methods are added in Slice 2.
 */
export interface EmbedSiteRepositoryPort {
  /**
   * Resolve an embed site by its publishable key. Intentionally NOT org-scoped:
   * the key IS the scope resolver for the anonymous public channel (ADR-018).
   * Every downstream query then re-scopes by the returned org/project.
   */
  findByPublicKey(publicKey: string): Promise<EmbedSite | null>;

  /**
   * Atomically increment the org's request counter for the current monthly
   * window and return the post-increment count. Durable (survives restarts) and
   * race-free under concurrent calls — the spend backstop of SPEC-003 §6/§9.6.
   */
  incrementMonthlyUsage(organizationId: string): Promise<number>;
}

export const EMBED_SITE_REPOSITORY = Symbol('EMBED_SITE_REPOSITORY');
