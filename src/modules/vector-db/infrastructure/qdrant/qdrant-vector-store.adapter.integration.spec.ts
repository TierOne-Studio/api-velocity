// Integration spec for QdrantVectorStoreAdapter — runs against a REAL Qdrant
// instance (Qdrant Cloud or local container), NOT a mock.
//
// SETUP CONTRACT:
// - QDRANT_URL + QDRANT_API_KEY must be set (loaded via .env.test by the Jest
//   setup). If missing, every test here is SKIPPED so unit-only CI stays green.
// - Each run uses a unique collection name and drops it in afterAll, so
//   concurrent runs don't collide.
//
// Proves the two ADR-014 non-negotiables that can only be verified against the
// real store: ensureCollection is idempotent, and re-upserting the same
// deterministic point IDs does NOT duplicate vectors (count stays stable).

import { QdrantClient } from '@qdrant/js-client-rest';
import { randomBytes } from 'node:crypto';
import { QdrantVectorStoreAdapter } from './qdrant-vector-store.adapter';
import { deterministicPointId } from '../../domain/point-id';
import type { ConfigService } from '../../../../shared/config/config.service';
import type { VectorPoint } from '../../domain/vector-store.port';

const url = process.env.QDRANT_URL;
const apiKey = process.env.QDRANT_API_KEY;
const describeIfQdrant = url && apiKey ? describe : describe.skip;

const DIM = 8;

function makeConfig(): ConfigService {
  return {
    getQdrantUrl: () => url,
    getQdrantApiKey: () => apiKey,
  } as unknown as ConfigService;
}

function makePoints(vdbId: string, count: number): VectorPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    id: deterministicPointId(vdbId, 's3/key', i),
    vector: Array.from({ length: DIM }, () => Math.random()),
    payload: { chunkIndex: i, text: `chunk ${i}` },
  }));
}

describeIfQdrant('QdrantVectorStoreAdapter (integration)', () => {
  const ref = `vdb_test_${randomBytes(8).toString('hex')}`;
  const vdbId = `vdb-${randomBytes(4).toString('hex')}`;
  let adapter: QdrantVectorStoreAdapter;
  let raw: QdrantClient;

  beforeAll(() => {
    adapter = new QdrantVectorStoreAdapter(makeConfig());
    raw = new QdrantClient({ url: url, apiKey: apiKey });
  });

  afterAll(async () => {
    await raw.deleteCollection(ref).catch(() => undefined);
  });

  it('ensureCollection creates the collection and is idempotent on re-run', async () => {
    await adapter.ensureCollection(ref, DIM);
    await adapter.ensureCollection(ref, DIM); // must not throw on existing

    const { exists } = await raw.collectionExists(ref);
    expect(exists).toBe(true);
  });

  it('re-upserting the same deterministic ids does not duplicate vectors', async () => {
    await adapter.ensureCollection(ref, DIM);
    const points = makePoints(vdbId, 3);

    await adapter.upsert(ref, points);
    const first = await raw.count(ref, { exact: true });
    expect(first.count).toBe(3);

    // Same ids again (simulates a retried ingestion job) → overwrite, not append.
    await adapter.upsert(ref, makePoints(vdbId, 3));
    const second = await raw.count(ref, { exact: true });
    expect(second.count).toBe(3);
  });

  it('upsert of an empty point list is a no-op', async () => {
    await adapter.ensureCollection(ref, DIM);
    await expect(adapter.upsert(ref, [])).resolves.toBeUndefined();
  });

  it('search returns the nearest point first with its payload (Slice 6 retrieval)', async () => {
    const searchRef = `vdb_search_${randomBytes(8).toString('hex')}`;
    await adapter.ensureCollection(searchRef, DIM);
    try {
      // Orthogonal basis vectors so the nearest neighbour is unambiguous.
      const points: VectorPoint[] = [0, 1, 2].map((i) => ({
        id: deterministicPointId('vdb-search', 's3/key', i),
        vector: Array.from({ length: DIM }, (_, d) => (d === i ? 1 : 0)),
        payload: { chunkIndex: i, text: `chunk ${i}` },
      }));
      await adapter.upsert(searchRef, points);

      // Query closest to the basis vector of point 1.
      const query = Array.from({ length: DIM }, (_, d) => (d === 1 ? 1 : 0));
      const hits = await adapter.search(searchRef, query, 2);

      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].payload.text).toBe('chunk 1');
      expect(hits[0].payload.chunkIndex).toBe(1);
      expect(hits[0].score).toBeGreaterThan(hits[1]?.score ?? -Infinity);
    } finally {
      await raw.deleteCollection(searchRef).catch(() => undefined);
    }
  });
});
