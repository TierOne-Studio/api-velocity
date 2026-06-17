import { jest } from '@jest/globals';
import { AirweaveCollectionProvider } from './airweave-collection.provider';
import type { AirweaveService } from '../../../airweave/application/services/airweave.service';
import type { ProjectDataSource } from '../../api/dto/project.dto';

describe('AirweaveCollectionProvider', () => {
  let airweaveService: jest.Mocked<AirweaveService>;
  let provider: AirweaveCollectionProvider;

  const airweaveSource: ProjectDataSource = {
    id: 'source-1',
    projectId: 'project-1',
    kind: 'airweave_collection',
    name: 'Docs',
    config: { airweaveCollectionReadableId: 'coll-1', airweaveCollectionName: 'Docs' },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-04-17T00:00:00.000Z',
    updatedAt: '2026-04-17T00:00:00.000Z',
  };

  beforeEach(() => {
    airweaveService = {
      searchCollection: jest.fn(),
    } as unknown as jest.Mocked<AirweaveService>;
    provider = new AirweaveCollectionProvider(airweaveService);
  });

  it('reports its kind', () => {
    expect(provider.kind).toBe('airweave_collection');
  });

  it('delegates search to AirweaveService with instant tier by default', async () => {
    airweaveService.searchCollection.mockResolvedValue({
      results: [],
    } as never);

    await provider.search(airweaveSource, 'auth flow');

    expect(airweaveService.searchCollection).toHaveBeenCalledWith('coll-1', {
      query: 'auth flow',
      tier: 'instant',
      retrievalStrategy: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('forwards tier and retrieval options', async () => {
    airweaveService.searchCollection.mockResolvedValue({
      results: [],
    } as never);

    await provider.search(airweaveSource, 'query', {
      tier: 'classic',
      retrievalStrategy: 'hybrid',
      limit: 5,
      offset: 2,
    });

    expect(airweaveService.searchCollection).toHaveBeenCalledWith('coll-1', {
      query: 'query',
      tier: 'classic',
      retrievalStrategy: 'hybrid',
      limit: 5,
      offset: 2,
    });
  });

  it('throws when given a source of the wrong kind', async () => {
    const dbSource = { ...airweaveSource, kind: 'database' as const };

    await expect(provider.search(dbSource as never, 'q')).rejects.toThrow(
      /cannot handle source kind/,
    );
  });
});
