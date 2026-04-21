import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { getActiveOrganizationId, getPlatformRole } from './admin.utils';

/**
 * Represents the organization scope resolved from a caller's session + query params.
 *
 * - `mode: 'all'` — cross-organization view (superadmin only; requires explicit `scope=all`).
 * - `mode: 'single'` — scoped to exactly one org id (active org, or explicitly provided).
 */
export type OrgScope =
  | { mode: 'all' }
  | { mode: 'single'; organizationId: string };

export interface OrgScopeQuery {
  organizationId?: string;
  scope?: string;
}

/**
 * Resolve the organization scope for a request.
 *
 * Resolution rule:
 *   scope=all  AND platformRole=superadmin  → { mode: 'all' }
 *   scope=all  AND any other role           → 400 BadRequest
 *   organizationId=X (non-empty)            → { mode: 'single', organizationId: X }
 *   neither                                 → falls back to activeOrganizationId
 *                                             (403 if missing)
 *
 * Callers downstream are responsible for authz — this helper only resolves intent.
 */
export function resolveOrgScope(
  session: UserSession,
  query: OrgScopeQuery,
): OrgScope {
  const platformRole = getPlatformRole(session);

  if (query.scope === 'all') {
    if (platformRole !== 'superadmin') {
      throw new BadRequestException(
        'scope=all is only permitted for superadmin',
      );
    }
    return { mode: 'all' };
  }

  const explicitOrganizationId = query.organizationId?.trim();
  if (explicitOrganizationId) {
    return { mode: 'single', organizationId: explicitOrganizationId };
  }

  const activeOrganizationId = getActiveOrganizationId(session);
  if (!activeOrganizationId) {
    throw new ForbiddenException(
      'Active organization required (set via session or pass organizationId / scope=all)',
    );
  }

  return { mode: 'single', organizationId: activeOrganizationId };
}
