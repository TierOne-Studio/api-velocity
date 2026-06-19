import { Injectable } from '@nestjs/common';
import {
  ExtractedImage,
  IDocumentImageExtractor,
} from '../../domain/document-image-extractor.port';

/**
 * No-op adapter used when IMAGE_EXTRACTION_ENABLED is false or ANTHROPIC_API_KEY
 * is unset. Always returns an empty array so the ingestion pipeline produces
 * zero image chunks, preserving all existing text-only behavior.
 */
@Injectable()
export class NoopDocumentImageExtractorAdapter
  implements IDocumentImageExtractor
{
  extract(_body: Buffer, _contentType: string): Promise<ExtractedImage[]> {
    return Promise.resolve([]);
  }
}
