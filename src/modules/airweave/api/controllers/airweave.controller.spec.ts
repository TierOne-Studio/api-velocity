import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PermissionsGuard } from '../../../../shared';
import { AdminOrganizationsService } from '../../../admin';
import { AirweaveService } from '../../application/services/airweave.service';
import { AirweaveController } from './airweave.controller';

const superadminSession = {
  user: { id: 'user-super', role: 'superadmin' },
  session: { activeOrganizationId: null },
} as never;

const adminSession = {
  user: { id: 'user-admin', role: 'admin' },
  session: { activeOrganizationId: 'org-1' },
} as never;

describe('AirweaveController', () => {
  let controller: AirweaveController;
  let airweaveService: jest.Mocked<AirweaveService>;
  let adminOrganizationsService: jest.Mocked<AdminOrganizationsService>;

  beforeEach(() => {
    airweaveService = {
      getCollection: jest.fn(),
      listCollections: jest.fn(),
      searchCollection: jest.fn(),
      listSourceConnections: jest.fn(),
      getSourceConnection: jest.fn(),
      createConnectSession: jest.fn(),
    } as unknown as jest.Mocked<AirweaveService>;

    adminOrganizationsService = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<AdminOrganizationsService>;

    controller = new AirweaveController(
      airweaveService,
      adminOrganizationsService,
    );
  });

  it('applies class-level PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AirweaveController,
    ) as unknown[];

    expect(guards).toContain(PermissionsGuard);
  });

  it('lists collections with parsed query params (superadmin sees all)', async () => {
    airweaveService.listCollections.mockResolvedValue([]);

    await controller.listCollections(
      superadminSession,
      ' champion ',
      '25',
      '5',
    );

    expect(airweaveService.listCollections).toHaveBeenCalledWith({
      search: 'champion',
      limit: 25,
      skip: 5,
    });
  });

  it('filters collections via org allowlist for non-superadmin', async () => {
    airweaveService.listCollections.mockResolvedValue([
      { readableId: 'allowed-1' } as never,
      { readableId: 'blocked-2' } as never,
    ]);
    adminOrganizationsService.findById.mockResolvedValue({
      id: 'org-1',
      metadata: { allowedAirweaveCollectionIds: ['allowed-1'] },
    } as never);

    const result = await controller.listCollections(adminSession);

    expect(result).toEqual({ data: [{ readableId: 'allowed-1' }] });
  });

  it('returns empty list when org has no allowlist and caller is not superadmin', async () => {
    airweaveService.listCollections.mockResolvedValue([
      { readableId: 'any-1' } as never,
    ]);
    adminOrganizationsService.findById.mockResolvedValue({
      id: 'org-1',
      metadata: null,
    } as never);

    const result = await controller.listCollections(adminSession);

    expect(result).toEqual({ data: [] });
  });

  it('gets a single collection by trimmed readable id', async () => {
    airweaveService.getCollection.mockResolvedValue({
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

    await controller.getCollection(' champion-velocity ');

    expect(airweaveService.getCollection).toHaveBeenCalledWith(
      'champion-velocity',
    );
  });

  it('rejects blank collection ids when getting a collection', async () => {
    await expect(controller.getCollection('   ')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects invalid limit values', async () => {
    await expect(
      controller.listCollections(superadminSession, undefined, '0', undefined),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('lists source connections for a collection', async () => {
    airweaveService.listSourceConnections.mockResolvedValue([]);

    await controller.listSourceConnections(' champion-velocity ');

    expect(airweaveService.listSourceConnections).toHaveBeenCalledWith(
      'champion-velocity',
    );
  });

  it('rejects blank collection ids when listing source connections', async () => {
    await expect(controller.listSourceConnections('   ')).rejects.toMatchObject(
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  });

  it('creates an Airweave Connect session for a collection', async () => {
    airweaveService.createConnectSession.mockResolvedValue({
      sessionToken: 'session-token-1',
    } as never);

    const result = await controller.createConnectSession(
      {
        user: { id: 'user-1', role: 'admin' },
        session: { activeOrganizationId: 'org-1' },
      } as never,
      { collectionId: ' champion-velocity ' },
    );

    expect(airweaveService.createConnectSession).toHaveBeenCalledWith({
      readableCollectionId: 'champion-velocity',
      endUserId: 'user-1',
    });
    expect(result).toEqual({ data: { sessionToken: 'session-token-1' } });
  });

  it('searches a collection with validated classic-tier params', async () => {
    airweaveService.searchCollection.mockResolvedValue({ results: [] });

    await controller.searchCollection(' champion-velocity ', {
      query: ' auth flow ',
      tier: 'classic',
      limit: '10',
      offset: '2',
    });

    expect(airweaveService.searchCollection).toHaveBeenCalledWith(
      'champion-velocity',
      {
        query: 'auth flow',
        tier: 'classic',
        limit: 10,
        offset: 2,
        retrievalStrategy: undefined,
      },
    );
  });

  it('searches a collection with validated instant-tier params', async () => {
    airweaveService.searchCollection.mockResolvedValue({ results: [] });

    await controller.searchCollection(' champion-velocity ', {
      query: ' deployments ',
      tier: 'instant',
      limit: '5',
      offset: '0',
      retrievalStrategy: 'hybrid',
    });

    expect(airweaveService.searchCollection).toHaveBeenCalledWith(
      'champion-velocity',
      {
        query: 'deployments',
        tier: 'instant',
        limit: 5,
        offset: 0,
        retrievalStrategy: 'hybrid',
      },
    );
  });

  it('rejects search requests without a query', async () => {
    await expect(
      controller.searchCollection('champion-velocity', {
        query: '   ',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects instant search requests without a retrieval strategy', async () => {
    await expect(
      controller.searchCollection('champion-velocity', {
        query: 'auth',
        tier: 'instant',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects invalid search tiers', async () => {
    await expect(
      controller.searchCollection('champion-velocity', {
        query: 'auth',
        tier: 'agentic',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects invalid retrievalStrategy values', async () => {
    await expect(
      controller.searchCollection('champion-velocity', {
        query: 'auth',
        tier: 'instant',
        retrievalStrategy: 'invalid-strategy',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('lists collections with undefined limit and skip (returns undefined for optional params)', async () => {
    airweaveService.listCollections.mockResolvedValue([]);

    await controller.listCollections(undefined, undefined, undefined);

    expect(airweaveService.listCollections).toHaveBeenCalledWith({
      search: undefined,
      limit: undefined,
      skip: undefined,
    });
  });
});
