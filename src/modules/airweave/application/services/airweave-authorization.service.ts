import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UserSession } from '@thallesp/nestjs-better-auth';
// Deep imports avoid the admin barrel, which transitively pulls
// `AdminService` and its ESM-only `better-auth/crypto` dependency that
// breaks jest's CommonJS module loader. The barrel works fine at runtime
// (NestJS handles ESM interop) — this is purely a test-load concern.
import { AdminOrganizationsService } from '../../../admin/organizations/application/services/admin-organizations.service';
import {
  getActiveOrganizationId,
  getPlatformRole,
} from '../../../admin/users/utils/admin.utils';
import type { AirweaveCollectionSummary } from './airweave.service';

/**
 * Centralizes Airweave collection-ownership decisions for both the LIST
 * filter (silent — narrows the response) and the per-collection gate
 * (loud — throws 403).
 *
 * Ownership is recorded by presence of the collection's `readable_id` in
 * `organization.metadata.allowedAirweaveCollectionIds: string[]`. See
 * ADR-011 § Decision 1 for the rationale (single source of truth, no
 * dedicated mapping table).
 *
 * Two consumers:
 *   - `AirweaveController.listCollections` → `applyAirweaveAllowlist` to
 *     silently filter the response (legacy behavior, preserved).
 *   - `AirweaveOwnershipGuard` AND inline gates on source-connection
 *     service methods → `assertOwnership(...)` to throw 403 on miss.
 *
 * Superadmin bypasses both branches (matches `PermissionsGuard`).
 */
@Injectable()
export class AirweaveAuthorizationService {
  constructor(
    private readonly adminOrganizationsService: AdminOrganizationsService,
  ) {}

  /**
   * Narrow a list of Airweave collections to those the caller's active
   * organization is allowed to see. Superadmin sees all.
   *
   * Returns `[]` when there is no active organization OR the active org's
   * allowlist is empty. NEVER throws — silent-filter semantics for LIST.
   */
  async applyAirweaveAllowlist(
    collections: AirweaveCollectionSummary[],
    session: UserSession,
  ): Promise<AirweaveCollectionSummary[]> {
    if (getPlatformRole(session) === 'superadmin') return collections;

    const activeOrgId = getActiveOrganizationId(session);
    if (!activeOrgId) return [];

    const organization =
      await this.adminOrganizationsService.findById(activeOrgId);
    if (!organization) return [];

    const allowed = this.readAllowedAirweaveCollectionIds(
      organization.metadata,
    );
    if (allowed.length === 0) return [];

    const allowedSet = new Set(allowed);
    return collections.filter((collection) =>
      allowedSet.has(collection.readableId),
    );
  }

  /**
   * Throw `ForbiddenException` unless the caller's active organization
   * owns the collection (i.e. the `readable_id` is in the allowlist) OR
   * the caller is a platform superadmin.
   *
   * Distinct, explicit error messages for the four failure modes so the
   * frontend and operators can disambiguate without parsing strings.
   */
  async assertOwnership(
    session: UserSession,
    collectionReadableId: string,
  ): Promise<void> {
    if (getPlatformRole(session) === 'superadmin') return;

    const activeOrgId = getActiveOrganizationId(session);
    if (!activeOrgId) {
      throw new ForbiddenException(
        'Active organization required to access this Airweave collection',
      );
    }

    const isOwned =
      await this.adminOrganizationsService.isAirweaveCollectionInAllowlist(
        activeOrgId,
        collectionReadableId,
      );

    if (!isOwned) {
      throw new ForbiddenException(
        'Collection is not owned by your active organization. ' +
          'Legacy collections must be claimed by a superadmin before they can be managed from Velocity.',
      );
    }
  }

  /**
   * Re-validate that `userId` is a member of `organizationId`. Used by
   * `AirweaveController.createCollection` when the caller supplies a body
   * `organizationId` (ADR-011 amendment 5).
   *
   * Throws `NotFoundException` if the org doesn't exist (404), and
   * `ForbiddenException` if the org exists but the caller is not a member
   * (403). Distinct status codes are intentional — the SPA disambiguates
   * "did I type the wrong org id" vs "I'm not allowed in that org."
   *
   * Superadmin is NOT exempted from this check. Membership is a
   * data-isolation primitive, not a permission grant — even superadmin
   * cannot CREATE collections in an org they're not a member of.
   */
  async verifyCallerMembership(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const organization =
      await this.adminOrganizationsService.findById(organizationId);
    if (!organization) {
      throw new NotFoundException(
        `Organization ${organizationId} not found`,
      );
    }
    const isMember = await this.adminOrganizationsService.isUserMemberOf(
      userId,
      organizationId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        `Caller is not a member of organization ${organizationId}`,
      );
    }
  }

  private readAllowedAirweaveCollectionIds(
    metadata: Record<string, unknown> | null,
  ): string[] {
    if (!metadata) return [];
    const raw = metadata['allowedAirweaveCollectionIds'];
    if (!Array.isArray(raw)) return [];
    return raw.filter((value): value is string => typeof value === 'string');
  }
}
