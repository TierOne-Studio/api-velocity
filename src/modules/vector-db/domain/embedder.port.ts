export const EMBEDDER = 'EMBEDDER';

/**
 * Port for the embeddings provider (OpenAI today). Lives in `domain/` so the
 * application layer never imports the embeddings SDK directly (ADR-009).
 */
export interface IEmbedder {
  /** Embed texts, preserving order. One vector per input text. */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * The vector dimension this embedder produces. Used to create the Qdrant
   * collection (ADR-014 §6) — the single source of the dimension so a model
   * swap can't silently mismatch an existing collection.
   */
  dimensions(): number;
}
