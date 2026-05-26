/**
 * Discriminated union for `POST /api/airweave/collections/:id/source-connections`.
 *
 * Two `authentication.kind` branches:
 *  - `direct`: credentials passed inline (API key, password, etc.) — Airweave
 *    creates the connection synchronously and (per `sync_immediately: true`)
 *    kicks off an initial sync. Available now (Step 6).
 *  - `oauth`: returns a `sessionToken` for the frontend to open the Airweave
 *    portal and complete the browser OAuth flow. Available in Step 8.
 *
 * One endpoint, two branches — frontend hits a single URL. Per ADR-011
 * § Decision 9 (discriminated union; KISS).
 */
export interface CreateSourceConnectionBodyDirect {
  name: string;
  shortName: string;
  authentication: {
    kind: 'direct';
    credentials: Record<string, unknown>;
  };
}

/**
 * NOTE — ADR-011 § Amendment 4 (2026-05-26): the OAuth branch was
 * removed from this endpoint. The catalog-widget flow uses
 * `POST /api/airweave/connect/session` instead, and the SDK widget
 * creates the source-connection (with the user's chosen source +
 * credentials) AFTER the user authenticates. Pre-creating a source-
 * connection here was an architectural mistake — see Amendment 4 for
 * the full explanation.
 *
 * Direct auth remains here as an advanced path for users who already
 * have non-OAuth credentials (e.g., a Postgres DSN, a Stripe API key)
 * and want to bypass the widget entirely.
 */
export type CreateSourceConnectionBody = CreateSourceConnectionBodyDirect;

/**
 * Request body for `POST /api/airweave/collections`.
 *
 * The server derives the Airweave `readable_id` from `(orgSlug, slugHint
 * || nameSlug)` — see `AirweaveService.createCollection` and ADR-011 §
 * Decision 3 (idempotent generation enables adopt-on-409 recovery).
 *
 * `slugHint` is optional. When omitted, the readable id is derived from a
 * slugified `name`. When provided, it gives the caller explicit control
 * over the human-readable part of the id (useful for retries that need to
 * land on the same id, and for predictable URL shapes in the UI).
 */
export interface CreateCollectionBody {
  /** Display name shown in the Airweave UI and surfaced to users. */
  name: string;
  /**
   * Optional alphanumeric + dash slug (max 32 chars). When omitted, the
   * server slugifies `name`. Used as the human-readable middle segment
   * of the generated `readable_id`.
   */
  slugHint?: string;
}
