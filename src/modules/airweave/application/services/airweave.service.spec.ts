import { jest } from '@jest/globals';
import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../../../../shared/config';
import { AIRWEAVE_SDK_CLIENT } from '../../infrastructure/airweave-sdk.provider';
import { AirweaveService } from './airweave.service';

describe('AirweaveService', () => {
  let service: AirweaveService;
  let client: {
    collections: {
      get: jest.Mock<any>;
      list: jest.Mock<any>;
      search: {
        classic: jest.Mock<any>;
        instant: jest.Mock<any>;
      };
    };
    sourceConnections: { list: jest.Mock<any>; get: jest.Mock<any> };
  };
  let configService: {
    getAirweaveApiKey: jest.Mock<any>;
    getAirweaveBaseUrl: jest.Mock<any>;
  };
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(async () => {
    client = {
      collections: {
        get: jest.fn(),
        list: jest.fn(),
        search: {
          classic: jest.fn(),
          instant: jest.fn(),
        },
      },
      sourceConnections: { list: jest.fn(), get: jest.fn() },
    };
    configService = {
      getAirweaveApiKey: jest.fn().mockReturnValue('sk-airweave'),
      getAirweaveBaseUrl: jest.fn().mockReturnValue('https://api.airweave.ai'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirweaveService,
        { provide: AIRWEAVE_SDK_CLIENT, useValue: client },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(AirweaveService);
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    fetchSpy = jest.spyOn(global, 'fetch' as never);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('lists collections and maps the SDK response to UI-safe summaries', async () => {
    client.collections.list.mockResolvedValue([
      {
        id: 'uuid-1',
        name: 'Champion Velocity',
        readable_id: 'champion-velocity',
        organization_id: 'airweave-org-1',
        created_at: '2026-04-01T00:00:00.000Z',
        modified_at: '2026-04-02T00:00:00.000Z',
        status: 'ACTIVE',
        vector_size: 1536,
        embedding_model_name: 'text-embedding-3-large',
        source_connection_summaries: [
          { short_name: 'github', name: 'TierOne Repo' },
        ],
      },
    ]);

    const result = await service.listCollections({
      search: 'champion',
      limit: 25,
      skip: 0,
    });

    expect(client.collections.list).toHaveBeenCalledWith({
      search: 'champion',
      limit: 25,
      skip: 0,
    });

    expect(result).toEqual([
      {
        id: 'uuid-1',
        name: 'Champion Velocity',
        readableId: 'champion-velocity',
        organizationId: 'airweave-org-1',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
        status: 'ACTIVE',
        sourceConnectionCount: 1,
      },
    ]);
  });

  it('lists source connections for a collection', async () => {
    client.sourceConnections.list.mockResolvedValue([
      {
        id: 'source-1',
        name: 'TierOne Docs',
        short_name: 'confluence',
        readable_collection_id: 'champion-velocity',
        created_at: '2026-04-01T00:00:00.000Z',
        modified_at: '2026-04-02T00:00:00.000Z',
        is_authenticated: true,
        entity_count: 42,
        auth_method: 'oauth_browser',
        status: 'synced',
      },
    ]);

    const result = await service.listSourceConnections('champion-velocity');

    expect(client.sourceConnections.list).toHaveBeenCalledWith({
      collection: 'champion-velocity',
      limit: 100,
      skip: 0,
    });

    expect(result).toEqual([
      {
        id: 'source-1',
        name: 'TierOne Docs',
        shortName: 'confluence',
        collectionReadableId: 'champion-velocity',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
        isAuthenticated: true,
        entityCount: 42,
        authMethod: 'oauth_browser',
        status: 'synced',
      },
    ]);
  });

  it('gets a collection detail summary', async () => {
    client.collections.get.mockResolvedValue({
      id: 'uuid-1',
      name: 'Champion Velocity',
      readable_id: 'champion-velocity',
      organization_id: 'airweave-org-1',
      created_at: '2026-04-01T00:00:00.000Z',
      modified_at: '2026-04-02T00:00:00.000Z',
      status: 'ACTIVE',
      vector_size: 1536,
      embedding_model_name: 'text-embedding-3-large',
      source_connection_summaries: [
        { short_name: 'github', name: 'TierOne Repo' },
      ],
    });

    const result = await service.getCollection('champion-velocity');

    expect(client.collections.get).toHaveBeenCalledWith('champion-velocity');
    expect(result).toEqual({
      id: 'uuid-1',
      name: 'Champion Velocity',
      readableId: 'champion-velocity',
      organizationId: 'airweave-org-1',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      status: 'ACTIVE',
      sourceConnectionCount: 1,
      vectorSize: 1536,
      embeddingModelName: 'text-embedding-3-large',
    });
  });

  it('searches a collection with the classic tier and maps result metadata', async () => {
    client.collections.search.classic.mockResolvedValue({
      results: [
        {
          entity_id: 'entity-1',
          name: 'Auth Guide',
          relevance_score: 0.99,
          breadcrumbs: [
            { entity_id: 'folder-1', name: 'Docs', entity_type: 'folder' },
          ],
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-02T00:00:00.000Z',
          textual_representation: 'How authentication works',
          airweave_system_metadata: {
            source_name: 'github',
            entity_type: 'file',
          },
          access: { principals: [] },
          web_url: 'https://github.com/tierone/auth-guide',
          raw_source_fields: { repo: 'tierone/app' },
        },
      ],
    });

    const result = await service.searchCollection('champion-velocity', {
      query: 'authentication',
      tier: 'classic',
      limit: 10,
      offset: 2,
    });

    expect(client.collections.search.classic).toHaveBeenCalledWith(
      'champion-velocity',
      {
        query: 'authentication',
        limit: 10,
        offset: 2,
      },
    );

    expect(result).toEqual({
      results: [
        {
          entityId: 'entity-1',
          name: 'Auth Guide',
          relevanceScore: 0.99,
          breadcrumbs: [
            { entityId: 'folder-1', name: 'Docs', entityType: 'folder' },
          ],
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-02T00:00:00.000Z',
          text: 'How authentication works',
          sourceName: 'github',
          entityType: 'file',
          webUrl: 'https://github.com/tierone/auth-guide',
        },
      ],
    });
  });

  it('searches a collection with the instant tier and retrieval strategy', async () => {
    client.collections.search.instant.mockResolvedValue({ results: [] });

    await service.searchCollection('champion-velocity', {
      query: 'deployments',
      tier: 'instant',
      limit: 5,
      offset: 0,
      retrievalStrategy: 'hybrid',
    });

    expect(client.collections.search.instant).toHaveBeenCalledWith(
      'champion-velocity',
      {
        query: 'deployments',
        retrieval_strategy: 'hybrid',
        limit: 5,
        offset: 0,
      },
    );
  });

  it('gets one source connection detail', async () => {
    client.sourceConnections.get.mockResolvedValue({
      id: 'source-1',
      name: 'TierOne Repo',
      short_name: 'github',
      readable_collection_id: 'champion-velocity',
      created_at: '2026-04-01T00:00:00.000Z',
      modified_at: '2026-04-02T00:00:00.000Z',
      is_authenticated: true,
      entity_count: 99,
      auth_method: 'oauth_browser',
      status: 'synced',
    } as never);

    const result = await service.getSourceConnection('source-1');

    expect(client.sourceConnections.get).toHaveBeenCalledWith('source-1');
    expect(result).toEqual({
      id: 'source-1',
      name: 'TierOne Repo',
      shortName: 'github',
      collectionReadableId: 'champion-velocity',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      isAuthenticated: true,
      entityCount: 99,
      authMethod: 'oauth_browser',
      status: 'synced',
    });
  });

  it('creates an Airweave Connect session token', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: jest
        .fn()
        .mockResolvedValue({ session_token: 'session-token-1' } as never),
    } as never);

    const result = await service.createConnectSession({
      readableCollectionId: 'champion-velocity',
      endUserId: 'user-1',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.airweave.ai/connect/sessions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'sk-airweave',
        },
        body: JSON.stringify({
          readable_collection_id: 'champion-velocity',
          mode: 'all',
          end_user_id: 'user-1',
        }),
      },
    );
    expect(result).toEqual({ sessionToken: 'session-token-1' });
  });

  it('throws service unavailable when the SDK client is not configured', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirweaveService,
        { provide: AIRWEAVE_SDK_CLIENT, useValue: null },
      ],
    }).compile();

    const unconfiguredService = module.get(AirweaveService);

    await expect(unconfiguredService.listCollections()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('wraps upstream SDK failures with a bad gateway error', async () => {
    client.collections.list.mockRejectedValue(new Error('upstream error'));

    await expect(service.listCollections()).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[AirweaveService] Airweave request failed',
      expect.objectContaining({ action: 'list collections' }),
    );
  });

  it('throws service unavailable when connect is requested without an API key', async () => {
    configService.getAirweaveApiKey.mockReturnValue(null);

    await expect(
      service.createConnectSession({
        readableCollectionId: 'champion-velocity',
        endUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws service unavailable when configService is not injected and createConnectSession is called', async () => {
    const moduleNoConfig: TestingModule = await Test.createTestingModule({
      providers: [
        AirweaveService,
        { provide: AIRWEAVE_SDK_CLIENT, useValue: client },
        // ConfigService intentionally omitted
      ],
    }).compile();

    const serviceNoConfig = moduleNoConfig.get(AirweaveService);

    await expect(
      serviceNoConfig.createConnectSession({
        readableCollectionId: 'champion-velocity',
        endUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws NotFoundException for 404 upstream errors', async () => {
    client.collections.get.mockRejectedValue({
      statusCode: 404,
      message: 'Not Found',
    });

    await expect(
      service.getCollection('nonexistent-collection'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses status field for error code detection when statusCode is absent', async () => {
    client.sourceConnections.get.mockRejectedValue({
      status: 404,
      message: 'Not Found',
    });

    await expect(
      service.getSourceConnection('nonexistent-source'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadGatewayException for non-404 upstream errors', async () => {
    client.collections.get.mockRejectedValue({
      statusCode: 500,
      message: 'Internal Server Error',
    });

    await expect(
      service.getCollection('error-collection'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException when fetch response is not ok', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: jest.fn().mockResolvedValue({} as never),
    } as never);

    await expect(
      service.createConnectSession({
        readableCollectionId: 'bad-collection',
        endUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException when response does not contain session_token', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({} as never),
    } as never);

    await expect(
      service.createConnectSession({
        readableCollectionId: 'champion-velocity',
        endUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('wraps fetch network failures with bad gateway error', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error') as never);

    await expect(
      service.createConnectSession({
        readableCollectionId: 'champion-velocity',
        endUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('handles non-Error and non-string upstream errors gracefully', async () => {
    client.collections.list.mockRejectedValue({
      code: 'TIMEOUT',
      detail: 'Request timed out',
    });

    await expect(service.listCollections()).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('maps null status in collection to null', async () => {
    client.collections.list.mockResolvedValue([
      {
        id: 'uuid-1',
        name: 'Test Collection',
        readable_id: 'test-collection',
        organization_id: 'org-1',
        created_at: '2026-04-01T00:00:00.000Z',
        modified_at: '2026-04-02T00:00:00.000Z',
        status: null,
        vector_size: 768,
        embedding_model_name: 'text-embedding-3-small',
        source_connection_summaries: [],
      },
    ]);

    const result = await service.listCollections();

    expect(result[0].status).toBeNull();
    expect(result[0].sourceConnectionCount).toBe(0);
  });

  it('maps source connection with null optional fields to defaults', async () => {
    client.sourceConnections.list.mockResolvedValue([
      {
        id: 'source-null',
        name: 'Null Defaults',
        short_name: 'null',
        readable_collection_id: 'test',
        created_at: '2026-04-01T00:00:00.000Z',
        modified_at: '2026-04-02T00:00:00.000Z',
        is_authenticated: null,
        entity_count: null,
        auth_method: null,
        status: 'unknown',
      },
    ]);

    const result = await service.listSourceConnections('test');

    expect(result[0].isAuthenticated).toBe(false);
    expect(result[0].entityCount).toBe(0);
    expect(result[0].authMethod).toBe('unknown');
  });

  it('handles empty results array in searchCollection', async () => {
    client.collections.search.classic.mockResolvedValue({ results: null });

    const result = await service.searchCollection('champion-velocity', {
      query: 'test',
      tier: 'classic',
    });

    expect(result.results).toHaveLength(0);
  });
});
