export const DOCUMENT_EXTRACTOR = 'DOCUMENT_EXTRACTOR';

/**
 * Port for extracting plain text from an uploaded document blob, dispatching by
 * content type (ADR-015). Lives in `domain/` so the application layer depends on
 * this abstraction, not the PDF/DOCX SDKs (ADR-009).
 *
 * Contract:
 * - UTF-8 text types (`text/plain`, `text/markdown`, `text/csv`,
 *   `application/json`) are decoded directly; a genuinely empty file yields `""`
 *   (a validly "ingested" empty document — ADR-014 failure modes).
 * - Binary types (PDF, DOCX) are parsed to their text content.
 * - THROWS `NonRetryableIngestionError` (a permanent failure, never retried) when:
 *   the content type is unsupported, the blob exceeds the extraction size ceiling,
 *   the parser rejects the bytes (corrupt / mislabelled file), or a binary
 *   document parses to whitespace-only text (e.g. a scanned PDF with no OCR).
 */
export interface IDocumentExtractor {
  extract(body: Buffer, contentType: string): Promise<string>;
}
