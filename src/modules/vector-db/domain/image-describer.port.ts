export const IMAGE_DESCRIBER = 'IMAGE_DESCRIBER';

/**
 * Port for generating a natural-language description of a single image via a
 * vision-capable LLM (Claude today). Lives in `domain/` so the application
 * layer never imports the Anthropic SDK directly (ADR-009).
 *
 * Returns a plain-text description suitable for embedding alongside text
 * chunks in the vector store. The adapter is responsible for enforcing any
 * model-specific token or image-size limits.
 */
export interface IImageDescriber {
  describe(imageBuffer: Buffer, mimeType: string): Promise<string>;
}
