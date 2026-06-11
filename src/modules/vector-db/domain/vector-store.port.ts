export const VECTOR_STORE = 'VECTOR_STORE';

export interface VectorPoint {
  /** Deterministic UUID (see `deterministicPointId`) — makes upserts idempotent. */
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface VectorSearchHit {
  id: string;
  /** Similarity score (cosine) — higher is more relevant. */
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Port for the vector store (Qdrant today). Lives in `domain/` so the
 * application layer never imports the Qdrant SDK directly (ADR-009).
 * `deleteCollection` is still deferred to the janitor — this port carries the
 * ingestion pipeline's needs plus `search` (Slice 6 retrieval lane).
 */
export interface IVectorStore {
  /**
   * Idempotently ensure a collection exists with the given vector dimensions.
   * A no-op when the collection already exists.
   */
  ensureCollection(ref: string, dimensions: number): Promise<void>;

  /**
   * Upsert points into a collection. Deterministic point IDs mean a retried
   * job overwrites the same points instead of duplicating them (ADR-014 §3).
   */
  upsert(ref: string, points: VectorPoint[]): Promise<void>;

  /**
   * Top-`limit` nearest points to `vector` in the collection, with payloads.
   * Returns `[]` for an empty collection. Throws if the collection does not
   * exist — callers must only search collections known to be `ready`.
   */
  search(
    ref: string,
    vector: number[],
    limit: number,
  ): Promise<VectorSearchHit[]>;
}
