import { jest } from '@jest/globals';

// Mock @thallesp/nestjs-better-auth at load time so the transitive admin
// barrel pulled in via AirweaveAuthorizationService doesn't break under jest.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AirweaveAuthorizationService } from '../../application/services/airweave-authorization.service';
import {
  AIRWEAVE_OWNERSHIP_KEY,
  type AirweaveOwnershipSource,
} from '../decorators/require-airweave-ownership.decorator';
import { AirweaveOwnershipGuard } from './airweave-ownership.guard';

const adminSession = {
  user: { id: 'user-admin', role: 'admin' },
  session: { activeOrganizationId: 'org-1' },
} as unknown as UserSession;

function makeContext(
  request: {
    session?: UserSession;
    params?: Record<string, unknown>;
    body?: Record<string, unknown>;
    url?: string;
    originalUrl?: string;
    method?: string;
  } = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function makeReflector(
  source: AirweaveOwnershipSource | undefined,
): Reflector {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: string) =>
      key === AIRWEAVE_OWNERSHIP_KEY ? source : undefined,
    );
  return reflector;
}

describe('AirweaveOwnershipGuard', () => {
  let authzService: jest.Mocked<AirweaveAuthorizationService>;
  let configService: { getAirweaveReadLockdownEnforce: jest.Mock };

  beforeEach(() => {
    authzService = {
      assertOwnership: jest.fn(),
      applyAirweaveAllowlist: jest.fn(),
    } as unknown as jest.Mocked<AirweaveAuthorizationService>;
    configService = {
      // Default — flag OFF mirrors production default; tests opt-in to ON.
      getAirweaveReadLockdownEnforce: jest.fn().mockReturnValue(false),
    };
  });

  function makeGuard(source: AirweaveOwnershipSource | undefined) {
    return new AirweaveOwnershipGuard(
      makeReflector(source),
      authzService as never,
      configService as never,
    );
  }

  it('returns true (no-op) when the handler is not decorated', async () => {
    const guard = makeGuard(undefined);

    const result = await guard.canActivate(
      makeContext({
        session: adminSession,
        params: { collectionId: 'irrelevant' },
      }),
    );

    expect(result).toBe(true);
    expect(authzService.assertOwnership).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when no session is attached to the request', async () => {
    const guard = makeGuard({ source: 'param', name: 'collectionId' });

    await expect(
      guard.canActivate(
        makeContext({ params: { collectionId: 'something' } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('route-param source', () => {
    const source: AirweaveOwnershipSource = {
      source: 'param',
      name: 'collectionId',
    };

    it('extracts the id from the named route param and delegates to assertOwnership', async () => {
      authzService.assertOwnership.mockResolvedValue(undefined);
      const guard = makeGuard(source);

      const result = await guard.canActivate(
        makeContext({
          session: adminSession,
          params: { collectionId: '  coll-1  ' },
        }),
      );

      expect(result).toBe(true);
      // Trimmed before delegation.
      expect(authzService.assertOwnership).toHaveBeenCalledWith(
        adminSession,
        'coll-1',
      );
    });

    it('throws BadRequestException when the param is missing', async () => {
      const guard = makeGuard(source);

      await expect(
        guard.canActivate(makeContext({ session: adminSession, params: {} })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the param is an empty string', async () => {
      const guard = makeGuard(source);

      await expect(
        guard.canActivate(
          makeContext({
            session: adminSession,
            params: { collectionId: '   ' },
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates ForbiddenException from assertOwnership when the org does not own the collection (flag ON)', async () => {
      // Step 10a: with flag OFF (default) the guard swallows + logs; the
      // ForbiddenException only propagates when the lockdown is enforced.
      configService.getAirweaveReadLockdownEnforce.mockReturnValue(true);
      authzService.assertOwnership.mockRejectedValue(
        new ForbiddenException(
          'Collection is not owned by your active organization',
        ),
      );
      const guard = makeGuard(source);

      await expect(
        guard.canActivate(
          makeContext({
            session: adminSession,
            params: { collectionId: 'legacy' },
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('request-body source', () => {
    const source: AirweaveOwnershipSource = {
      source: 'body',
      name: 'airweaveCollectionId',
    };

    it('extracts the id from the named body field and delegates to assertOwnership', async () => {
      authzService.assertOwnership.mockResolvedValue(undefined);
      const guard = makeGuard(source);

      const result = await guard.canActivate(
        makeContext({
          session: adminSession,
          body: { airweaveCollectionId: 'coll-from-body' },
        }),
      );

      expect(result).toBe(true);
      expect(authzService.assertOwnership).toHaveBeenCalledWith(
        adminSession,
        'coll-from-body',
      );
    });

    it('throws BadRequestException when the body field is non-string', async () => {
      const guard = makeGuard(source);

      await expect(
        guard.canActivate(
          makeContext({
            session: adminSession,
            body: { airweaveCollectionId: 42 },
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Step 10a: read-lockdown flag (observe vs enforce) ─────────────────

  describe('AIRWEAVE_READ_LOCKDOWN_ENFORCE flag', () => {
    const source: AirweaveOwnershipSource = {
      source: 'param',
      name: 'collectionId',
    };

    it('flag OFF (default) — ForbiddenException is swallowed + warning logged + request allowed', async () => {
      configService.getAirweaveReadLockdownEnforce.mockReturnValue(false);
      authzService.assertOwnership.mockRejectedValue(
        new ForbiddenException('not owned'),
      );
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const guard = makeGuard(source);

      const result = await guard.canActivate(
        makeContext({
          session: adminSession,
          params: { collectionId: 'legacy-coll' },
          url: '/api/airweave/collections/legacy-coll',
          method: 'GET',
        }),
      );

      expect(result).toBe(true);
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('airweave.read_would_403'),
      );
      const logged = loggerSpy.mock.calls[0][0] as string;
      // Structured fields included.
      expect(logged).toContain('"userId":"user-admin"');
      expect(logged).toContain('"orgId":"org-1"');
      expect(logged).toContain('"airweaveCollectionReadableId":"legacy-coll"');
      expect(logged).toContain('"route":"/api/airweave/collections/legacy-coll"');
      loggerSpy.mockRestore();
    });

    it('flag ON — ForbiddenException propagates (enforce mode)', async () => {
      configService.getAirweaveReadLockdownEnforce.mockReturnValue(true);
      authzService.assertOwnership.mockRejectedValue(
        new ForbiddenException('not owned'),
      );
      const guard = makeGuard(source);

      await expect(
        guard.canActivate(
          makeContext({
            session: adminSession,
            params: { collectionId: 'legacy-coll' },
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('flag does not affect non-ForbiddenException errors (still thrown)', async () => {
      configService.getAirweaveReadLockdownEnforce.mockReturnValue(false);
      authzService.assertOwnership.mockRejectedValue(
        new Error('unexpected database failure'),
      );
      const guard = makeGuard(source);

      await expect(
        guard.canActivate(
          makeContext({
            session: adminSession,
            params: { collectionId: 'coll-1' },
          }),
        ),
      ).rejects.toThrow('unexpected database failure');
    });
  });
});
