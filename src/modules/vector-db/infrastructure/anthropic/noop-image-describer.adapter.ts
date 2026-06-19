import { Injectable } from '@nestjs/common';
import { IImageDescriber } from '../../domain/image-describer.port';

/**
 * No-op adapter used when IMAGE_EXTRACTION_ENABLED is false or ANTHROPIC_API_KEY
 * is unset. The ingestion service treats a noop describer as "feature disabled":
 * it will never call describe() because the image extractor also returns [].
 * Provided so the DI graph compiles cleanly without the real Anthropic SDK.
 */
@Injectable()
export class NoopImageDescriberAdapter implements IImageDescriber {
  describe(_imageBuffer: Buffer, _mimeType: string): Promise<string> {
    return Promise.resolve('');
  }
}
