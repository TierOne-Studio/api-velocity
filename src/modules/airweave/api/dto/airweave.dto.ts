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
