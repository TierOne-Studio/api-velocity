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
import { AirweaveAuthorizationService } from '../../application/services/airweave-authorization.service';
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
  let authzService: jest.Mocked<AirweaveAuthorizationService>;

  beforeEach(() => {
    airweaveService = {
      getCollection: jest.fn(),
      listCollections: jest.fn(),
      searchCollection: jest.fn(),
      listSourceConnections: jest.fn(),
      getSourceConnection: jest.fn(),
      createConnectSession: jest.fn(),
    } as unknown as jest.Mocked<AirweaveService>;

    authzService = {
      applyAirweaveAllowlist: jest.fn(),
      assertOwnership: jest.fn(),
    } as unknown as jest.Mocked<AirweaveAuthorizationService>;

    controller = new AirweaveController(airweaveService, authzService);
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
    authzService.applyAirweaveAllowlist.mockResolvedValue([]);

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

  it('delegates LIST filtering to AirweaveAuthorizationService.applyAirweaveAllowlist', async () => {
    // Filter behavior itself is covered by airweave-authorization.service.spec.ts.
    // Here we only assert the controller delegates with (collections, session)
    // and returns whatever the service returns.
    const fetched = [
      { readableId: 'allowed-1' } as never,
      { readableId: 'blocked-2' } as never,
    ];
    const filtered = [{ readableId: 'allowed-1' } as never];
    airweaveService.listCollections.mockResolvedValue(fetched);
    authzService.applyAirweaveAllowlist.mockResolvedValue(filtered);

    const result = await controller.listCollections(adminSession);

    expect(authzService.applyAirweaveAllowlist).toHaveBeenCalledWith(
      fetched,
      adminSession,
    );
    expect(result).toEqual({ data: filtered });
  });

  it('returns empty list when the authz service narrows everything away', async () => {
    airweaveService.listCollections.mockResolvedValue([
      { readableId: 'any-1' } as never,
    ]);
    authzService.applyAirweaveAllowlist.mockResolvedValue([]);

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

  // ── POST /collections (Step 4: createCollection) ─────────────────────────

  describe('createCollection', () => {
    beforeEach(() => {
      (airweaveService as any).createCollection = jest.fn();
    });

    it('delegates to AirweaveService.createCollection with active org id', async () => {
      (airweaveService.createCollection as jest.Mock).mockResolvedValue({
        id: 'uuid-x',
        readableId: 'acme-foo-abcdef12',
      } as never);

      const result = await controller.createCollection(adminSession, {
        name: '  Foo  ',
        slugHint: 'foo',
      });

      expect(airweaveService.createCollection).toHaveBeenCalledWith({
        name: 'Foo',
        slugHint: 'foo',
        organizationId: 'org-1',
      });
      expect(result).toEqual({ data: { id: 'uuid-x', readableId: 'acme-foo-abcdef12' } });
    });

    it('rejects empty/whitespace name with 400', async () => {
      await expect(
        controller.createCollection(adminSession, { name: '   ' }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('rejects slugHint with disallowed characters', async () => {
      await expect(
        controller.createCollection(adminSession, {
          name: 'X',
          slugHint: 'Foo Bar', // space is not allowed
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('rejects slugHint longer than 32 chars', async () => {
      await expect(
        controller.createCollection(adminSession, {
          name: 'X',
          slugHint: 'a'.repeat(33),
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('throws ForbiddenException when caller has no active organization', async () => {
      const noOrgSession = {
        user: { id: 'user-orphan', role: 'admin' },
        session: { activeOrganizationId: null },
      } as never;

      await expect(
        controller.createCollection(noOrgSession, { name: 'X' }),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
      expect(airweaveService.createCollection).not.toHaveBeenCalled();
    });
  });
});
