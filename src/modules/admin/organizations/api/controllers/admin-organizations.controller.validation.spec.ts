import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import { HttpStatus } from '@nestjs/common';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { AdminOrganizationsService } from '../../application/services/admin-organizations.service';

describe('AdminOrganizationsController validation', () => {
  let controller: AdminOrganizationsController;
  let orgService: jest.Mocked<AdminOrganizationsService>;

  beforeEach(() => {
    orgService = {
      create: jest.fn(),
      getRoles: jest.fn(),
      findAll: jest.fn(),
      findAllForUser: jest.fn(),
      canUserReadOrganization: jest.fn(),
      findById: jest.fn(),
      getMembers: jest.fn(),
      listMemberCandidates: jest.fn(),
      getInvitations: jest.fn(),
      createInvitation: jest.fn(),
      deleteInvitation: jest.fn(),
      addMember: jest.fn(),
      updateMemberRole: jest.fn(),
      removeMember: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<AdminOrganizationsService>;

    controller = new AdminOrganizationsController(orgService);
  });

  const adminSession = {
    user: { role: 'superadmin' },
    session: { activeOrganizationId: null },
  } as unknown as UserSession;

  it('rejects addMember when userId is missing', async () => {
    await expect(
      controller.addMember(adminSession, 'org-1', {
        userId: '',
        role: 'member',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects addMember when role does not exist (service-layer validation)', async () => {
    orgService.findById.mockResolvedValue({ id: 'org-1' } as never);
    orgService.addMember.mockRejectedValue(
      Object.assign(new Error('Role does not exist in this organization'), {
        status: HttpStatus.BAD_REQUEST,
      }),
    );
    await expect(
      controller.addMember(adminSession, 'org-1', {
        userId: 'user-1',
        role: 'owner',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects updateMemberRole when role does not exist (service-layer validation)', async () => {
    orgService.updateMemberRole.mockRejectedValue(
      Object.assign(new Error('Role does not exist in this organization'), {
        status: HttpStatus.BAD_REQUEST,
      }),
    );
    await expect(
      controller.updateMemberRole(adminSession, 'org-1', 'member-1', {
        role: 'owner' as any,
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects createInvitation when email is invalid', async () => {
    await expect(
      controller.createInvitation(adminSession, 'org-1', {
        email: 'invalid-email',
        role: 'member',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects create when name is missing', async () => {
    await expect(
      controller.create(adminSession, {
        name: '',
        slug: 'new-org',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects create when slug is invalid', async () => {
    await expect(
      controller.create(adminSession, {
        name: 'New Org',
        slug: 'Invalid Slug',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects listMemberCandidates when limit is invalid', async () => {
    await expect(
      (controller as any).listMemberCandidates(
        adminSession,
        'org-1',
        undefined,
        '0',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });
});
