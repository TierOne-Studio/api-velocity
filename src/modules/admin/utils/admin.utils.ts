import { ForbiddenException } from '@nestjs/common';
import type { UserSession } from '@thallesp/nestjs-better-auth';

export type PlatformRole = 'superadmin' | 'admin' | 'manager' | 'member';

export function isSuperadminRole(
  role: string | string[] | null | undefined,
): boolean {
  if (Array.isArray(role)) {
    return role.includes('superadmin');
  }

  return String(role ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes('superadmin');
}

export function getPlatformRole(session: UserSession): PlatformRole {
  const role = (session?.user as { role?: string | string[] } | undefined)
    ?.role;
  if (Array.isArray(role)) {
    if (role.includes('superadmin')) return 'superadmin';
    if (role.includes('admin')) return 'admin';
    if (role.includes('manager')) return 'manager';
    return 'member';
  }

  if (
    role === 'superadmin' ||
    role === 'admin' ||
    role === 'manager' ||
    role === 'member'
  ) {
    return role;
  }

  return 'member';
}

export function getActiveOrganizationId(session: UserSession): string | null {
  const activeOrgId = (
    session?.session as { activeOrganizationId?: string } | undefined
  )?.activeOrganizationId;
  return activeOrgId ?? null;
}

export function requireActiveOrganizationIdForManager(
  platformRole: PlatformRole,
  session: UserSession,
): string | null {
  if (platformRole === 'superadmin') return null;
  const activeOrgId = getActiveOrganizationId(session);
  if (!activeOrgId) {
    throw new ForbiddenException('Active organization required');
  }
  return activeOrgId;
}

export function getAllowedRoleNamesForCreator(
  platformRole: PlatformRole,
): PlatformRole[] {
  if (platformRole === 'superadmin' || platformRole === 'admin') {
    return ['admin', 'manager', 'member'];
  }
  if (platformRole === 'manager') {
    return ['manager', 'member'];
  }
  return ['member'];
}
