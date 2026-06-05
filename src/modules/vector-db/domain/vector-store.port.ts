export const VECTOR_STORE = 'VECTOR_STORE';

export interface VectorPoint {
  /** Deterministic UUID (see `deterministicPointId`) — makes upserts idempotent. */
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/**
 * Port for the vector store (Qdrant today). Lives in `domain/` so the
 * application layer never imports the Qdrant SDK directly (ADR-009).
 * `search` / `deleteCollection` are intentionally deferred to Slice 6 / the
 * janitor — this port carries only what the ingestion pipeline needs.
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
}
