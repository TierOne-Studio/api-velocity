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
  results: Array<{ text: string; score: number; chunkIndex: number }> = [],
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

  it('embeds via the retrieval service and maps hits to the search response shape', async () => {
    const { provider, retrieval } = makeProvider([
      { text: 'onboarding steps', score: 0.93, chunkIndex: 0 },
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
        entityId: 'vdb-1:0',
        name: 'Handbook',
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

  it('returns no results when the retrieval service finds nothing', async () => {
    const { provider } = makeProvider([]);
    const response = await provider.search(makeSource(), 'q', {
      organizationId: 'org-1',
    });
    expect(response.results).toEqual([]);
  });

  it('returns no results and does not query when no organizationId is threaded', async () => {
    const { provider, retrieval } = makeProvider([
      { text: 'x', score: 1, chunkIndex: 0 },
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
