import { ForbiddenException } from '@nestjs/common';
import {
  getAllowedRoleNamesForCreator,
  getActiveOrganizationId,
  getPlatformRole,
  isSuperadminRole,
  requireActiveOrganizationIdForManager,
} from './admin.utils';

describe('admin.utils', () => {
  describe('isSuperadminRole', () => {
    it('returns true when role is superadmin string', () => {
      expect(isSuperadminRole('superadmin')).toBe(true);
    });

    it('returns false when role is a non-superadmin string', () => {
      expect(isSuperadminRole('admin')).toBe(false);
    });

    it('returns true when role is an array containing superadmin', () => {
      expect(isSuperadminRole(['admin', 'superadmin'])).toBe(true);
    });

    it('returns false when role is an array not containing superadmin', () => {
      expect(isSuperadminRole(['admin', 'manager'])).toBe(false);
    });

    it('returns false when role is null', () => {
      expect(isSuperadminRole(null)).toBe(false);
    });

    it('returns false when role is undefined', () => {
      expect(isSuperadminRole(undefined)).toBe(false);
    });

    it('returns true when role is a comma-separated string containing superadmin', () => {
      expect(isSuperadminRole('admin, superadmin, member')).toBe(true);
    });
  });

  describe('getAllowedRoleNamesForCreator', () => {
    it('should allow superadmin to create admin/manager/member', () => {
      expect(getAllowedRoleNamesForCreator('superadmin')).toEqual([
        'admin',
        'manager',
        'member',
      ]);
    });

    it('should allow admin to create admin/manager/member', () => {
      expect(getAllowedRoleNamesForCreator('admin')).toEqual([
        'admin',
        'manager',
        'member',
      ]);
    });

    it('should allow manager to create manager/member', () => {
      expect(getAllowedRoleNamesForCreator('manager')).toEqual([
        'manager',
        'member',
      ]);
    });

    it('should return only member for member platform role', () => {
      expect(getAllowedRoleNamesForCreator('member')).toEqual(['member']);
    });
  });

  describe('getPlatformRole', () => {
    it('should return admin for admin role', () => {
      expect(getPlatformRole({ user: { role: 'admin' } } as any)).toBe('admin');
    });

    it('should return superadmin for superadmin role', () => {
      expect(getPlatformRole({ user: { role: 'superadmin' } } as any)).toBe(
        'superadmin',
      );
    });

    it('should return manager for manager role', () => {
      expect(getPlatformRole({ user: { role: 'manager' } } as any)).toBe(
        'manager',
      );
    });

    it('should default to member for unknown role', () => {
      expect(getPlatformRole({ user: { role: 'something-else' } } as any)).toBe(
        'member',
      );
    });

    it('should handle role arrays — superadmin wins', () => {
      expect(
        getPlatformRole({ user: { role: ['superadmin', 'admin'] } } as any),
      ).toBe('superadmin');
    });

    it('should handle role arrays — admin wins when no superadmin', () => {
      expect(
        getPlatformRole({ user: { role: ['admin', 'member'] } } as any),
      ).toBe('admin');
    });

    it('should handle role arrays — manager when no admin', () => {
      expect(
        getPlatformRole({ user: { role: ['manager', 'member'] } } as any),
      ).toBe('manager');
    });

    it('should handle role arrays — falls back to member when no superadmin/admin/manager (line 12)', () => {
      expect(
        getPlatformRole({ user: { role: ['member', 'viewer'] } } as any),
      ).toBe('member');
    });

    it('should return member for role string member', () => {
      expect(getPlatformRole({ user: { role: 'member' } } as any)).toBe(
        'member',
      );
    });
  });

  describe('getActiveOrganizationId', () => {
    it('should read activeOrganizationId from session.session', () => {
      expect(
        getActiveOrganizationId({
          session: { activeOrganizationId: 'org-1' },
        } as any),
      ).toBe('org-1');
    });

    it('should return null when missing', () => {
      expect(getActiveOrganizationId({} as any)).toBeNull();
    });
  });

  describe('requireActiveOrganizationIdForManager', () => {
    it('should return null for superadmin regardless of session', () => {
      expect(
        requireActiveOrganizationIdForManager('superadmin', {} as any),
      ).toBeNull();
    });

    it('should return orgId for manager with active organization', () => {
      expect(
        requireActiveOrganizationIdForManager('manager', {
          session: { activeOrganizationId: 'org-1' },
        } as any),
      ).toBe('org-1');
    });

    it('should throw ForbiddenException for manager without active organization', () => {
      expect(() =>
        requireActiveOrganizationIdForManager('manager', {} as any),
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for manager with null activeOrganizationId', () => {
      expect(() =>
        requireActiveOrganizationIdForManager('manager', {
          session: { activeOrganizationId: undefined },
        } as any),
      ).toThrow(ForbiddenException);
    });
  });
});
