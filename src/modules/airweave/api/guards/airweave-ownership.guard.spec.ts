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

  beforeEach(() => {
    authzService = {
      assertOwnership: jest.fn(),
      applyAirweaveAllowlist: jest.fn(),
    } as unknown as jest.Mocked<AirweaveAuthorizationService>;
  });

  it('returns true (no-op) when the handler is not decorated', async () => {
    const guard = new AirweaveOwnershipGuard(
      makeReflector(undefined),
      authzService as never,
    );

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
    const guard = new AirweaveOwnershipGuard(
      makeReflector({ source: 'param', name: 'collectionId' }),
      authzService as never,
    );

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
      const guard = new AirweaveOwnershipGuard(
        makeReflector(source),
        authzService as never,
      );

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
      const guard = new AirweaveOwnershipGuard(
        makeReflector(source),
        authzService as never,
      );

      await expect(
        guard.canActivate(makeContext({ session: adminSession, params: {} })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the param is an empty string', async () => {
      const guard = new AirweaveOwnershipGuard(
        makeReflector(source),
        authzService as never,
      );

      await expect(
        guard.canActivate(
          makeContext({
            session: adminSession,
            params: { collectionId: '   ' },
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates ForbiddenException from assertOwnership when the org does not own the collection', async () => {
      authzService.assertOwnership.mockRejectedValue(
        new ForbiddenException('Collection is not owned by your active organization'),
      );
      const guard = new AirweaveOwnershipGuard(
        makeReflector(source),
        authzService as never,
      );

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
      name: 'collectionId',
    };

    it('extracts the id from the named body field and delegates to assertOwnership', async () => {
      authzService.assertOwnership.mockResolvedValue(undefined);
      const guard = new AirweaveOwnershipGuard(
        makeReflector(source),
        authzService as never,
      );

      const result = await guard.canActivate(
        makeContext({
          session: adminSession,
          body: { collectionId: 'coll-from-body' },
        }),
      );

      expect(result).toBe(true);
      expect(authzService.assertOwnership).toHaveBeenCalledWith(
        adminSession,
        'coll-from-body',
      );
    });

    it('throws BadRequestException when the body field is non-string', async () => {
      const guard = new AirweaveOwnershipGuard(
        makeReflector(source),
        authzService as never,
      );

      await expect(
        guard.canActivate(
          makeContext({
            session: adminSession,
            body: { collectionId: 42 },
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
