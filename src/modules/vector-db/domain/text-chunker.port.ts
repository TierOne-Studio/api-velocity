export const TEXT_CHUNKER = 'TEXT_CHUNKER';

/**
 * Port for splitting a document into embeddable chunks. Lives in `domain/` so
 * the application layer depends on this abstraction, not the langchain splitter
 * SDK (ADR-009). Empty/whitespace input yields no chunks.
 */
export interface ITextChunker {
  chunk(text: string): Promise<string[]>;
}
