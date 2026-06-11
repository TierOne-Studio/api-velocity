import { jest } from '@jest/globals';
import type { ProjectDataSource } from '../../api/dto/project.dto';
import type { VectorDbRetrievalService } from '../../../vector-db/application/services/vector-db-retrieval.service';
import { VectorDbDataSourceProvider } from './vector-db-data-source.provider';

function makeSource(): ProjectDataSource {
  return {
    id: 'src-1',
    projectId: 'proj-1',
    kind: 'vector_db',
    name: 'Handbook',
    config: { vectorDbId: 'vdb-1', vectorDbName: 'Handbook' },
    status: 'ready',
    statusDetail: null,
    createdAt: '',
    updatedAt: '',
  };
}

function makeProvider(
  results: Array<{
    text: string;
    score: number;
    chunkIndex: number;
    s3Key: string;
    documentName: string | null;
  }> = [],
) {
  const retrieval = {
    search: jest
      .fn<VectorDbRetrievalService['search']>()
      .mockResolvedValue(results),
  } as unknown as jest.Mocked<VectorDbRetrievalService>;
  return { provider: new VectorDbDataSourceProvider(retrieval), retrieval };
}

describe('VectorDbDataSourceProvider', () => {
  it('has kind vector_db', () => {
    const { provider } = makeProvider();
    expect(provider.kind).toBe('vector_db');
  });

  it('names the citation after the source document and keys entityId by s3Key', async () => {
    const { provider, retrieval } = makeProvider([
      {
        text: 'onboarding steps',
        score: 0.93,
        chunkIndex: 0,
        s3Key: 's3/onboarding.pdf',
        documentName: 'onboarding.pdf',
      },
    ]);

    const response = await provider.search(makeSource(), 'how to onboard', {
      organizationId: 'org-1',
      limit: 7,
    });

    expect(retrieval.search).toHaveBeenCalledWith(
      'vdb-1',
      'org-1',
      'how to onboard',
      7,
    );
    expect(response.results).toEqual([
      {
        entityId: 'vdb-1:s3/onboarding.pdf:0',
        name: 'onboarding.pdf',
        relevanceScore: 0.93,
        breadcrumbs: [],
        createdAt: null,
        updatedAt: null,
        text: 'onboarding steps',
        sourceName: 'Handbook',
        entityType: 'document',
        webUrl: '',
      },
    ]);
  });

  it('falls back to the collection name when the document is unresolved', async () => {
    const { provider } = makeProvider([
      {
        text: 'x',
        score: 0.5,
        chunkIndex: 0,
        s3Key: 's3/x',
        documentName: null,
      },
    ]);

    const response = await provider.search(makeSource(), 'q', {
      organizationId: 'org-1',
    });

    expect(response.results[0].name).toBe('Handbook');
  });

  it('does not collide entityIds for chunk 0 of two different documents', async () => {
    const { provider } = makeProvider([
      {
        text: 'a',
        score: 0.9,
        chunkIndex: 0,
        s3Key: 's3/a',
        documentName: 'a.pdf',
      },
      {
        text: 'b',
        score: 0.8,
        chunkIndex: 0,
        s3Key: 's3/b',
        documentName: 'b.pdf',
      },
    ]);

    const response = await provider.search(makeSource(), 'q', {
      organizationId: 'org-1',
    });

    const ids = response.results.map((r) => r.entityId);
    expect(ids).toEqual(['vdb-1:s3/a:0', 'vdb-1:s3/b:0']);
    expect(new Set(ids).size).toBe(2);
  });

  it('returns no results when the retrieval service finds nothing', async () => {
    const { provider } = makeProvider([]);
    const response = await provider.search(makeSource(), 'q', {
      organizationId: 'org-1',
    });
    expect(response.results).toEqual([]);
  });

  it('returns no results and does not query when no organizationId is threaded', async () => {
    const { provider, retrieval } = makeProvider([
      {
        text: 'x',
        score: 1,
        chunkIndex: 0,
        s3Key: 's3/x',
        documentName: 'x.pdf',
      },
    ]);

    const response = await provider.search(makeSource(), 'q', {});

    expect(response.results).toEqual([]);
    expect(retrieval.search).not.toHaveBeenCalled();
  });

  it('throws when handed a non-vector_db source', async () => {
    const { provider } = makeProvider();
    const wrongSource = {
      ...makeSource(),
      kind: 'database' as const,
      config: { connectionId: 'c1', connectionName: 'db' },
    } as unknown as ProjectDataSource;

    await expect(
      provider.search(wrongSource, 'q', { organizationId: 'org-1' }),
    ).rejects.toThrow(/cannot handle source kind "database"/);
  });
});
