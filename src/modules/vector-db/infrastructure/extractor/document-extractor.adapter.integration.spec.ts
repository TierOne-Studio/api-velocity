import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocumentExtractorAdapter } from './document-extractor.adapter';
import { PDF_CONTENT_TYPE, DOCX_CONTENT_TYPE } from './extract';
import { NonRetryableIngestionError } from '../../domain/ingestion-errors';
import { VECTOR_DB_MAX_UPLOAD_SIZE } from '../../vector-db.constants';

// Real unpdf + mammoth parsing against committed fixtures. No network or
// external service — runs everywhere (unlike the *.integration.spec.ts files
// that gate on DATABASE_URL/QDRANT_URL). This is the binding acceptance proof
// that PDF/DOCX text is actually extracted (ADR-015).

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

describe('DocumentExtractorAdapter (real PDF/DOCX parsing)', () => {
  const adapter = new DocumentExtractorAdapter();

  // Non-vacuity guard: the fixtures are COMPRESSED (PDF FlateDecode, DOCX
  // DEFLATE), so the marker text is absent from the raw bytes. A raw-UTF-8
  // decode — the exact bug ADR-015 fixes — therefore cannot contain the marker.
  // If a future fixture regressed to uncompressed, these guards fail and the
  // extraction assertions below would become vacuous.
  it('the PDF fixture does not contain the marker in raw bytes (guards non-vacuity)', () => {
    expect(fixture('sample.pdf').toString('utf-8')).not.toContain(
      'Velocity ingestion smoke test',
    );
  });

  it('the DOCX fixture does not contain the marker in raw bytes (guards non-vacuity)', () => {
    expect(fixture('sample.docx').toString('utf-8')).not.toContain(
      'Velocity DOCX ingestion smoke test',
    );
  });

  it('extracts text from a real PDF (only the parser can surface the marker)', async () => {
    const text = await adapter.extract(fixture('sample.pdf'), PDF_CONTENT_TYPE);
    expect(text).toContain('Velocity ingestion smoke test');
  });

  it('extracts text from a real DOCX (only the parser can surface the marker)', async () => {
    const text = await adapter.extract(
      fixture('sample.docx'),
      DOCX_CONTENT_TYPE,
    );
    expect(text).toContain('Velocity DOCX ingestion smoke test');
  });

  it('fails a PDF that yields no text (scanned / image-only) as non-retryable', async () => {
    await expect(
      adapter.extract(fixture('empty.pdf'), PDF_CONTENT_TYPE),
    ).rejects.toBeInstanceOf(NonRetryableIngestionError);
  });

  it('maps a corrupt / mislabelled PDF to a non-retryable failure with a sanitized message', async () => {
    const garbage = Buffer.from('this is plainly not a pdf at all');
    const error = await adapter
      .extract(garbage, PDF_CONTENT_TYPE)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NonRetryableIngestionError);
    // The persisted/user-visible message must not leak raw parser internals.
    expect((error as Error).message).toBe(
      'failed to parse application/pdf document',
    );
  });

  it('decodes UTF-8 text types directly without a parser', async () => {
    const body = Buffer.from('line one\nline two', 'utf-8');
    await expect(adapter.extract(body, 'text/plain')).resolves.toBe(
      'line one\nline two',
    );
  });

  it('returns "" for a genuinely empty text file (ADR-014 empty = valid)', async () => {
    await expect(adapter.extract(Buffer.from(''), 'text/plain')).resolves.toBe(
      '',
    );
  });

  it('rejects an unsupported content type as non-retryable', async () => {
    await expect(
      adapter.extract(Buffer.from('x'), 'application/octet-stream'),
    ).rejects.toBeInstanceOf(NonRetryableIngestionError);
  });

  it('rejects a blob over the extraction size ceiling as non-retryable', async () => {
    const oversized = Buffer.alloc(VECTOR_DB_MAX_UPLOAD_SIZE + 1);
    await expect(
      adapter.extract(oversized, PDF_CONTENT_TYPE),
    ).rejects.toBeInstanceOf(NonRetryableIngestionError);
  });
});
