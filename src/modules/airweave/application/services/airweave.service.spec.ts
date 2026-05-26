import { jest } from '@jest/globals';
import {
  BadGatewayException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../../../../shared/config';
import { AdminOrganizationsService } from '../../../admin/organizations/application/services/admin-organizations.service';
import { PROJECTS_REPOSITORY } from '../../../projects/domain/repositories/projects.repository.interface';
import { AIRWEAVE_SDK_CLIENT } from '../../infrastructure/airweave-sdk.provider';
import { AirweaveAuthorizationService } from './airweave-authorization.service';
import { AirweaveService } from './airweave.service';

// ADR-011 § Amendment 4: `buildOAuthBrowserAuth` removed alongside the
// OAuth branch of `createSourceConnection`. BYOC entry now lives inside
// the SDK's catalog widget, not in a controller-side scrub helper.

describe('AirweaveService', () => {
  let service: AirweaveService;
  let client: {
    collections: {
      create: jest.Mock<any>;
      get: jest.Mock<any>;
      list: jest.Mock<any>;
      update: jest.Mock<any>;
      delete: jest.Mock<any>;
      search: {
        classic: jest.Mock<any>;
        instant: jest.Mock<any>;
      };
    };
    sourceConnections: {
      list: jest.Mock<any>;
      get: jest.Mock<any>;
      create: jest.Mock<any>;
      update: jest.Mock<any>;
      delete: jest.Mock<any>;
    };
  };
  let configService: {
    getAirweaveApiKey: jest.Mock<any>;
    getAirweaveBaseUrl: jest.Mock<any>;
  };
  let adminOrgService: {
    findById: jest.Mock<any>;
    addAirweaveCollectionToAllowlist: jest.Mock<any>;
    removeAirweaveCollectionFromAllowlist: jest.Mock<any>;
    isAirweaveCollectionInAllowlist: jest.Mock<any>;
  };
  let projectsRepo: {
    findProjectsReferencingAirweaveCollection: jest.Mock<any>;
  };
  let authzService: {
    assertOwnership: jest.Mock<any>;
    applyAirweaveAllowlist: jest.Mock<any>;
  };
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(async () => {
    client = {
      collections: {
        create: jest.fn(),
        get: jest.fn(),
        list: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        search: {
          classic: jest.fn(),
          instant: jest.fn(),
        },
      },
      sourceConnections: {
        list: jest.fn(),
        get: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    configService = {
      getAirweaveApiKey: jest.fn().mockReturnValue('sk-airweave'),
      getAirweaveBaseUrl: jest.fn().mockReturnValue('https://api.airweave.ai'),
    };
    adminOrgService = {
      findById: jest.fn(),
      addAirweaveCollectionToAllowlist: jest.fn(),
      removeAirweaveCollectionFromAllowlist: jest.fn(),
      isAirweaveCollectionInAllowlist: jest.fn(),
    };
    projectsRepo = {
      findProjectsReferencingAirweaveCollection: jest.fn(),
    };
    authzService = {
      assertOwnership: jest.fn(),
      applyAirweaveAllowlist: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirweaveService,
        { provide: AIRWEAVE_SDK_CLIENT, useValue: client },
        { provide: ConfigService, useValue: configService },
        { provide: AdminOrganizationsService, useValue: adminOrgService },
        { provide: PROJECTS_REPOSITORY, useValue: projectsRepo },
        { provide: AirweaveAuthorizationService, useValue: authzService },
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

  it('wraps upstream SDK failures with a bad gateway error and logs via NestJS Logger', async () => {
    // Step 9: handleUpstreamError swapped console.error for NestJS Logger
    // (ADR-004). Spy at the Logger prototype level since the instance is
    // private inside AirweaveService.
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    client.collections.list.mockRejectedValue(new Error('upstream error'));

    await expect(service.listCollections()).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining(`during 'list collections'`),
    );
    loggerSpy.mockRestore();
  });

  // Step 9: 429 pass-through (failure-mode row 13).
  describe('429 pass-through', () => {
    function make429(retryAfterValue?: string | null) {
      const err = Object.assign(new Error('rate limited'), { statusCode: 429 });
      if (retryAfterValue !== undefined) {
        Object.assign(err, {
          rawResponse: {
            headers: {
              get: (key: string) =>
                key.toLowerCase() === 'retry-after'
                  ? (retryAfterValue ?? null)
                  : null,
            },
          },
        });
      }
      return err;
    }

    it('surfaces upstream 429 as HttpException status 429', async () => {
      client.collections.list.mockRejectedValue(make429('30'));

      try {
        await service.listCollections();
        throw new Error('expected throw');
      } catch (caught: any) {
        expect(caught.getStatus()).toBe(429);
        expect(caught.getResponse()).toMatchObject({
          retryAfterSeconds: 30,
        });
      }
    });

    it('omits retryAfterSeconds when the upstream did not send the header', async () => {
      client.collections.list.mockRejectedValue(make429());

      try {
        await service.listCollections();
        throw new Error('expected throw');
      } catch (caught: any) {
        expect(caught.getStatus()).toBe(429);
        expect(caught.getResponse()).not.toHaveProperty('retryAfterSeconds');
      }
    });

    it('omits retryAfterSeconds when the header value is non-numeric', async () => {
      // RFC also allows HTTP-date format; we deliberately do not parse those
      // — clients can fall back to exponential backoff.
      client.collections.list.mockRejectedValue(
        make429('Wed, 21 Oct 2026 07:28:00 GMT'),
      );

      try {
        await service.listCollections();
        throw new Error('expected throw');
      } catch (caught: any) {
        expect(caught.getStatus()).toBe(429);
        expect(caught.getResponse()).not.toHaveProperty('retryAfterSeconds');
      }
    });
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

  // ── createCollection (Step 4a + 4b: happy path + adopt-on-409) ─────────

  describe('createCollection', () => {
    const orgRow = {
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      metadata: null,
      logo: null,
      member_count: '1',
      createdAt: new Date(),
    };

    const mappedReturnFromSdk = {
      id: 'uuid-new',
      name: 'My Coll',
      readable_id: 'acme-my-coll-abcdef12',
      organization_id: 'airweave-org',
      created_at: '2026-05-23T00:00:00.000Z',
      modified_at: '2026-05-23T00:00:00.000Z',
      status: 'ACTIVE',
      vector_size: 1536,
      embedding_model_name: 'text-embedding-3-large',
    };

    function makeAirweaveError(statusCode: number, message = 'upstream') {
      return Object.assign(new Error(message), { statusCode });
    }

    beforeEach(() => {
      adminOrgService.findById.mockResolvedValue(orgRow);
      adminOrgService.addAirweaveCollectionToAllowlist.mockResolvedValue(
        undefined,
      );
      adminOrgService.isAirweaveCollectionInAllowlist.mockResolvedValue(false);
    });

    it('happy path — creates upstream with random suffix and records ownership', async () => {
      client.collections.create.mockResolvedValue(mappedReturnFromSdk);

      const result = await service.createCollection({
        name: 'My Coll',
        organizationId: 'org-1',
        createdByUserId: 'user-admin',
      });

      // Random hex suffix per amended ADR-011 § Decision 3.
      expect(client.collections.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Coll',
          readable_id: expect.stringMatching(
            /^acme-my-coll-[0-9a-f]{8}$/,
          ) as unknown as string,
        }),
      );
      expect(
        adminOrgService.addAirweaveCollectionToAllowlist,
      ).toHaveBeenCalledWith(
        'org-1',
        expect.stringMatching(
          /^acme-my-coll-[0-9a-f]{8}$/,
        ) as unknown as string,
      );
      expect(result.id).toBe('uuid-new');
    });

    it('uses slugHint when provided (overrides name slugification)', async () => {
      client.collections.create.mockResolvedValue(mappedReturnFromSdk);

      await service.createCollection({
        name: 'A different display name',
        slugHint: 'finance-reports',
        organizationId: 'org-1',
      });

      expect(client.collections.create).toHaveBeenCalledWith(
        expect.objectContaining({
          readable_id: expect.stringMatching(
            /^acme-finance-reports-[0-9a-f]{8}$/,
          ) as unknown as string,
        }),
      );
    });

    it('produces different readable_ids on consecutive calls (random suffix, not deterministic)', async () => {
      // Per amended ADR-011 § Decision 3 / Alt G: the suffix MUST be random
      // so the id cannot be derived from public inputs. Two calls with the
      // same (orgSlug, slugHint) produce different ids — this is the
      // load-bearing security property.
      client.collections.create.mockResolvedValue(mappedReturnFromSdk);

      await service.createCollection({
        name: 'X',
        slugHint: 'same',
        organizationId: 'org-1',
      });
      await service.createCollection({
        name: 'X',
        slugHint: 'same',
        organizationId: 'org-1',
      });

      const [firstCall, secondCall] =
        client.collections.create.mock.calls;
      const firstId = (firstCall[0] as { readable_id: string }).readable_id;
      const secondId = (secondCall[0] as { readable_id: string }).readable_id;
      expect(firstId).not.toBe(secondId);
      expect(firstId).toMatch(/^acme-same-[0-9a-f]{8}$/);
      expect(secondId).toMatch(/^acme-same-[0-9a-f]{8}$/);
    });

    it('throws NotFoundException when the organization cannot be found', async () => {
      adminOrgService.findById.mockResolvedValue(null);

      await expect(
        service.createCollection({ name: 'X', organizationId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
      expect(client.collections.create).not.toHaveBeenCalled();
    });

    it('throws BadGatewayException when the organization has no slug', async () => {
      // QA gap #2 — covers the no-slug branch in createCollection.
      adminOrgService.findById.mockResolvedValue({
        ...orgRow,
        slug: null,
      });

      await expect(
        service.createCollection({
          name: 'My Coll',
          organizationId: 'org-no-slug',
        }),
      ).rejects.toThrow(BadGatewayException);
      expect(client.collections.create).not.toHaveBeenCalled();
    });

    it('Airweave create returns 409 → ConflictException (caller retries for a fresh id)', async () => {
      // Per amended ADR-011 — no adopt-on-409. 409 is real conflict.
      client.collections.create.mockRejectedValue(makeAirweaveError(409));

      await expect(
        service.createCollection({ name: 'X', organizationId: 'org-1' }),
      ).rejects.toThrow(ConflictException);
      // We never call collections.get — the disambiguation path is gone.
      expect(client.collections.get).not.toHaveBeenCalled();
      // Allowlist untouched.
      expect(
        adminOrgService.addAirweaveCollectionToAllowlist,
      ).not.toHaveBeenCalled();
    });

    it('Airweave create returns 5xx → BadGatewayException', async () => {
      client.collections.create.mockRejectedValue(makeAirweaveError(500));

      await expect(
        service.createCollection({ name: 'X', organizationId: 'org-1' }),
      ).rejects.toThrow(BadGatewayException);
    });

    it('Airweave OK + allowlist UPDATE fails → ConflictException naming the orphan readable_id', async () => {
      client.collections.create.mockResolvedValue(mappedReturnFromSdk);
      adminOrgService.addAirweaveCollectionToAllowlist.mockRejectedValue(
        new Error('DB write failed'),
      );

      const failure = service.createCollection({
        name: 'My Coll',
        organizationId: 'org-1',
      });

      await expect(failure).rejects.toThrow(ConflictException);
      // Caller-facing message names the orphan id so SRE can correlate.
      await expect(failure).rejects.toThrow(/readable_id='acme-my-coll-/);
    });
  });

  // ── updateCollection (Step 5: rename pass-through) ────────────────────

  describe('updateCollection', () => {
    const updatedFromSdk = {
      id: 'uuid-1',
      name: 'Renamed Coll',
      readable_id: 'acme-foo-abcdef12',
      organization_id: 'airweave-org',
      created_at: '2026-05-23T00:00:00.000Z',
      modified_at: '2026-05-23T01:00:00.000Z',
      status: 'ACTIVE',
      vector_size: 1536,
      embedding_model_name: 'text-embedding-3-large',
    };

    it('renames upstream and returns the mapped detail', async () => {
      client.collections.update.mockResolvedValue(updatedFromSdk);

      const result = await service.updateCollection('acme-foo-abcdef12', {
        name: 'Renamed Coll',
      });

      expect(client.collections.update).toHaveBeenCalledWith(
        'acme-foo-abcdef12',
        { name: 'Renamed Coll' },
      );
      expect(result.name).toBe('Renamed Coll');
    });

    it('maps upstream 404 to NotFoundException', async () => {
      client.collections.update.mockRejectedValue(
        Object.assign(new Error('not found'), { statusCode: 404 }),
      );

      await expect(
        service.updateCollection('missing-id', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteCollection (Step 5: references check + 404 idempotency) ─────

  describe('deleteCollection', () => {
    it('refuses with 409 + project list when active project_data_source rows reference the id', async () => {
      projectsRepo.findProjectsReferencingAirweaveCollection.mockResolvedValue([
        { id: 'proj-1', name: 'General' },
        { id: 'proj-2', name: 'Analytics' },
      ]);

      const failure = service.deleteCollection('acme-foo-abcdef12', 'org-1');
      await expect(failure).rejects.toThrow(ConflictException);
      // Airweave + allowlist untouched.
      expect(client.collections.delete).not.toHaveBeenCalled();
      expect(
        adminOrgService.removeAirweaveCollectionFromAllowlist,
      ).not.toHaveBeenCalled();
      // Security H1 fix — repo MUST be scoped by org id (defense-in-depth
      // per repo-conventions §3 even though the route already gates).
      expect(
        projectsRepo.findProjectsReferencingAirweaveCollection,
      ).toHaveBeenCalledWith('acme-foo-abcdef12', 'org-1');
    });

    it('deletes upstream + removes from allowlist on the clean path', async () => {
      projectsRepo.findProjectsReferencingAirweaveCollection.mockResolvedValue(
        [],
      );
      client.collections.delete.mockResolvedValue(undefined);
      adminOrgService.removeAirweaveCollectionFromAllowlist.mockResolvedValue(
        undefined,
      );

      await service.deleteCollection('acme-foo-abcdef12', 'org-1');

      expect(client.collections.delete).toHaveBeenCalledWith(
        'acme-foo-abcdef12',
      );
      expect(
        adminOrgService.removeAirweaveCollectionFromAllowlist,
      ).toHaveBeenCalledWith('org-1', 'acme-foo-abcdef12');
    });

    it('proceeds with allowlist cleanup when upstream returns 404 (failure mode #5)', async () => {
      projectsRepo.findProjectsReferencingAirweaveCollection.mockResolvedValue(
        [],
      );
      client.collections.delete.mockRejectedValue(
        Object.assign(new Error('gone'), { statusCode: 404 }),
      );
      adminOrgService.removeAirweaveCollectionFromAllowlist.mockResolvedValue(
        undefined,
      );

      await expect(
        service.deleteCollection('already-gone', 'org-1'),
      ).resolves.toBeUndefined();
      expect(
        adminOrgService.removeAirweaveCollectionFromAllowlist,
      ).toHaveBeenCalledWith('org-1', 'already-gone');
    });

    it('propagates non-404 upstream failures as BadGatewayException without touching allowlist', async () => {
      projectsRepo.findProjectsReferencingAirweaveCollection.mockResolvedValue(
        [],
      );
      client.collections.delete.mockRejectedValue(
        Object.assign(new Error('upstream broke'), { statusCode: 500 }),
      );

      await expect(
        service.deleteCollection('acme-foo-abcdef12', 'org-1'),
      ).rejects.toThrow(BadGatewayException);
      expect(
        adminOrgService.removeAirweaveCollectionFromAllowlist,
      ).not.toHaveBeenCalled();
    });
  });

  // ── createSourceConnection (Step 6: direct branch + OAuth-501 placeholder) ─

  describe('createSourceConnection', () => {
    const sdkReturn = {
      id: 'src-uuid-1',
      name: 'Slack Workspace',
      short_name: 'slack',
      readable_collection_id: 'acme-foo-abcdef12',
      created_at: '2026-05-23T00:00:00.000Z',
      modified_at: '2026-05-23T00:00:00.000Z',
      is_authenticated: true,
      entity_count: 0,
      auth_method: 'direct',
      status: 'ACTIVE',
    };

    it('direct branch — creates with sync_immediately=true and maps the response', async () => {
      client.sourceConnections.create.mockResolvedValue(sdkReturn);

      const result = await service.createSourceConnection({
        collectionReadableId: 'acme-foo-abcdef12',
        name: 'Slack Workspace',
        shortName: 'slack',
        authentication: {
          kind: 'direct',
          credentials: { token: 'xoxb-...' },
        },
      });

      expect(client.sourceConnections.create).toHaveBeenCalledWith({
        name: 'Slack Workspace',
        short_name: 'slack',
        readable_collection_id: 'acme-foo-abcdef12',
        sync_immediately: true,
        authentication: { credentials: { token: 'xoxb-...' } },
      });
      // Direct branch returns only sourceConnection — sessionToken
      // was removed from the result shape in ADR-011 Amendment 4
      // (OAuth flows get the token from /connect/session, not from
      // a source-connection create response).
      expect(result.sourceConnection.id).toBe('src-uuid-1');
      expect(result.sourceConnection.shortName).toBe('slack');
    });

    // ── ADR-011 § Amendment 4 ──────────────────────────────────────
    // The OAuth-branch test suite (originally Step 8 + Amendment 3
    // BYOC pass-through) was removed because the OAuth branch itself
    // is gone. OAuth source-connection creation now happens entirely
    // inside the SDK catalog widget. The controller spec keeps a
    // single regression-pin asserting that an OAuth body is rejected
    // with a 400 + clear pointer at the new flow (see
    // `airweave.controller.spec.ts` — "OAuth branch — REJECTED").

    it('direct branch — Airweave rejects credentials → BadGatewayException', async () => {
      client.sourceConnections.create.mockRejectedValue(
        Object.assign(new Error('invalid token'), { statusCode: 400 }),
      );

      await expect(
        service.createSourceConnection({
          collectionReadableId: 'acme-foo-abcdef12',
          name: 'Slack Workspace',
          shortName: 'slack',
          authentication: { kind: 'direct', credentials: { token: 'bad' } },
        }),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  // ── Step 7: source-connection UPDATE / DELETE / REAUTH ────────────────

  describe('source-connection inline-gated mutations', () => {
    const directSdkConn = {
      id: 'src-uuid-1',
      name: 'Slack Workspace',
      short_name: 'slack',
      readable_collection_id: 'acme-foo-abcdef12',
      organization_id: 'airweave-org',
      created_at: '2026-05-23T00:00:00.000Z',
      modified_at: '2026-05-23T00:00:00.000Z',
      status: 'ACTIVE',
      // SDK's canonical field — reauthSourceConnection reads conn.auth?.method
      auth: { method: 'direct', authenticated: true },
    };

    const oauthSdkConn = {
      ...directSdkConn,
      auth: { method: 'oauth_browser', authenticated: true },
    };

    const adminSession = {
      user: { id: 'user-admin', role: 'admin' },
      session: { activeOrganizationId: 'org-1' },
    } as never;

    beforeEach(() => {
      authzService.assertOwnership.mockResolvedValue(undefined);
    });

    describe('updateSourceConnection', () => {
      it('looks up parent collection, asserts ownership, then renames', async () => {
        client.sourceConnections.get.mockResolvedValue(directSdkConn);
        client.sourceConnections.update.mockResolvedValue({
          ...directSdkConn,
          name: 'Renamed',
        });

        const result = await service.updateSourceConnection(
          'src-uuid-1',
          adminSession,
          { name: 'Renamed' },
        );

        expect(authzService.assertOwnership).toHaveBeenCalledWith(
          adminSession,
          'acme-foo-abcdef12',
        );
        expect(client.sourceConnections.update).toHaveBeenCalledWith(
          'src-uuid-1',
          { name: 'Renamed' },
        );
        expect(result.name).toBe('Renamed');
      });

      it('propagates the ownership-rejection 403 from authzService', async () => {
        client.sourceConnections.get.mockResolvedValue(directSdkConn);
        authzService.assertOwnership.mockRejectedValue(
          Object.assign(new Error('not owned'), { status: 403 }),
        );

        await expect(
          service.updateSourceConnection('src-uuid-1', adminSession, {
            name: 'X',
          }),
        ).rejects.toThrow();
        expect(client.sourceConnections.update).not.toHaveBeenCalled();
      });

      it('maps source-connection 404 to NotFoundException', async () => {
        client.sourceConnections.get.mockRejectedValue(
          Object.assign(new Error('gone'), { statusCode: 404 }),
        );

        await expect(
          service.updateSourceConnection('missing', adminSession, {
            name: 'X',
          }),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('deleteSourceConnection', () => {
      it('looks up parent, asserts ownership, then deletes', async () => {
        client.sourceConnections.get.mockResolvedValue(directSdkConn);
        client.sourceConnections.delete.mockResolvedValue(undefined);

        await service.deleteSourceConnection('src-uuid-1', adminSession);

        expect(authzService.assertOwnership).toHaveBeenCalledWith(
          adminSession,
          'acme-foo-abcdef12',
        );
        expect(client.sourceConnections.delete).toHaveBeenCalledWith(
          'src-uuid-1',
        );
      });
    });

    describe('reauthSourceConnection', () => {
      // createConnectSession uses fetch (not the SDK client); stub it.
      function stubConnectSession(token: string) {
        fetchSpy.mockResolvedValue({
          ok: true,
          json: async () => ({ session_token: token }),
        } as unknown as Response);
      }

      it('returns a fresh sessionToken for an OAuth source connection', async () => {
        client.sourceConnections.get.mockResolvedValue(oauthSdkConn);
        stubConnectSession('connect-token-xyz');

        const result = await service.reauthSourceConnection(
          'src-uuid-1',
          adminSession,
        );

        expect(result.sessionToken).toBe('connect-token-xyz');
        expect(authzService.assertOwnership).toHaveBeenCalledWith(
          adminSession,
          'acme-foo-abcdef12',
        );
      });

      it('rejects re-auth for direct-auth source connections', async () => {
        client.sourceConnections.get.mockResolvedValue(directSdkConn);

        await expect(
          service.reauthSourceConnection('src-uuid-1', adminSession),
        ).rejects.toThrow(BadGatewayException);
      });

      it('deny-by-default — rejects re-auth when conn.auth is undefined (Security MED #1)', async () => {
        // Per amended ADR-011 + security review: an SDK shape we don't
        // recognize (auth missing, method undefined) must NOT default to
        // opening an OAuth handshake against an unknown connection type.
        client.sourceConnections.get.mockResolvedValue({
          ...directSdkConn,
          auth: undefined,
        });

        await expect(
          service.reauthSourceConnection('src-uuid-1', adminSession),
        ).rejects.toThrow(BadGatewayException);
      });

      it('deny-by-default — rejects re-auth when method is unknown (e.g. new SDK enum value)', async () => {
        client.sourceConnections.get.mockResolvedValue({
          ...directSdkConn,
          auth: { method: 'something_new', authenticated: false },
        });

        await expect(
          service.reauthSourceConnection('src-uuid-1', adminSession),
        ).rejects.toThrow(BadGatewayException);
      });
    });
  });
});
