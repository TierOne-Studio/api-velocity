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
      createCollection: jest.fn(),
      updateCollection: jest.fn(),
      deleteCollection: jest.fn(),
      createSourceConnection: jest.fn(),
      updateSourceConnection: jest.fn(),
      deleteSourceConnection: jest.fn(),
      reauthSourceConnection: jest.fn(),
    } as unknown as jest.Mocked<AirweaveService>;

    authzService = {
      applyAirweaveAllowlist: jest.fn(),
      assertOwnership: jest.fn(),
      // ADR-011 amendment 5: body-level organizationId membership re-validation.
      verifyCallerMembership: jest.fn(),
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
        createdByUserId: 'user-admin',
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

    it('accepts slugHint of exactly 32 chars (boundary — QA gap #4)', async () => {
      (airweaveService.createCollection as jest.Mock).mockResolvedValue({
        id: 'uuid',
      } as never);

      await controller.createCollection(adminSession, {
        name: 'X',
        slugHint: 'a'.repeat(32),
      });

      expect(airweaveService.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ slugHint: 'a'.repeat(32) }),
      );
    });

    it.each([
      ['leading dash', '-foo'],
      ['trailing dash', 'foo-'],
      ['consecutive dashes', 'foo--bar'],
      ['uppercase', 'FOO'],
      ['unicode', 'café'],
      ['underscore', 'foo_bar'],
      ['space', 'foo bar'],
    ])('rejects slugHint with %s ("%s") — QA gap #5', async (_label, slug) => {
      await expect(
        controller.createCollection(adminSession, {
          name: 'X',
          slugHint: slug,
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

    // ── ADR-011 amendment 5: body-level organizationId ─────────────────────

    it('passes body.organizationId straight through when it matches the active org (regression baseline)', async () => {
      authzService.verifyCallerMembership.mockResolvedValue(undefined);
      (airweaveService.createCollection as jest.Mock).mockResolvedValue({
        id: 'uuid-x',
      } as never);

      await controller.createCollection(adminSession, {
        name: 'Foo',
        organizationId: 'org-1',
      });

      expect(authzService.verifyCallerMembership).toHaveBeenCalledWith(
        'user-admin',
        'org-1',
      );
      expect(airweaveService.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1' }),
      );
    });

    it('uses body.organizationId over active org when caller is a member of the cross-org', async () => {
      authzService.verifyCallerMembership.mockResolvedValue(undefined);
      (airweaveService.createCollection as jest.Mock).mockResolvedValue({
        id: 'uuid-x',
      } as never);

      await controller.createCollection(adminSession, {
        name: 'Foo',
        organizationId: 'org-2', // different from active (org-1)
      });

      expect(authzService.verifyCallerMembership).toHaveBeenCalledWith(
        'user-admin',
        'org-2',
      );
      expect(airweaveService.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-2' }),
      );
    });

    it('returns 403 when caller is not a member of body.organizationId', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      authzService.verifyCallerMembership.mockRejectedValue(
        new ForbiddenException('not a member'),
      );

      await expect(
        controller.createCollection(adminSession, {
          name: 'Foo',
          organizationId: 'org-not-mine',
        }),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
      expect(airweaveService.createCollection).not.toHaveBeenCalled();
    });

    it('returns 404 when body.organizationId does not exist', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      authzService.verifyCallerMembership.mockRejectedValue(
        new NotFoundException('org not found'),
      );

      await expect(
        controller.createCollection(adminSession, {
          name: 'Foo',
          organizationId: 'org-ghost',
        }),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      expect(airweaveService.createCollection).not.toHaveBeenCalled();
    });

    it('body.organizationId wins even when caller has no active org', async () => {
      const noOrgSession = {
        user: { id: 'user-orphan', role: 'admin' },
        session: { activeOrganizationId: null },
      } as never;
      authzService.verifyCallerMembership.mockResolvedValue(undefined);
      (airweaveService.createCollection as jest.Mock).mockResolvedValue({
        id: 'uuid-x',
      } as never);

      await controller.createCollection(noOrgSession, {
        name: 'Foo',
        organizationId: 'org-by-body',
      });

      expect(authzService.verifyCallerMembership).toHaveBeenCalledWith(
        'user-orphan',
        'org-by-body',
      );
      expect(airweaveService.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-by-body' }),
      );
    });

    it('rejects empty/whitespace body.organizationId with 400', async () => {
      await expect(
        controller.createCollection(adminSession, {
          name: 'Foo',
          organizationId: '   ',
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(authzService.verifyCallerMembership).not.toHaveBeenCalled();
      expect(airweaveService.createCollection).not.toHaveBeenCalled();
    });

    // QA gap fix — body.organizationId === null must NOT crash with a 500
    // (calling .trim() on null). It must reject with 400 like other
    // malformed inputs. See post-implementation qa-validator review.
    it('rejects null body.organizationId with 400 + actionable message (must not 500 with TypeError)', async () => {
      await expect(
        controller.createCollection(adminSession, {
          name: 'Foo',
          organizationId: null as unknown as string,
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        // The message must name the field so the SPA caller can debug; a
        // generic "bad request" would let a future refactor swap the guard
        // for a less explicit one without the test catching it.
        message: 'organizationId must be a string',
      });
      expect(authzService.verifyCallerMembership).not.toHaveBeenCalled();
      expect(airweaveService.createCollection).not.toHaveBeenCalled();
    });

    it.each([
      ['number', 42],
      ['array', ['org-1']],
      ['object', { id: 'org-1' }],
      ['boolean', true],
    ] as const)(
      'rejects non-string body.organizationId (%s) with 400 + actionable message',
      async (_label, badValue) => {
        await expect(
          controller.createCollection(adminSession, {
            name: 'Foo',
            organizationId: badValue as unknown as string,
          }),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          message: 'organizationId must be a string',
        });
        expect(authzService.verifyCallerMembership).not.toHaveBeenCalled();
        expect(airweaveService.createCollection).not.toHaveBeenCalled();
      },
    );

    it('skips membership re-validation when body.organizationId is omitted (active-org fallback)', async () => {
      (airweaveService.createCollection as jest.Mock).mockResolvedValue({
        id: 'uuid-x',
      } as never);

      await controller.createCollection(adminSession, { name: 'Foo' });

      expect(authzService.verifyCallerMembership).not.toHaveBeenCalled();
      expect(airweaveService.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1' }),
      );
    });
  });

  // ── PATCH /collections/:id (Step 5: rename) ──────────────────────────────

  describe('updateCollection', () => {
    it('delegates to AirweaveService.updateCollection with trimmed values', async () => {
      (airweaveService.updateCollection as jest.Mock).mockResolvedValue({
        id: 'uuid-1',
        name: 'Renamed',
      } as never);

      const result = await controller.updateCollection('  acme-foo-abc  ', {
        name: '  Renamed  ',
      });

      expect(airweaveService.updateCollection).toHaveBeenCalledWith(
        'acme-foo-abc',
        { name: 'Renamed' },
      );
      expect(result).toEqual({ data: { id: 'uuid-1', name: 'Renamed' } });
    });

    it('rejects empty name with 400', async () => {
      await expect(
        controller.updateCollection('coll-1', { name: '   ' }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });

  // ── DELETE /collections/:id (Step 5: 409 on refs / 200 on clean) ─────────

  describe('deleteCollection', () => {
    it('delegates to AirweaveService.deleteCollection with the active org id', async () => {
      (airweaveService.deleteCollection as jest.Mock).mockResolvedValue(
        undefined as never,
      );

      const result = await controller.deleteCollection(
        adminSession,
        'acme-foo-abc',
      );

      expect(airweaveService.deleteCollection).toHaveBeenCalledWith(
        'acme-foo-abc',
        'org-1',
      );
      expect(result).toEqual({
        data: { deleted: true, collectionId: 'acme-foo-abc' },
      });
    });

    it('throws ForbiddenException when caller has no active organization', async () => {
      const noOrgSession = {
        user: { id: 'user-super', role: 'superadmin' },
        session: { activeOrganizationId: null },
      } as never;

      await expect(
        controller.deleteCollection(noOrgSession, 'coll-1'),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
      expect(airweaveService.deleteCollection).not.toHaveBeenCalled();
    });
  });

  // ── POST /collections/:id/source-connections (Step 6: direct only) ───────

  describe('createSourceConnection', () => {
    it('direct branch — delegates to AirweaveService.createSourceConnection', async () => {
      (airweaveService.createSourceConnection as jest.Mock).mockResolvedValue(
        { sourceConnection: { id: 'src-1' } } as never,
      );

      const result = await controller.createSourceConnection(
        adminSession,
        '  acme-foo-abc  ',
        {
          name: '  Slack Workspace  ',
          shortName: '  slack  ',
          authentication: {
            kind: 'direct',
            credentials: { token: 'xoxb-...' },
          },
        },
      );

      expect(airweaveService.createSourceConnection).toHaveBeenCalledWith({
        collectionReadableId: 'acme-foo-abc',
        name: 'Slack Workspace',
        shortName: 'slack',
        authentication: { kind: 'direct', credentials: { token: 'xoxb-...' } },
      });
      expect(result).toEqual({ data: { sourceConnection: { id: 'src-1' } } });
    });

    it('OAuth branch — REJECTED with 400 + clear explanation pointing at the new flow (ADR-011 Amendment 4)', async () => {
      // The OAuth branch of this endpoint was removed in Amendment 4
      // because pre-creating a source-connection breaks the catalog-
      // widget UX (user gets a single-source pre-pinned modal instead
      // of the source picker). New flow: POST /api/airweave/connect/session
      // + SDK widget creates the source-connection after user authenticates.
      const promise = controller.createSourceConnection(
        adminSession,
        'acme-foo-abc',
        {
          name: 'Slack',
          shortName: 'slack',
          authentication: { kind: 'oauth' } as never,
        },
      );
      await expect(promise).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
      await expect(promise).rejects.toThrow(/connect\/session/);
      await expect(promise).rejects.toThrow(/Amendment 4/);
      // Service must NOT be called — the rejection happens at the
      // controller boundary, no source-connection is created.
      expect(airweaveService.createSourceConnection).not.toHaveBeenCalled();
    });

    it('rejects an unknown authentication.kind with 400', async () => {
      await expect(
        controller.createSourceConnection(adminSession, 'acme-foo-abc', {
          name: 'X',
          shortName: 'slack',
          authentication: { kind: 'magic' } as never,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('rejects empty shortName with 400', async () => {
      await expect(
        controller.createSourceConnection(adminSession, 'acme-foo-abc', {
          name: 'X',
          shortName: '   ',
          authentication: { kind: 'direct', credentials: {} },
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('direct branch — rejects non-object credentials with 400', async () => {
      await expect(
        controller.createSourceConnection(adminSession, 'acme-foo-abc', {
          name: 'X',
          shortName: 'slack',
          authentication: {
            kind: 'direct',
            credentials: 'not-an-object' as never,
          },
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });

  // ── Step 7: source-connection mutations (inline lookup-then-gate) ─────

  describe('source-connection mutation endpoints', () => {
    it('updateSourceConnection — delegates with trimmed values', async () => {
      (airweaveService.updateSourceConnection as jest.Mock).mockResolvedValue(
        { id: 'src-1', name: 'Renamed' } as never,
      );

      const result = await controller.updateSourceConnection(
        adminSession,
        '  src-uuid-1  ',
        { name: '  Renamed  ' },
      );

      expect(airweaveService.updateSourceConnection).toHaveBeenCalledWith(
        'src-uuid-1',
        adminSession,
        { name: 'Renamed' },
      );
      expect(result).toEqual({ data: { id: 'src-1', name: 'Renamed' } });
    });

    it('updateSourceConnection — rejects empty name with 400', async () => {
      await expect(
        controller.updateSourceConnection(adminSession, 'src-1', {
          name: '   ',
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('reauthSourceConnection — delegates and returns sessionToken envelope', async () => {
      (airweaveService.reauthSourceConnection as jest.Mock).mockResolvedValue(
        { sessionToken: 'connect-tok' } as never,
      );

      const result = await controller.reauthSourceConnection(
        adminSession,
        'src-1',
      );

      expect(airweaveService.reauthSourceConnection).toHaveBeenCalledWith(
        'src-1',
        adminSession,
      );
      expect(result).toEqual({ data: { sessionToken: 'connect-tok' } });
    });

    it('deleteSourceConnection — delegates and returns deleted envelope', async () => {
      (airweaveService.deleteSourceConnection as jest.Mock).mockResolvedValue(
        undefined as never,
      );

      const result = await controller.deleteSourceConnection(
        adminSession,
        'src-1',
      );

      expect(airweaveService.deleteSourceConnection).toHaveBeenCalledWith(
        'src-1',
        adminSession,
      );
      expect(result).toEqual({
        data: { deleted: true, sourceConnectionId: 'src-1' },
      });
    });
  });
});
