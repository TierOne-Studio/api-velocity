import { Injectable, Logger } from '@nestjs/common';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import type { IDocumentExtractor } from '../../domain/document-extractor.port';
import { NonRetryableIngestionError } from '../../domain/ingestion-errors';
import { VECTOR_DB_MAX_UPLOAD_SIZE } from '../../vector-db.constants';
import {
  EXTRACTION_TIMEOUT_MS,
  PDF_CONTENT_TYPE,
  assertExtractable,
  assertWithinOutputLimit,
  isBinaryDocType,
  isUtf8TextType,
  withTimeout,
} from './extract';

/**
 * Adapter for {@link IDocumentExtractor}. The only place the unpdf / mammoth SDKs
 * are imported (ADR-009). Dispatches on the (DB-stored) content type:
 * - UTF-8 text types → decode directly.
 * - PDF → unpdf; DOCX → mammoth.
 * - Anything else → permanent failure.
 *
 * Oversize blobs, unsupported types, parser rejections (corrupt / mislabelled
 * files), and binary documents that yield no text are all mapped to
 * {@link NonRetryableIngestionError} so the worker fails them terminally in a
 * single attempt rather than burning the retry budget on a deterministic
 * failure (ADR-015).
 */
@Injectable()
export class DocumentExtractorAdapter implements IDocumentExtractor {
  private readonly logger = new Logger(DocumentExtractorAdapter.name);

  async extract(body: Buffer, contentType: string): Promise<string> {
    if (body.length > VECTOR_DB_MAX_UPLOAD_SIZE) {
      throw new NonRetryableIngestionError(
        `document exceeds extraction size limit (${body.length} > ${VECTOR_DB_MAX_UPLOAD_SIZE} bytes)`,
      );
    }

    if (isUtf8TextType(contentType)) {
      return body.toString('utf-8');
    }

    if (!isBinaryDocType(contentType)) {
      throw new NonRetryableIngestionError(
        `unsupported content type for extraction: ${contentType || '(none)'}`,
      );
    }

    const text = await withTimeout(
      this.parseBinary(body, contentType),
      EXTRACTION_TIMEOUT_MS,
      `${contentType} extraction`,
    );
    assertExtractable(text, contentType);
    return text;
  }

  /**
   * Parse a binary document, mapping any parser rejection to a permanent failure.
   * The raw parser message is kept to the server log only — the persisted /
   * user-visible failure carries a fixed, non-leaking message (ADR-015).
   */
  private async parseBinary(
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    let text: string;
    try {
      if (contentType === PDF_CONTENT_TYPE) {
        const pdf = await getDocumentProxy(new Uint8Array(body));
        text = (await extractText(pdf, { mergePages: true })).text;
      } else {
        text = (await mammoth.extractRawText({ buffer: body })).value;
      }
    } catch (error) {
      if (error instanceof NonRetryableIngestionError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`failed to parse ${contentType} document: ${reason}`);
      throw new NonRetryableIngestionError(
        `failed to parse ${contentType} document`,
      );
    }
    assertWithinOutputLimit(text);
    return text;
  }
}
