import { Injectable } from '@nestjs/common';
import type { ITextChunker } from '../../domain/text-chunker.port';
import { chunkText } from './chunker';

/**
 * Adapter for {@link ITextChunker} using langchain's RecursiveCharacterTextSplitter
 * (the only place that SDK is imported — ADR-009). Applies the default chunk
 * size/overlap; the parameterised splitting logic lives in the pure `chunkText`.
 */
@Injectable()
export class RecursiveTextChunker implements ITextChunker {
  chunk(text: string): Promise<string[]> {
    return chunkText(text);
  }
}
