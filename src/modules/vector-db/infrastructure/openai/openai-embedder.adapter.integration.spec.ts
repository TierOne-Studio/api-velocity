// Integration spec for OpenAiEmbedderAdapter — calls the REAL OpenAI
// embeddings API, NOT a mock.
//
// SETUP CONTRACT:
// - OPENAI_API_KEY must be set (loaded via dotenv by config import). If
//   missing, every test here is SKIPPED so unit-only CI stays green.
// - Kept to a SINGLE short string to minimise embedding spend.
//
// WHY: the bounded-batch logic is unit-tested in batch-embed.spec.ts. The one
// thing only a live call proves is that dimensions() matches the model's ACTUAL
// output vector length — if it doesn't, the Qdrant collection is created with
// the wrong size and every upsert fails (ADR-014 §6).

import { OpenAiEmbedderAdapter } from './openai-embedder.adapter';
import { ConfigService } from '../../../../shared/config/config.service';

const describeIfOpenAi = process.env.OPENAI_API_KEY ? describe : describe.skip;

describeIfOpenAi('OpenAiEmbedderAdapter (integration)', () => {
  it('returns a vector whose length equals dimensions()', async () => {
    const adapter = new OpenAiEmbedderAdapter(new ConfigService());
    const [vector] = await adapter.embed(['hello']);
    expect(vector).toHaveLength(adapter.dimensions());
  }, 30_000);

  it('returns one vector per input text in order', async () => {
    const adapter = new OpenAiEmbedderAdapter(new ConfigService());
    const vectors = await adapter.embed(['alpha', 'beta']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).not.toEqual(vectors[1]);
  }, 30_000);
});
