import { jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
}));

import { OrgImpersonationController } from './org-impersonation.controller';
import { OrgImpersonationService } from '../../application/services';
import { PERMISSIONS_KEY, PermissionsGuard } from '../../../../../shared';

describe('OrgImpersonationController', () => {
  let controller: OrgImpersonationController;
  let impersonationService: jest.Mocked<OrgImpersonationService>;

  const baseSession = {
    user: { id: 'manager-1', role: 'manager' },
    session: { activeOrganizationId: 'org-1' },
  } as any;

  beforeEach(() => {
    impersonationService = {
      impersonateUser: jest.fn(),
      startImpersonation: jest.fn(),
      stopImpersonation: jest.fn(),
      getMembership: jest.fn(),
      canImpersonate: jest.fn(),
    } as unknown as jest.Mocked<OrgImpersonationService>;

    controller = new OrgImpersonationController(impersonationService);
  });

  it('applies permission-led guards on impersonate only', () => {
    const impersonateHandler = (controller as unknown as Record<string, unknown>).impersonate as object;
    const stopHandler = (controller as unknown as Record<string, unknown>).stopImpersonating as object;

    const guards = Reflect.getMetadata(GUARDS_METADATA, impersonateHandler) as unknown[];
    const permissions = Reflect.getMetadata(PERMISSIONS_KEY, impersonateHandler) as string[];

    expect(guards).toContain(PermissionsGuard);
    expect(permissions).toContain('user:impersonate');

    expect(Reflect.getMetadata(GUARDS_METADATA, stopHandler)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, stopHandler)).toBeUndefined();
  });

  describe('impersonate', () => {
    it('should return sessionToken on successful impersonation', async () => {
      impersonationService.startImpersonation.mockResolvedValue({
        sessionToken: 'new-session-token',
      });

      const result = await controller.impersonate(
        'org-1',
        { userId: 'user-1' },
        baseSession,
      );

      expect(result).toEqual({ success: true, sessionToken: 'new-session-token' });
      expect(impersonationService.startImpersonation).toHaveBeenCalledWith({
        actorUserId: 'manager-1',
        targetUserId: 'user-1',
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        organizationId: 'org-1',
      });
    });

    it('should throw ForbiddenException when session has no user', async () => {
      const sessionWithoutUser = {} as any;

      await expect(
        controller.impersonate('org-1', { userId: 'user-1' }, sessionWithoutUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when session is null', async () => {
      await expect(
        controller.impersonate('org-1', { userId: 'user-1' }, null as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should propagate service errors', async () => {
      impersonationService.startImpersonation.mockRejectedValue(
        new ForbiddenException('Not a member'),
      );

      await expect(
        controller.impersonate('org-1', { userId: 'user-1' }, baseSession),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('stopImpersonating', () => {
    it('should stop impersonation with valid Bearer token', async () => {
      impersonationService.stopImpersonation.mockResolvedValue(undefined);

      const mockRequest = {
        headers: { authorization: 'Bearer impersonation-token-123' },
      } as any;

      const result = await controller.stopImpersonating(mockRequest);

      expect(result).toEqual({ success: true });
      expect(impersonationService.stopImpersonation).toHaveBeenCalledWith(
        'impersonation-token-123',
      );
    });

    it('should throw ForbiddenException when no Authorization header', async () => {
      const mockRequest = { headers: {} } as any;

      await expect(controller.stopImpersonating(mockRequest)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when Authorization header is not Bearer', async () => {
      const mockRequest = {
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      } as any;

      await expect(controller.stopImpersonating(mockRequest)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should propagate service errors on stop', async () => {
      impersonationService.stopImpersonation.mockRejectedValue(
        new ForbiddenException('Not an impersonation session'),
      );

      const mockRequest = {
        headers: { authorization: 'Bearer some-token' },
      } as any;

      await expect(controller.stopImpersonating(mockRequest)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
