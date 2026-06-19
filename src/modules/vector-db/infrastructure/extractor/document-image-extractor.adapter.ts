import { Injectable, Logger } from '@nestjs/common';
import mammoth from 'mammoth';
import { extractImages, getDocumentProxy } from 'unpdf';
import type {
  ExtractedImage,
  IDocumentImageExtractor,
} from '../../domain/document-image-extractor.port';
import { PDF_CONTENT_TYPE, DOCX_CONTENT_TYPE } from './extract';
import { rawPixelsToPng } from './png-encoder';

/**
 * Adapter for {@link IDocumentImageExtractor}. The only place unpdf and
 * mammoth image APIs are invoked for image extraction (ADR-009).
 *
 * - Text types (plain, markdown, csv, json) → [].
 * - PDF → per-page embedded-image extraction via unpdf; raw pixels encoded
 *   to PNG via a pure-Node encoder (no native deps).
 * - DOCX → embedded-image extraction via mammoth's convertImage handler.
 * - Failures are caught and logged; the adapter never throws — the ingestion
 *   service treats a zero-length result as "no images found".
 */
@Injectable()
export class DocumentImageExtractorAdapter implements IDocumentImageExtractor {
  private readonly logger = new Logger(DocumentImageExtractorAdapter.name);

  async extract(body: Buffer, contentType: string): Promise<ExtractedImage[]> {
    if (contentType === PDF_CONTENT_TYPE) {
      return this.extractFromPdf(body);
    }
    if (contentType === DOCX_CONTENT_TYPE) {
      return this.extractFromDocx(body);
    }
    return [];
  }

  private async extractFromPdf(body: Buffer): Promise<ExtractedImage[]> {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(body));
      const results: ExtractedImage[] = [];

      for (let page = 1; page <= pdf.numPages; page++) {
        const pageImages = await extractImages(pdf, page);
        for (const img of pageImages) {
          const pngBuffer = rawPixelsToPng(
            img.data,
            img.width,
            img.height,
            img.channels,
          );
          results.push({
            data: pngBuffer,
            mimeType: 'image/png',
            index: results.length,
          });
        }
      }

      return results;
    } catch (error) {
      this.logger.warn(
        `PDF image extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async extractFromDocx(body: Buffer): Promise<ExtractedImage[]> {
    const results: ExtractedImage[] = [];

    try {
      await mammoth.convertToHtml(
        { buffer: body },
        {
          convertImage: mammoth.images.imgElement((image) => {
            return (image as { read: () => Promise<Buffer>; contentType: string })
              .read()
              .then((imgBuffer) => {
                results.push({
                  data: imgBuffer,
                  mimeType: (image as { contentType: string }).contentType || 'image/png',
                  index: results.length,
                });
                return { src: '' };
              });
          }),
        },
      );
    } catch (error) {
      this.logger.warn(
        `DOCX image extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }

    return results;
  }
}
