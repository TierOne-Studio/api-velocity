import { chunkText } from './chunker';

describe('chunkText', () => {
  it('returns no chunks for an empty string', async () => {
    expect(await chunkText('')).toEqual([]);
  });

  it('returns no chunks for whitespace-only input', async () => {
    expect(await chunkText('   \n\t  ')).toEqual([]);
  });

  it('returns a single chunk for text shorter than the chunk size', async () => {
    const chunks = await chunkText('a short document', { chunkSize: 1000 });
    expect(chunks).toEqual(['a short document']);
  });

  it('splits long text into multiple chunks bounded by chunk size', async () => {
    const text = Array.from({ length: 50 }, (_, i) => `sentence number ${i}.`).join(' ');
    const chunks = await chunkText(text, { chunkSize: 100, chunkOverlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('covers the whole document across chunks (no content dropped)', async () => {
    const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const chunks = await chunkText(text, { chunkSize: 40, chunkOverlap: 0 });
    for (let i = 0; i < 30; i++) {
      expect(chunks.some((c) => c.includes(`word${i}`))).toBe(true);
    }
  });
});
