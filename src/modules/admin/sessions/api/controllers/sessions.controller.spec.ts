import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionsController } from './sessions.controller';
import { SessionsService } from '../../application/services/sessions.service';
import { PERMISSIONS_KEY, PermissionsGuard } from '../../../../../shared';

describe('SessionsController', () => {
  let controller: SessionsController;
  let sessionsService: jest.Mocked<SessionsService>;

  const superadminSession = {
    user: { id: 'actor-superadmin', role: 'superadmin' },
    session: {},
  } as any;

  const managerSession = {
    user: { id: 'actor-mgr', role: 'manager' },
    session: { activeOrganizationId: 'org-1' },
  } as any;

  beforeEach(() => {
    sessionsService = {
      listUserSessions: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllSessions: jest.fn(),
    } as any;
    controller = new SessionsController(sessionsService);
  });

  // ─── class-level metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('applies PermissionsGuard at class level', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, SessionsController);
      expect(guards).toContain(PermissionsGuard);
    });

    it('requires session:read permission on listSessions', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.listSessions,
      );
      expect(permissions).toContain('session:read');
    });

    it('requires session:revoke permission on revokeSession', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.revokeSession,
      );
      expect(permissions).toContain('session:revoke');
    });

    it('requires session:revoke permission on revokeAll', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.revokeAll,
      );
      expect(permissions).toContain('session:revoke');
    });
  });

  // ─── listSessions ────────────────────────────────────────────────────────

  describe('listSessions', () => {
    it('delegates to service with superadmin role and null activeOrganizationId', async () => {
      sessionsService.listUserSessions.mockResolvedValue([{ id: 's1' }] as any);

      const result = await controller.listSessions(superadminSession, 'user-1');

      expect(sessionsService.listUserSessions).toHaveBeenCalledWith({
        userId: 'user-1',
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });
      expect(result).toEqual([{ id: 's1' }]);
    });

    it('propagates activeOrganizationId for manager session', async () => {
      sessionsService.listUserSessions.mockResolvedValue([] as any);

      await controller.listSessions(managerSession, 'user-2');

      expect(sessionsService.listUserSessions).toHaveBeenCalledWith({
        userId: 'user-2',
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
      });
    });

    it('allows superadmin to scope with ?organizationId', async () => {
      sessionsService.listUserSessions.mockResolvedValue([] as any);

      await controller.listSessions(superadminSession, 'user-1', 'org-42');

      expect(sessionsService.listUserSessions).toHaveBeenCalledWith({
        userId: 'user-1',
        platformRole: 'superadmin',
        activeOrganizationId: 'org-42',
      });
    });

    it('rejects non-superadmin ?organizationId that does not match active org', async () => {
      await expect(
        controller.listSessions(managerSession, 'user-2', 'org-other'),
      ).rejects.toThrow('You can only manage sessions in your active organization');
    });

    it('accepts non-superadmin ?organizationId that matches active org', async () => {
      sessionsService.listUserSessions.mockResolvedValue([] as any);

      await controller.listSessions(managerSession, 'user-2', 'org-1');

      expect(sessionsService.listUserSessions).toHaveBeenCalledWith({
        userId: 'user-2',
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
      });
    });
  });

  // ─── revokeSession ───────────────────────────────────────────────────────

  describe('revokeSession', () => {
    it('delegates to service with superadmin role and null activeOrganizationId', async () => {
      sessionsService.revokeSession.mockResolvedValue({ success: true });

      const result = await controller.revokeSession(superadminSession, {
        sessionToken: 'token1',
      });

      expect(sessionsService.revokeSession).toHaveBeenCalledWith(
        { sessionToken: 'token1' },
        'superadmin',
        null,
      );
      expect(result).toEqual({ success: true });
    });

    it('propagates activeOrganizationId for manager session', async () => {
      sessionsService.revokeSession.mockResolvedValue({ success: true });

      await controller.revokeSession(managerSession, { sessionToken: 'tok' });

      expect(sessionsService.revokeSession).toHaveBeenCalledWith(
        { sessionToken: 'tok' },
        'manager',
        'org-1',
      );
    });

    it('allows superadmin to scope with ?organizationId', async () => {
      sessionsService.revokeSession.mockResolvedValue({ success: true });

      await controller.revokeSession(
        superadminSession,
        { sessionToken: 'tok' },
        'org-42',
      );

      expect(sessionsService.revokeSession).toHaveBeenCalledWith(
        { sessionToken: 'tok' },
        'superadmin',
        'org-42',
      );
    });

    it('rejects empty sessionToken', async () => {
      await expect(
        controller.revokeSession(superadminSession, { sessionToken: '' }),
      ).rejects.toThrow('sessionToken is required');
    });

    it('rejects whitespace-only sessionToken', async () => {
      await expect(
        controller.revokeSession(superadminSession, { sessionToken: '   ' }),
      ).rejects.toThrow('sessionToken is required');
    });

    it('rejects null sessionToken', async () => {
      await expect(
        controller.revokeSession(superadminSession, {
          sessionToken: null as any,
        }),
      ).rejects.toThrow('sessionToken is required');
    });

    it('rejects undefined sessionToken', async () => {
      await expect(
        controller.revokeSession(superadminSession, {
          sessionToken: undefined as any,
        }),
      ).rejects.toThrow('sessionToken is required');
    });
  });

  // ─── revokeAll ───────────────────────────────────────────────────────────

  describe('revokeAll', () => {
    it('delegates to service with superadmin role and null activeOrganizationId', async () => {
      sessionsService.revokeAllSessions.mockResolvedValue({ success: true });

      const result = await controller.revokeAll(superadminSession, 'user-1');

      expect(sessionsService.revokeAllSessions).toHaveBeenCalledWith(
        { userId: 'user-1' },
        'superadmin',
        null,
      );
      expect(result).toEqual({ success: true });
    });

    it('propagates activeOrganizationId for manager session', async () => {
      sessionsService.revokeAllSessions.mockResolvedValue({ success: true });

      await controller.revokeAll(managerSession, 'user-2');

      expect(sessionsService.revokeAllSessions).toHaveBeenCalledWith(
        { userId: 'user-2' },
        'manager',
        'org-1',
      );
    });

    it('allows superadmin to scope with ?organizationId', async () => {
      sessionsService.revokeAllSessions.mockResolvedValue({ success: true });

      await controller.revokeAll(superadminSession, 'user-1', 'org-42');

      expect(sessionsService.revokeAllSessions).toHaveBeenCalledWith(
        { userId: 'user-1' },
        'superadmin',
        'org-42',
      );
    });

    it('rejects non-superadmin ?organizationId that does not match active org', async () => {
      await expect(
        controller.revokeAll(managerSession, 'user-2', 'org-other'),
      ).rejects.toThrow(
        'You can only manage sessions in your active organization',
      );
    });
  });
});
