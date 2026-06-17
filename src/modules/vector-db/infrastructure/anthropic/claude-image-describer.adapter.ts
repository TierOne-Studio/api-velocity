import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '../../../../shared/config/config.service';
import { IImageDescriber } from '../../domain/image-describer.port';

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const DESCRIBE_PROMPT =
  'Describe the content of this image in detail for use in a knowledge base search system. ' +
  'Focus on key concepts, any visible text, charts, diagrams, or main visual elements. ' +
  'Be concise but comprehensive.';

/**
 * Claude Vision adapter for {@link IImageDescriber}. The only place the
 * Anthropic SDK is imported (ADR-009). Only instantiated when both
 * IMAGE_EXTRACTION_ENABLED=true and ANTHROPIC_API_KEY are set.
 */
@Injectable()
export class ClaudeImageDescriberAdapter implements IImageDescriber {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.getAnthropicApiKey();
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required for Claude image description',
      );
    }
    this.client = new Anthropic({ apiKey });
    this.model = config.getImageExtractionModel();
  }

  async describe(imageBuffer: Buffer, mimeType: string): Promise<string> {
    const resolvedMime = SUPPORTED_MIME_TYPES.has(mimeType)
      ? mimeType
      : 'image/jpeg';

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: resolvedMime as
                  | 'image/jpeg'
                  | 'image/png'
                  | 'image/gif'
                  | 'image/webp',
                data: imageBuffer.toString('base64'),
              },
            },
            { type: 'text', text: DESCRIBE_PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return '';
    }
    return textBlock.text;
  }
}
