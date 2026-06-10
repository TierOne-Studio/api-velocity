export type EmbedBatchFn = (texts: string[]) => Promise<number[][]>;

export interface BatchEmbedOptions {
  batchSize: number;
  concurrency: number;
}

/**
 * Embed `texts` in bounded batches with bounded concurrency, preserving input
 * order in the output (ADR-014 §8 — respect OpenAI rate limits; never fan out
 * one request per chunk). Pure: the actual embedding call is injected, so the
 * batching/concurrency logic is unit-tested without the OpenAI SDK.
 */
export async function batchEmbed(
  texts: string[],
  opts: BatchEmbedOptions,
  embedBatch: EmbedBatchFn,
): Promise<number[][]> {
  // Fail fast on misconfiguration: batchSize < 1 would never advance the batch
  // loop (infinite loop / OOM) and concurrency < 1 would spawn zero workers and
  // silently return wrong-length output. Both come from config — surface the bad
  // value instead of hanging or corrupting results.
  if (!Number.isInteger(opts.batchSize) || opts.batchSize < 1) {
    throw new RangeError(
      `batchEmbed: batchSize must be a positive integer, got ${opts.batchSize}`,
    );
  }
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
    throw new RangeError(
      `batchEmbed: concurrency must be a positive integer, got ${opts.concurrency}`,
    );
  }

  if (texts.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += opts.batchSize) {
    batches.push(texts.slice(i, i + opts.batchSize));
  }

  const results: number[][][] = new Array(batches.length);
  let nextIndex = 0;
  const workerCount = Math.min(opts.concurrency, batches.length);

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= batches.length) return;
      results[index] = await embedBatch(batches[index]);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results.flat();
}
