import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 200;

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

/**
 * Split a document into overlapping chunks for embedding, using langchain's
 * RecursiveCharacterTextSplitter. Whitespace-only / empty input yields no
 * chunks (a validly "ingested" empty document — ADR-014 failure modes).
 *
 * The body is treated as UTF-8 text; no PDF/DOCX extraction in MVP (ADR-014
 * known limitations).
 */
export async function chunkText(
  text: string,
  opts: ChunkOptions = {},
): Promise<string[]> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: opts.chunkSize ?? DEFAULT_CHUNK_SIZE,
    chunkOverlap: opts.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
  });
  return splitter.splitText(trimmed);
}
