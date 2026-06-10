import { jest } from '@jest/globals';
import type { IVectorDbRepository } from '../../domain/vector-db.repository';
import type { IEmbedder } from '../../domain/embedder.port';
import type { IVectorStore } from '../../domain/vector-store.port';
import type { VectorDbRow } from '../../api/dto/vector-db.dto';
import type { ConfigService } from '../../../../shared/config/config.service';
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
  names?: Array<{ s3_key: string; original_filename: string }>;
  minScore?: number;
}) {
  const repo = {
    findByIdInOrg: jest
      .fn<IVectorDbRepository['findByIdInOrg']>()
      .mockResolvedValue(parts.row === undefined ? buildRow() : parts.row),
    findDocumentNamesByS3Keys: jest
      .fn<IVectorDbRepository['findDocumentNamesByS3Keys']>()
      .mockResolvedValue(parts.names ?? []),
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
  const config = {
    getVectorDbMinScore: jest.fn().mockReturnValue(parts.minScore ?? 0),
  } as unknown as ConfigService;
  const service = new VectorDbRetrievalService(
    repo,
    embedder,
    vectorStore,
    config,
  );
  return { service, repo, embedder, vectorStore };
}

describe('VectorDbRetrievalService.search', () => {
  it('embeds the query and returns Qdrant hits mapped to text/score/chunkIndex', async () => {
    const { service, repo, embedder, vectorStore } = makeService({
      hits: [
        {
          id: 'p1',
          score: 0.91,
          payload: { text: 'alpha chunk', chunkIndex: 0, s3Key: 's3/a' },
        },
        {
          id: 'p2',
          score: 0.77,
          payload: { text: 'beta chunk', chunkIndex: 1, s3Key: 's3/a' },
        },
      ],
      names: [{ s3_key: 's3/a', original_filename: 'handbook.pdf' }],
    });

    const results = await service.search('vdb-1', 'org-1', 'how to onboard', 5);

    expect(repo.findByIdInOrg).toHaveBeenCalledWith('vdb-1', 'org-1');
    expect(embedder.embed).toHaveBeenCalledWith(['how to onboard']);
    expect(vectorStore.search).toHaveBeenCalledWith(
      'vdb_ref_1',
      [0.1, 0.2, 0.3],
      5,
    );
    expect(repo.findDocumentNamesByS3Keys).toHaveBeenCalledWith('vdb-1', [
      's3/a',
    ]);
    expect(results).toEqual([
      {
        text: 'alpha chunk',
        score: 0.91,
        chunkIndex: 0,
        s3Key: 's3/a',
        documentName: 'handbook.pdf',
      },
      {
        text: 'beta chunk',
        score: 0.77,
        chunkIndex: 1,
        s3Key: 's3/a',
        documentName: 'handbook.pdf',
      },
    ]);
  });

  it('resolves document names per distinct s3Key and leaves unresolved keys null', async () => {
    const { service, repo } = makeService({
      hits: [
        {
          id: 'p1',
          score: 0.9,
          payload: { text: 'a', chunkIndex: 0, s3Key: 's3/a' },
        },
        {
          id: 'p2',
          score: 0.8,
          payload: { text: 'b', chunkIndex: 0, s3Key: 's3/b' },
        },
        {
          id: 'p3',
          score: 0.7,
          payload: { text: 'c', chunkIndex: 1, s3Key: 's3/a' },
        },
      ],
      names: [{ s3_key: 's3/a', original_filename: 'handbook.pdf' }],
    });

    const results = await service.search('vdb-1', 'org-1', 'q', 5);

    // Distinct keys only, in first-seen order.
    expect(repo.findDocumentNamesByS3Keys).toHaveBeenCalledWith('vdb-1', [
      's3/a',
      's3/b',
    ]);
    expect(results.map((r) => r.documentName)).toEqual([
      'handbook.pdf',
      null,
      'handbook.pdf',
    ]);
  });

  it('drops hits below the configured minimum relevance score', async () => {
    const { service, repo } = makeService({
      minScore: 0.3,
      hits: [
        {
          id: 'p1',
          score: 0.61,
          payload: { text: 'relevant', chunkIndex: 0, s3Key: 's3/a' },
        },
        {
          id: 'p2',
          score: 0.18,
          payload: { text: 'noise', chunkIndex: 0, s3Key: 's3/b' },
        },
        {
          id: 'p3',
          score: 0.3,
          payload: { text: 'edge', chunkIndex: 0, s3Key: 's3/c' },
        },
      ],
      names: [
        { s3_key: 's3/a', original_filename: 'a.pdf' },
        { s3_key: 's3/c', original_filename: 'c.pdf' },
      ],
    });

    const results = await service.search('vdb-1', 'org-1', 'q', 12);

    // 0.18 is below the 0.3 floor; 0.3 is kept (inclusive). The dropped hit's
    // s3Key must not even be resolved.
    expect(results.map((r) => r.s3Key)).toEqual(['s3/a', 's3/c']);
    expect(repo.findDocumentNamesByS3Keys).toHaveBeenCalledWith('vdb-1', [
      's3/a',
      's3/c',
    ]);
  });

  it('returns [] and resolves no names when every hit is below the floor', async () => {
    const { service, repo } = makeService({
      minScore: 0.9,
      hits: [
        {
          id: 'p1',
          score: 0.42,
          payload: { text: 'a', chunkIndex: 0, s3Key: 's3/a' },
        },
        {
          id: 'p2',
          score: 0.11,
          payload: { text: 'b', chunkIndex: 0, s3Key: 's3/b' },
        },
      ],
      names: [{ s3_key: 's3/a', original_filename: 'a.pdf' }],
    });

    const results = await service.search('vdb-1', 'org-1', 'q', 12);

    expect(results).toEqual([]);
    expect(repo.findDocumentNamesByS3Keys).not.toHaveBeenCalled();
  });

  it('does not query for names when no hit carries an s3Key', async () => {
    const { service, repo } = makeService({
      hits: [{ id: 'p1', score: 0.5, payload: { text: 'x', chunkIndex: 0 } }],
    });

    const results = await service.search('vdb-1', 'org-1', 'q', 5);

    expect(repo.findDocumentNamesByS3Keys).not.toHaveBeenCalled();
    expect(results[0].s3Key).toBe('');
    expect(results[0].documentName).toBeNull();
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

    expect(results).toEqual([
      { text: '', score: 0.5, chunkIndex: 2, s3Key: '', documentName: null },
    ]);
  });
});
