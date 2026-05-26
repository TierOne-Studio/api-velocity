import { jest } from '@jest/globals';

// Same workaround as airweave.controller.spec.ts — the admin barrel chain
// transitively imports @thallesp/nestjs-better-auth, which doesn't load in
// jest without this mock. The mock surface is read-only at load time.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import { ForbiddenException } from '@nestjs/common';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { AdminOrganizationsService } from '../../../admin/organizations/application/services/admin-organizations.service';
import { AirweaveAuthorizationService } from './airweave-authorization.service';
import type { AirweaveCollectionSummary } from './airweave.service';

const superadminSession = {
  user: { id: 'user-super', role: 'superadmin' },
  session: { activeOrganizationId: null },
} as unknown as UserSession;

const adminSession = {
  user: { id: 'user-admin', role: 'admin' },
  session: { activeOrganizationId: 'org-1' },
} as unknown as UserSession;

const noOrgSession = {
  user: { id: 'user-orphan', role: 'admin' },
  session: { activeOrganizationId: null },
} as unknown as UserSession;

function makeCollection(
  readableId: string,
): AirweaveCollectionSummary {
  return {
    id: `id-${readableId}`,
    name: `Name ${readableId}`,
    readableId,
    organizationId: 'airweave-org',
    createdAt: '',
    updatedAt: '',
    status: null,
    sourceConnectionCount: 0,
  };
}

describe('AirweaveAuthorizationService', () => {
  let service: AirweaveAuthorizationService;
  let orgService: jest.Mocked<AdminOrganizationsService>;

  beforeEach(() => {
    orgService = {
      findById: jest.fn(),
      isAirweaveCollectionInAllowlist: jest.fn(),
    } as unknown as jest.Mocked<AdminOrganizationsService>;
    service = new AirweaveAuthorizationService(orgService);
  });

  describe('applyAirweaveAllowlist', () => {
    it('returns the input untouched when the caller is a superadmin', async () => {
      const collections = [makeCollection('a'), makeCollection('b')];

      const result = await service.applyAirweaveAllowlist(
        collections,
        superadminSession,
      );

      expect(result).toEqual(collections);
      expect(orgService.findById).not.toHaveBeenCalled();
    });

    it('returns an empty list when the caller has no active organization', async () => {
      const result = await service.applyAirweaveAllowlist(
        [makeCollection('a')],
        noOrgSession,
      );

      expect(result).toEqual([]);
      expect(orgService.findById).not.toHaveBeenCalled();
    });

    it('returns an empty list when the active organization cannot be found', async () => {
      orgService.findById.mockResolvedValue(null as never);

      const result = await service.applyAirweaveAllowlist(
        [makeCollection('a')],
        adminSession,
      );

      expect(result).toEqual([]);
    });

    it('returns an empty list when the active organization has no allowlist', async () => {
      orgService.findById.mockResolvedValue({
        id: 'org-1',
        metadata: null,
      } as never);

      const result = await service.applyAirweaveAllowlist(
        [makeCollection('a')],
        adminSession,
      );

      expect(result).toEqual([]);
    });

    it('returns only the collections present in the allowlist', async () => {
      orgService.findById.mockResolvedValue({
        id: 'org-1',
        metadata: { allowedAirweaveCollectionIds: ['allowed-1', 'allowed-3'] },
      } as never);

      const result = await service.applyAirweaveAllowlist(
        [
          makeCollection('allowed-1'),
          makeCollection('forbidden-2'),
          makeCollection('allowed-3'),
        ],
        adminSession,
      );

      expect(result.map((c) => c.readableId)).toEqual([
        'allowed-1',
        'allowed-3',
      ]);
    });

    it('ignores non-string allowlist entries', async () => {
      orgService.findById.mockResolvedValue({
        id: 'org-1',
        metadata: { allowedAirweaveCollectionIds: ['ok', 42, null, true] },
      } as never);

      const result = await service.applyAirweaveAllowlist(
        [makeCollection('ok'), makeCollection('not-listed')],
        adminSession,
      );

      expect(result.map((c) => c.readableId)).toEqual(['ok']);
    });
  });

  describe('assertOwnership', () => {
    it('returns silently for superadmin without checking the allowlist', async () => {
      await expect(
        service.assertOwnership(superadminSession, 'any-id'),
      ).resolves.toBeUndefined();

      expect(
        orgService.isAirweaveCollectionInAllowlist,
      ).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when there is no active organization', async () => {
      await expect(
        service.assertOwnership(noOrgSession, 'coll-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.assertOwnership(noOrgSession, 'coll-1'),
      ).rejects.toThrow(/Active organization required/i);
    });

    it('returns silently when the active organization owns the collection', async () => {
      orgService.isAirweaveCollectionInAllowlist.mockResolvedValue(true);

      await expect(
        service.assertOwnership(adminSession, 'owned-coll'),
      ).resolves.toBeUndefined();

      expect(orgService.isAirweaveCollectionInAllowlist).toHaveBeenCalledWith(
        'org-1',
        'owned-coll',
      );
    });

    it('throws ForbiddenException with the claim-flow message when the org does not own the collection', async () => {
      orgService.isAirweaveCollectionInAllowlist.mockResolvedValue(false);

      const failure = service.assertOwnership(adminSession, 'legacy-coll');
      await expect(failure).rejects.toThrow(ForbiddenException);
      await expect(failure).rejects.toThrow(
        /not owned by your active organization/i,
      );
      await expect(failure).rejects.toThrow(/superadmin/i);
    });
  });
});
