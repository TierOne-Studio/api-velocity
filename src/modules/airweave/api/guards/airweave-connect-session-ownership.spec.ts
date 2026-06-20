import { jest } from '@jest/globals';

// Mock better-auth at load time (transitive admin barrel via the controller +
// authz service breaks under jest otherwise) — mirrors the guard spec.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class { /* mock guard stub */ },
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class { /* mock module stub */ } })) },
}));

import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AirweaveAuthorizationService } from '../../application/services/airweave-authorization.service';
import { AirweaveController } from '../controllers/airweave.controller';
import { AIRWEAVE_OWNERSHIP_KEY } from '../decorators/require-airweave-ownership.decorator';
import { AirweaveOwnershipGuard } from './airweave-ownership.guard';

/**
 * BE-3 — connect/session body-field ↔ ownership-guard coupling.
 *
 * The `@RequireAirweaveOwnershipFromBody('airweaveCollectionId')` decorator on
 * `createConnectSession` and the guard's `request.body[name]` read are a
 * compiler-INVISIBLE coupling: a mismatch 400s every connect/session call and
 * `tsc` can't catch it. The live e2e (`airweave-live.spec.ts`) hits the real
 * Airweave SDK and is environment-gated, so this deterministic test pins the
 * wiring by reading the REAL decorator metadata off the controller handler and
 * driving the REAL guard against it. It fails if the body field is renamed on
 * one side but not the other.
 */
describe('connect/session ownership coupling (airweaveCollectionId body field)', () => {
  const handler = AirweaveController.prototype.createConnectSession;

  const session = {
    user: { id: 'user-1', role: 'admin' },
    session: { activeOrganizationId: 'org-1' },
  } as unknown as UserSession;

  function makeContext(body: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ session, body }),
        getResponse: () => ({}),
        getNext: () => () => undefined,
      }),
      getHandler: () => handler,
      getClass: () => AirweaveController,
    } as unknown as ExecutionContext;
  }

  let authz: jest.Mocked<AirweaveAuthorizationService>;
  let guard: AirweaveOwnershipGuard;

  beforeEach(() => {
    authz = {
      assertOwnership: jest.fn(),
      applyAirweaveAllowlist: jest.fn(),
    } as unknown as jest.Mocked<AirweaveAuthorizationService>;
    const configService = {
      getAirweaveReadLockdownEnforce: jest.fn().mockReturnValue(true),
    };
    guard = new AirweaveOwnershipGuard(
      new Reflector(),
      authz as never,
      configService as never,
    );
  });

  it('decorator metadata pins the body field to "airweaveCollectionId"', () => {
    const meta = new Reflector().get(AIRWEAVE_OWNERSHIP_KEY, handler);
    expect(meta).toEqual({ source: 'body', name: 'airweaveCollectionId' });
  });

  it('guard reads body.airweaveCollectionId and authorizes when owned', async () => {
    authz.assertOwnership.mockResolvedValue(undefined as never);

    await expect(
      guard.canActivate(makeContext({ airweaveCollectionId: 'kb-owned' })),
    ).resolves.toBe(true);

    expect(authz.assertOwnership).toHaveBeenCalledWith(session, 'kb-owned');
  });

  it('rejects the OLD body field name (collectionId) with 400 — coupling proof', async () => {
    await expect(
      guard.canActivate(makeContext({ collectionId: 'kb-owned' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(authz.assertOwnership).not.toHaveBeenCalled();
  });

  it('propagates a 403 when the caller does not own the collection', async () => {
    authz.assertOwnership.mockRejectedValue(
      new ForbiddenException('not owned') as never,
    );

    await expect(
      guard.canActivate(makeContext({ airweaveCollectionId: 'kb-foreign' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
