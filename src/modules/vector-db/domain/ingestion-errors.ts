/**
 * A permanent ingestion failure: retrying will deterministically fail the same
 * way, so the worker must mark the job terminal in a single attempt rather than
 * burning the retry budget (ADR-015, refining ADR-014 §5). Examples: an
 * unsupported/mislabelled content type, a blob over the extraction size ceiling,
 * a corrupt document the parser rejects, or a binary document that yields no
 * extractable text (scanned PDF, no OCR).
 *
 * The complement — transient failures (network blips, OpenAI/Qdrant errors) —
 * are thrown as plain `Error`s and follow the attempts-based retry path.
 */
export class NonRetryableIngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableIngestionError';
  }
}
