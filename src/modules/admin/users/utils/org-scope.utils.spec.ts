import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { resolveOrgScope } from './org-scope.utils';

function buildSession(params: {
  role?: string | string[];
  activeOrganizationId?: string | null;
}): UserSession {
  return {
    user: { role: params.role },
    session: { activeOrganizationId: params.activeOrganizationId ?? undefined },
  } as unknown as UserSession;
}

describe('resolveOrgScope', () => {
  describe('scope=all', () => {
    it('returns mode=all when superadmin requests scope=all', () => {
      const session = buildSession({ role: 'superadmin' });

      const scope = resolveOrgScope(session, { scope: 'all' });

      expect(scope).toEqual({ mode: 'all' });
    });

    it('returns mode=all when superadmin requests scope=all even if organizationId also present (scope wins)', () => {
      const session = buildSession({ role: 'superadmin' });

      const scope = resolveOrgScope(session, {
        scope: 'all',
        organizationId: 'org-123',
      });

      expect(scope).toEqual({ mode: 'all' });
    });

    it('throws BadRequest when non-superadmin requests scope=all', () => {
      const session = buildSession({
        role: 'admin',
        activeOrganizationId: 'org-1',
      });

      expect(() => resolveOrgScope(session, { scope: 'all' })).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequest for member requesting scope=all', () => {
      const session = buildSession({
        role: 'member',
        activeOrganizationId: 'org-1',
      });

      expect(() => resolveOrgScope(session, { scope: 'all' })).toThrow(
        BadRequestException,
      );
    });

    it('ignores unknown scope values and falls through to org resolution', () => {
      const session = buildSession({
        role: 'admin',
        activeOrganizationId: 'org-active',
      });

      const scope = resolveOrgScope(session, { scope: 'bogus' });

      expect(scope).toEqual({ mode: 'single', organizationId: 'org-active' });
    });
  });

  describe('explicit organizationId', () => {
    it('returns the provided organizationId as single mode', () => {
      const session = buildSession({
        role: 'admin',
        activeOrganizationId: 'org-active',
      });

      const scope = resolveOrgScope(session, { organizationId: 'org-target' });

      expect(scope).toEqual({ mode: 'single', organizationId: 'org-target' });
    });

    it('trims whitespace-only organizationId and falls back to active', () => {
      const session = buildSession({
        role: 'admin',
        activeOrganizationId: 'org-active',
      });

      const scope = resolveOrgScope(session, { organizationId: '   ' });

      expect(scope).toEqual({ mode: 'single', organizationId: 'org-active' });
    });

    it('allows superadmin to target any organizationId', () => {
      const session = buildSession({ role: 'superadmin' });

      const scope = resolveOrgScope(session, { organizationId: 'org-any' });

      expect(scope).toEqual({ mode: 'single', organizationId: 'org-any' });
    });
  });

  describe('neither scope nor organizationId provided', () => {
    it('falls back to activeOrganizationId for non-superadmin', () => {
      const session = buildSession({
        role: 'manager',
        activeOrganizationId: 'org-active',
      });

      const scope = resolveOrgScope(session, {});

      expect(scope).toEqual({ mode: 'single', organizationId: 'org-active' });
    });

    it('falls back to activeOrganizationId for superadmin with active org', () => {
      const session = buildSession({
        role: 'superadmin',
        activeOrganizationId: 'org-active',
      });

      const scope = resolveOrgScope(session, {});

      expect(scope).toEqual({ mode: 'single', organizationId: 'org-active' });
    });

    it('throws Forbidden for non-superadmin without active org', () => {
      const session = buildSession({
        role: 'member',
        activeOrganizationId: null,
      });

      expect(() => resolveOrgScope(session, {})).toThrow(ForbiddenException);
    });

    it('throws Forbidden for superadmin without active org (must choose scope or organizationId)', () => {
      const session = buildSession({
        role: 'superadmin',
        activeOrganizationId: null,
      });

      expect(() => resolveOrgScope(session, {})).toThrow(ForbiddenException);
    });
  });
});
