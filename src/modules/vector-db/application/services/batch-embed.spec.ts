import { batchEmbed, type EmbedBatchFn } from './batch-embed';

describe('batchEmbed', () => {
  it('returns an empty array for no texts without calling the embedder', async () => {
    let called = false;
    const embed: EmbedBatchFn = async (texts) => {
      called = true;
      return texts.map(() => [0]);
    };
    const out = await batchEmbed([], { batchSize: 10, concurrency: 2 }, embed);
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });

  it('splits texts into batches of batchSize', async () => {
    const seen: string[][] = [];
    const embed: EmbedBatchFn = async (texts) => {
      seen.push(texts);
      return texts.map(() => [0]);
    };
    await batchEmbed(['a', 'b', 'c', 'd', 'e'], { batchSize: 2, concurrency: 1 }, embed);
    expect(seen).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('preserves overall order regardless of batch completion order', async () => {
    // First batch resolves slower than the second — output must still be in input order.
    const embed: EmbedBatchFn = async (texts) => {
      const delay = texts[0] === 'a' ? 30 : 0;
      await new Promise((r) => setTimeout(r, delay));
      return texts.map((t) => [t.charCodeAt(0)]);
    };
    const out = await batchEmbed(['a', 'b', 'c', 'd'], { batchSize: 2, concurrency: 2 }, embed);
    expect(out).toEqual([[97], [98], [99], [100]]);
  });

  it('never runs more than `concurrency` batches at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const embed: EmbedBatchFn = async (texts) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return texts.map(() => [0]);
    };
    // 6 batches of 1, concurrency 2.
    await batchEmbed(['a', 'b', 'c', 'd', 'e', 'f'], { batchSize: 1, concurrency: 2 }, embed);
    expect(maxInFlight).toBe(2);
  });

  it('returns one vector per input text', async () => {
    const embed: EmbedBatchFn = async (texts) => texts.map((_, i) => [i]);
    const out = await batchEmbed(['a', 'b', 'c'], { batchSize: 2, concurrency: 2 }, embed);
    expect(out).toHaveLength(3);
  });
});
