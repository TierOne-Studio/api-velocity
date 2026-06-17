export const DOCUMENT_IMAGE_EXTRACTOR = 'DOCUMENT_IMAGE_EXTRACTOR';

/** A single image extracted from a document. */
export interface ExtractedImage {
  data: Buffer;
  mimeType: string;
  /** Zero-based position index within the document (page order for PDF, embed order for DOCX). */
  index: number;
}

/**
 * Port for extracting raw image bytes from a document blob (PDF, DOCX).
 * Lives in `domain/` so the application layer never imports pdfjs-dist or
 * mammoth directly (ADR-009).
 *
 * Returns an empty array for:
 * - Content types that carry no embedded images (plain text, CSV, JSON, Markdown).
 * - Documents that parse correctly but contain no images.
 *
 * Never throws for empty/image-free documents — those are handled as zero
 * extracted images by the ingestion service.
 */
export interface IDocumentImageExtractor {
  extract(body: Buffer, contentType: string): Promise<ExtractedImage[]>;
}
