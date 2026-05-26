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

export interface CreateSourceConnectionBodyOAuth {
  name: string;
  /** Airweave source type identifier (e.g. 'slack', 'notion'). Used as
   *  both the SDK `short_name` field and the source the OAuth flow targets. */
  shortName: string;
  authentication: {
    kind: 'oauth';
    /**
     * BYOC (Bring Your Own Client) fields — forwarded verbatim to
     * Airweave's `OAuthBrowserAuthentication` schema. Required when the
     * source has `requires_byoc: true` (e.g., the shared Airweave
     * account does not have a pre-configured OAuth app for this
     * provider). Optional otherwise.
     *
     * All five are pass-through secrets. We do NOT persist them on our
     * side — Airweave stores them tied to the source-connection. See
     * ADR-011 § Amendment 3 (2026-05-26).
     */
    /** OAuth2 client id (custom app). */
    clientId?: string;
    /** OAuth2 client secret (custom app). */
    clientSecret?: string;
    /** OAuth1 consumer key (custom app). */
    consumerKey?: string;
    /** OAuth1 consumer secret (custom app). */
    consumerSecret?: string;
    /** Optional override of the OAuth redirect URI (Airweave's default
     *  is the Connect widget origin; rarely needed). */
    redirectUri?: string;
  };
}

export type CreateSourceConnectionBody =
  | CreateSourceConnectionBodyDirect
  | CreateSourceConnectionBodyOAuth;

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
