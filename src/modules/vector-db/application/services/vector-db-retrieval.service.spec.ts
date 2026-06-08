import { jest } from '@jest/globals';
import type { IVectorDbRepository } from '../../domain/vector-db.repository';
import type { IEmbedder } from '../../domain/embedder.port';
import type { IVectorStore } from '../../domain/vector-store.port';
import type { VectorDbRow } from '../../api/dto/vector-db.dto';
import { VectorDbRetrievalService } from './vector-db-retrieval.service';

function buildRow(overrides: Partial<VectorDbRow> = {}): VectorDbRow {
  return {
    id: 'vdb-1',
    organization_id: 'org-1',
    name: 'Handbook',
    description: null,
    vector_store_kind: 'qdrant',
    vector_store_ref: 'vdb_ref_1',
    status: 'ready',
    status_error: null,
    document_count: 3,
    deleted_at: null,
    version: 1,
    processing_started_at: null,
    last_ingested_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makeService(parts: {
  row?: VectorDbRow | null;
  embed?: number[][];
  hits?: Array<{ id: string; score: number; payload: Record<string, unknown> }>;
}) {
  const repo = {
    findByIdInOrg: jest
      .fn<IVectorDbRepository['findByIdInOrg']>()
      .mockResolvedValue(parts.row === undefined ? buildRow() : parts.row),
  } as unknown as jest.Mocked<IVectorDbRepository>;
  const embedder = {
    embed: jest
      .fn<IEmbedder['embed']>()
      .mockResolvedValue(parts.embed ?? [[0.1, 0.2, 0.3]]),
    dimensions: jest.fn<IEmbedder['dimensions']>().mockReturnValue(3),
  } as unknown as jest.Mocked<IEmbedder>;
  const vectorStore = {
    search: jest
      .fn<IVectorStore['search']>()
      .mockResolvedValue(parts.hits ?? []),
    ensureCollection: jest.fn(),
    upsert: jest.fn(),
  } as unknown as jest.Mocked<IVectorStore>;
  const service = new VectorDbRetrievalService(repo, embedder, vectorStore);
  return { service, repo, embedder, vectorStore };
}

describe('VectorDbRetrievalService.search', () => {
  it('embeds the query and returns Qdrant hits mapped to text/score/chunkIndex', async () => {
    const { service, repo, embedder, vectorStore } = makeService({
      hits: [
        {
          id: 'p1',
          score: 0.91,
          payload: { text: 'alpha chunk', chunkIndex: 0 },
        },
        {
          id: 'p2',
          score: 0.77,
          payload: { text: 'beta chunk', chunkIndex: 1 },
        },
      ],
    });

    const results = await service.search('vdb-1', 'org-1', 'how to onboard', 5);

    expect(repo.findByIdInOrg).toHaveBeenCalledWith('vdb-1', 'org-1');
    expect(embedder.embed).toHaveBeenCalledWith(['how to onboard']);
    expect(vectorStore.search).toHaveBeenCalledWith(
      'vdb_ref_1',
      [0.1, 0.2, 0.3],
      5,
    );
    expect(results).toEqual([
      { text: 'alpha chunk', score: 0.91, chunkIndex: 0 },
      { text: 'beta chunk', score: 0.77, chunkIndex: 1 },
    ]);
  });

  it('returns [] without embedding when the vector database is not found (or cross-org)', async () => {
    const { service, embedder, vectorStore } = makeService({ row: null });

    const results = await service.search('vdb-x', 'org-1', 'q', 5);

    expect(results).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
    expect(vectorStore.search).not.toHaveBeenCalled();
  });

  it.each(['empty', 'processing', 'error'] as const)(
    'returns [] without searching when status is %s',
    async (status) => {
      const { service, vectorStore } = makeService({
        row: buildRow({ status }),
      });

      const results = await service.search('vdb-1', 'org-1', 'q', 5);

      expect(results).toEqual([]);
      expect(vectorStore.search).not.toHaveBeenCalled();
    },
  );

  it('coerces a missing payload text to an empty string', async () => {
    const { service } = makeService({
      hits: [{ id: 'p1', score: 0.5, payload: { chunkIndex: 2 } }],
    });

    const results = await service.search('vdb-1', 'org-1', 'q', 5);

    expect(results).toEqual([{ text: '', score: 0.5, chunkIndex: 2 }]);
  });
});
