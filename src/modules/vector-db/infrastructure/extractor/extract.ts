import { NonRetryableIngestionError } from '../../domain/ingestion-errors';

export const PDF_CONTENT_TYPE = 'application/pdf';
export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Content types decoded directly as UTF-8 text. An explicit allow-list (not
 * "anything not binary") so an unknown type falls through to a hard failure
 * rather than being silently chunked as mojibake — the exact bug ADR-015 fixes.
 */
const UTF8_TEXT_TYPES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

const BINARY_DOC_TYPES: ReadonlySet<string> = new Set([
  PDF_CONTENT_TYPE,
  DOCX_CONTENT_TYPE,
]);

/**
 * Wall-clock bound on a single binary parse (ADR-015 §"Negative" — DoS guard).
 * Untrusted PDF/DOCX can drive pdf.js / mammoth into pathological CPU time; a
 * parse past this is treated as a permanent failure so one malicious upload
 * cannot pin a worker slot indefinitely.
 */
export const EXTRACTION_TIMEOUT_MS = 30_000;

/**
 * Ceiling on extracted-text length from a binary document (ADR-015 §"Negative" —
 * decompression-bomb guard). A small DOCX zip can inflate to vast XML; this
 * bounds the downstream blast radius (memory + embedding spend). Sized well
 * above any legitimate document within the upload cap. Text uploads are exempt:
 * they are already bounded by `VECTOR_DB_MAX_UPLOAD_SIZE` at the input.
 */
export const MAX_EXTRACTED_TEXT_CHARS = 50_000_000;

export function isUtf8TextType(contentType: string): boolean {
  return UTF8_TEXT_TYPES.has(contentType);
}

export function isBinaryDocType(contentType: string): boolean {
  return BINARY_DOC_TYPES.has(contentType);
}

/**
 * Guard the post-parse text. A binary document (PDF/DOCX) that yields only
 * whitespace is a permanent failure — most often a scanned/image-only PDF with
 * no OCR — so the user is told plainly rather than seeing the KB go `ready` with
 * nothing searchable. UTF-8 text types are exempt: an empty `.txt` is a validly
 * ingested empty document (ADR-014).
 */
export function assertExtractable(text: string, contentType: string): void {
  if (isBinaryDocType(contentType) && text.trim().length === 0) {
    throw new NonRetryableIngestionError(
      `no extractable text from ${contentType} document (scanned PDF? OCR is not supported)`,
    );
  }
}

/**
 * Reject extracted output beyond {@link MAX_EXTRACTED_TEXT_CHARS} (decompression
 * bomb / runaway extraction). A permanent failure — retrying yields the same
 * oversized output.
 */
export function assertWithinOutputLimit(text: string): void {
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new NonRetryableIngestionError(
      `extracted text exceeds the ${MAX_EXTRACTED_TEXT_CHARS}-character limit`,
    );
  }
}

/**
 * Bound a parse promise by a wall-clock timeout, rejecting with a
 * {@link NonRetryableIngestionError} if it does not settle in time. Note: this
 * stops the worker *waiting* (freeing the job slot to fail fast); it does not
 * abort the underlying SDK work, which pdf.js / mammoth do not support
 * cancelling. True cancellation (a terminable worker-thread sandbox) is a
 * tracked ADR-015 follow-up; a worker memory limit bounds orphaned work.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new NonRetryableIngestionError(`${label} timed out after ${ms}ms`),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
