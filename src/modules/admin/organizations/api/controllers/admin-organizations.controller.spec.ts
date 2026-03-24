import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { AdminOrganizationsService } from '../../application/services/admin-organizations.service';

describe('AdminOrganizationsController', () => {
  let controller: AdminOrganizationsController;
  let orgService: jest.Mocked<AdminOrganizationsService>;

  beforeEach(() => {
    orgService = {
      create: jest.fn(),
      getRoles: jest.fn().mockImplementation(async () => ({ roles: [], assignableRoles: [] })),
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

  describe('getRolesMetadata', () => {
    it('passes manager platform role to service', async () => {
      const managerSession = {
        user: { role: 'manager' },
        session: { activeOrganizationId: 'org-1' },
      } as unknown as UserSession;

      await controller.getRolesMetadata(managerSession);

      expect(orgService.getRoles).toHaveBeenCalledWith('org-1', 'manager');
    });

    it('passes admin platform role to service', async () => {
      const adminSession = {
        user: { role: 'admin' },
        session: { activeOrganizationId: 'org-1' },
      } as unknown as UserSession;

      await controller.getRolesMetadata(adminSession);

      expect(orgService.getRoles).toHaveBeenCalledWith('org-1', 'admin');
    });
  });

  describe('member management', () => {
    it('forwards update member role payload and actor role', async () => {
      orgService.updateMemberRole.mockResolvedValue({
        id: 'member-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'manager',
        createdAt: new Date(),
      } as never);

      const adminSession = {
        user: { role: 'admin' },
        session: { activeOrganizationId: 'org-1' },
      } as unknown as UserSession;

      await controller.updateMemberRole(adminSession, 'org-1', 'member-1', { role: 'manager' });

      expect(orgService.updateMemberRole).toHaveBeenCalledWith('org-1', 'member-1', 'manager', 'admin');
    });

    it('forwards remove member request and actor role', async () => {
      orgService.removeMember.mockResolvedValue({ success: true } as never);

      const managerSession = {
        user: { role: 'manager' },
        session: { activeOrganizationId: 'org-1' },
      } as unknown as UserSession;

      await controller.removeMember(managerSession, 'org-1', 'member-1');

      expect(orgService.removeMember).toHaveBeenCalledWith('org-1', 'member-1', 'manager');
    });

    it('forwards create invitation payload and actor context', async () => {
      orgService.createInvitation.mockResolvedValue({
        id: 'inv-1',
        organizationId: 'org-1',
        email: 'invitee@example.com',
        role: 'member',
        status: 'pending',
        expiresAt: new Date(),
        inviterId: 'admin-1',
        createdAt: new Date(),
      } as never);

      const adminSession = {
        user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'admin' },
        session: { activeOrganizationId: 'org-1' },
      } as unknown as UserSession;

      await controller.createInvitation(adminSession, 'org-1', {
        email: 'invitee@example.com',
        role: 'member',
      });

      expect(orgService.createInvitation).toHaveBeenCalledWith(
        'org-1',
        'invitee@example.com',
        'member',
        'admin',
        {
          id: 'admin-1',
          email: 'admin@example.com',
          name: 'Admin',
        },
      );
    });

    it('returns member candidates for superadmin', async () => {
      (orgService as any).listMemberCandidates = jest.fn<any>().mockResolvedValue([
        {
          id: 'user-2',
          name: 'Candidate User',
          email: 'candidate@example.com',
          role: 'member',
          image: null,
        },
      ]);

      const adminSession = {
        user: { role: 'superadmin' },
        session: { activeOrganizationId: null },
      } as unknown as UserSession;

      const result = await (controller as any).listMemberCandidates(adminSession, 'org-1', 'candidate', '25');

      expect((result as any).data).toEqual([
        {
          id: 'user-2',
          name: 'Candidate User',
          email: 'candidate@example.com',
          role: 'member',
          image: null,
        },
      ]);
      expect((orgService as any).listMemberCandidates).toHaveBeenCalledWith('org-1', {
        search: 'candidate',
        limit: 25,
      });
    });

    it('allows manager to list candidates for active organization only', async () => {
      (orgService as any).listMemberCandidates = jest.fn<any>().mockResolvedValue([]);

      const managerSession = {
        user: { role: 'manager' },
        session: { activeOrganizationId: 'org-1' },
      } as unknown as UserSession;

      await (controller as any).listMemberCandidates(managerSession, 'org-1', undefined, undefined);

      expect((orgService as any).listMemberCandidates).toHaveBeenCalledWith('org-1', {
        search: undefined,
        limit: 25,
      });
    });

    it('blocks manager from listing candidates for a different organization', async () => {
      const managerSession = {
        user: { role: 'manager' },
        session: { activeOrganizationId: 'org-1' },
      } as unknown as UserSession;

      await expect((controller as any).listMemberCandidates(managerSession, 'org-2', undefined, undefined)).rejects.toThrow(
        'You can only access your own organization',
      );
    });
  });

  describe('create', () => {
    it('forwards create request for manager and does not require active organization', async () => {
      orgService.create.mockResolvedValue({
        id: 'org-2', name: 'New Org', slug: 'new-org',
        logo: null, metadata: null, createdAt: new Date(),
      } as never);

      const managerSession = {
        user: { id: 'manager-1', role: 'manager' },
        session: { activeOrganizationId: null },
      } as unknown as UserSession;

      await controller.create(managerSession, { name: 'New Org', slug: 'new-org' });

      expect(orgService.create).toHaveBeenCalledWith(
        { name: 'New Org', slug: 'new-org', logo: undefined, metadata: undefined },
        { id: 'manager-1', platformRole: 'manager' },
      );
    });

    it('throws when name is missing — covers !name branch', async () => {
      const session = { user: { id: 'admin-1', role: 'admin' }, session: {} } as unknown as UserSession;
      await expect(controller.create(session, { name: '', slug: 'valid-slug' })).rejects.toThrow('name is required');
    });

    it('throws when slug is missing — covers !slug branch', async () => {
      const session = { user: { id: 'admin-1', role: 'admin' }, session: {} } as unknown as UserSession;
      await expect(controller.create(session, { name: 'Org', slug: '' })).rejects.toThrow('slug is required');
    });

    it('throws when slug has invalid format — covers !slugRegex branch', async () => {
      const session = { user: { id: 'admin-1', role: 'admin' }, session: {} } as unknown as UserSession;
      await expect(controller.create(session, { name: 'Org', slug: 'Invalid Slug!' })).rejects.toThrow('invalid slug');
    });
  });

  describe('list', () => {
    const adminSession = {
      user: { role: 'superadmin' }, session: { activeOrganizationId: null },
    } as unknown as UserSession;

    const managerSession = {
      user: { id: 'manager-1', role: 'manager' }, session: { activeOrganizationId: 'org-1' },
    } as unknown as UserSession;

    it('superadmin sees all orgs via findAll', async () => {
      orgService.findAll.mockResolvedValue({ data: [], pagination: {} } as never);

      await controller.list(adminSession, { page: 1, limit: 20 } as any);

      expect(orgService.findAll).toHaveBeenCalled();
    });

    it('non-superadmin sees only readable member organizations via findAllForUser', async () => {
      orgService.findAllForUser.mockResolvedValue({ data: [{ id: 'org-1', name: 'My Org' }], total: 1, page: 1, limit: 20, totalPages: 1 } as never);

      const result = await controller.list(managerSession, {} as any);

      expect(orgService.findAllForUser).toHaveBeenCalledWith(
        'manager-1',
        expect.objectContaining({ page: 1, limit: 20, search: undefined }),
      );
      expect((result as any).data).toHaveLength(1);
    });

    it('non-superadmin sees empty list when they have no readable member organizations', async () => {
      orgService.findAllForUser.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 } as never);

      const result = await controller.list(managerSession, {} as any);

      expect((result as any).data).toHaveLength(0);
      expect((result as any).total).toBe(0);
    });

    it('manager without activeOrgId throws ForbiddenException', async () => {
      const noOrgSession = {
        user: { role: 'manager' }, session: { activeOrganizationId: null },
      } as unknown as UserSession;

      await expect(controller.list(noOrgSession, {} as any)).rejects.toThrow('Active organization required');
    });

    it('uses default page=1 and limit=20 when query is empty', async () => {
      orgService.findAll.mockResolvedValue({ data: [], pagination: {} } as never);

      await controller.list(adminSession, {} as any);

      expect(orgService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, limit: 20 }),
      );
    });
  });

  describe('findOne', () => {
    const adminSession = {
      user: { role: 'superadmin' }, session: { activeOrganizationId: null },
    } as unknown as UserSession;

    it('returns org when found', async () => {
      orgService.findById.mockResolvedValue({ id: 'org-1', name: 'Org' } as never);

      const result = await controller.findOne(adminSession, 'org-1');

      expect((result as any).data.id).toBe('org-1');
    });

    it('throws 404 when org not found — covers !org branch', async () => {
      orgService.findById.mockResolvedValue(null as never);

      await expect(controller.findOne(adminSession, 'missing')).rejects.toThrow('Organization not found');
    });

    it('manager accessing different org throws ForbiddenException', async () => {
      const managerSession = {
        user: { role: 'manager' }, session: { activeOrganizationId: 'org-1' },
      } as unknown as UserSession;

      await expect(controller.findOne(managerSession, 'org-2')).rejects.toThrow('You can only access your own organization');
    });
  });

  describe('getMembers', () => {
    const adminSession = {
      user: { role: 'superadmin' }, session: { activeOrganizationId: null },
    } as unknown as UserSession;
    const managerSession = {
      user: { id: 'manager-1', role: 'manager' }, session: { activeOrganizationId: 'org-1' },
    } as unknown as UserSession;

    it('returns members when org found', async () => {
      orgService.findById.mockResolvedValue({ id: 'org-1' } as never);
      orgService.getMembers.mockResolvedValue([{ id: 'm-1' }] as never);

      const result = await controller.getMembers(adminSession, 'org-1');

      expect((result as any).data).toHaveLength(1);
    });

    it('allows non-superadmin to read members for a readable non-active organization', async () => {
      orgService.canUserReadOrganization.mockResolvedValue(true as never);
      orgService.findById.mockResolvedValue({ id: 'org-2' } as never);
      orgService.getMembers.mockResolvedValue([{ id: 'm-1' }, { id: 'm-2' }] as never);

      const result = await controller.getMembers(managerSession, 'org-2');

      expect(orgService.canUserReadOrganization).toHaveBeenCalledWith('manager-1', 'org-2');
      expect((result as any).data).toHaveLength(2);
    });

    it('throws 404 when org not found — covers !org branch', async () => {
      orgService.findById.mockResolvedValue(null as never);

      await expect(controller.getMembers(adminSession, 'missing')).rejects.toThrow('Organization not found');
    });
  });

  describe('getInvitations', () => {
    const adminSession = {
      user: { role: 'superadmin' }, session: { activeOrganizationId: null },
    } as unknown as UserSession;

    it('returns invitations when org found', async () => {
      orgService.findById.mockResolvedValue({ id: 'org-1' } as never);
      orgService.getInvitations.mockResolvedValue([{ id: 'inv-1' }] as never);

      const result = await controller.getInvitations(adminSession, 'org-1');

      expect((result as any).data).toHaveLength(1);
    });

    it('throws 404 when org not found — covers !org branch', async () => {
      orgService.findById.mockResolvedValue(null as never);

      await expect(controller.getInvitations(adminSession, 'missing')).rejects.toThrow('Organization not found');
    });
  });

  describe('deleteInvitation', () => {
    const adminSession = {
      user: { role: 'superadmin' }, session: { activeOrganizationId: null },
    } as unknown as UserSession;

    it('calls deleteInvitation and returns success', async () => {
      orgService.deleteInvitation.mockResolvedValue(undefined as never);

      const result = await controller.deleteInvitation(adminSession, 'org-1', 'inv-1');

      expect(orgService.deleteInvitation).toHaveBeenCalledWith('org-1', 'inv-1');
      expect((result as any).success).toBe(true);
    });
  });

  describe('addMember', () => {
    const adminSession = {
      user: { role: 'superadmin' }, session: { activeOrganizationId: null },
    } as unknown as UserSession;

    it('adds member when org found and role is valid', async () => {
      orgService.findById.mockResolvedValue({ id: 'org-1' } as never);
      orgService.addMember.mockResolvedValue({ id: 'm-1' } as never);

      const result = await controller.addMember(adminSession, 'org-1', { userId: 'u-1', role: 'member' });

      expect((result as any).data.id).toBe('m-1');
    });

    it('throws 404 when org not found — covers !org branch', async () => {
      orgService.findById.mockResolvedValue(null as never);

      await expect(
        controller.addMember(adminSession, 'missing', { userId: 'u-1', role: 'member' }),
      ).rejects.toThrow('Organization not found');
    });

    it('throws when userId is missing — covers !userId branch', async () => {
      await expect(
        controller.addMember(adminSession, 'org-1', { userId: '', role: 'member' }),
      ).rejects.toThrow('userId is required');
    });

  });

  describe('update', () => {
    const adminSession = {
      user: { role: 'superadmin' }, session: { activeOrganizationId: null },
    } as unknown as UserSession;

    const managerSession = {
      user: { role: 'manager' }, session: { activeOrganizationId: 'org-1' },
    } as unknown as UserSession;

    it('returns updated org when found', async () => {
      orgService.update.mockResolvedValue({ id: 'org-1', name: 'Updated' } as never);

      const result = await controller.update(adminSession, 'org-1', { name: 'Updated' });

      expect((result as any).data.name).toBe('Updated');
    });

    it('allows manager to update their own organization', async () => {
      orgService.update.mockResolvedValue({ id: 'org-1', name: 'Updated By Manager' } as never);

      const result = await controller.update(managerSession, 'org-1', { name: 'Updated By Manager' });

      expect((result as any).data.name).toBe('Updated By Manager');
      expect(orgService.update).toHaveBeenCalledWith('org-1', { name: 'Updated By Manager' });
    });

    it('blocks manager from updating a different organization', async () => {
      await expect(
        controller.update(managerSession, 'org-2', { name: 'Nope' }),
      ).rejects.toThrow('You can only access your own organization');
    });

    it('throws 404 when org not found — covers !org branch', async () => {
      orgService.update.mockResolvedValue(null as never);

      await expect(controller.update(adminSession, 'missing', { name: 'X' })).rejects.toThrow('Organization not found');
    });
  });

  describe('delete', () => {
    const adminSession = {
      user: { role: 'superadmin' }, session: { activeOrganizationId: null },
    } as unknown as UserSession;

    const managerSession = {
      user: { role: 'manager' }, session: { activeOrganizationId: 'org-1' },
    } as unknown as UserSession;

    it('returns success when org deleted', async () => {
      orgService.delete.mockResolvedValue(undefined as never);

      const result = await controller.delete(adminSession, 'org-1');

      expect((result as any).success).toBe(true);
    });

    it('allows manager to delete their own organization', async () => {
      orgService.delete.mockResolvedValue(undefined as never);

      const result = await controller.delete(managerSession, 'org-1');

      expect((result as any).success).toBe(true);
      expect(orgService.delete).toHaveBeenCalledWith('org-1');
    });

    it('blocks manager from deleting a different organization', async () => {
      await expect(controller.delete(managerSession, 'org-2')).rejects.toThrow(
        'You can only access your own organization',
      );
    });

    it('throws 404 when service throws "Organization not found" — covers known error branch', async () => {
      orgService.delete.mockRejectedValue(new Error('Organization not found') as never);

      await expect(controller.delete(adminSession, 'missing')).rejects.toThrow('Organization not found');
    });

    it('rethrows unknown errors — covers else branch', async () => {
      orgService.delete.mockRejectedValue(new Error('DB connection failed') as never);

      await expect(controller.delete(adminSession, 'org-1')).rejects.toThrow('DB connection failed');
    });
  });

  describe('validateCreateInvitationPayload — branch coverage', () => {
    const adminSession = {
      user: { id: 'a-1', email: 'a@a.com', name: 'A', role: 'superadmin' },
      session: { activeOrganizationId: null },
    } as unknown as UserSession;

    it('throws when email is missing', async () => {
      await expect(
        controller.createInvitation(adminSession, 'org-1', { email: '', role: 'member' }),
      ).rejects.toThrow('email is required');
    });

    it('throws when email has no @ — covers !includes(@) branch', async () => {
      await expect(
        controller.createInvitation(adminSession, 'org-1', { email: 'notanemail', role: 'member' }),
      ).rejects.toThrow('invalid email');
    });

    it('throws when role is missing after valid email (line 111)', async () => {
      await expect(
        controller.createInvitation(adminSession, 'org-1', { email: 'valid@example.com', role: '' }),
      ).rejects.toThrow('role is required');
    });
  });

  describe('validateAddMemberPayload — branch coverage', () => {
    const adminSession = {
      user: { id: 'a-1', email: 'a@a.com', name: 'A', role: 'superadmin' },
      session: { activeOrganizationId: null },
    } as unknown as UserSession;

    it('throws when userId is missing', async () => {
      await expect(
        controller.addMember(adminSession, 'org-1', { userId: '', role: 'member' }),
      ).rejects.toThrow('userId is required');
    });

    it('throws when role is missing after valid userId (line 78)', async () => {
      await expect(
        controller.addMember(adminSession, 'org-1', { userId: 'u-1', role: '' }),
      ).rejects.toThrow('role is required');
    });
  });

  describe('validateUpdateMemberRolePayload — branch coverage', () => {
    const adminSession = {
      user: { id: 'a-1', email: 'a@a.com', name: 'A', role: 'admin' },
      session: { activeOrganizationId: 'org-1' },
    } as unknown as UserSession;

    it('throws when role is empty (line 84)', async () => {
      await expect(
        controller.updateMemberRole(adminSession, 'org-1', 'member-1', { role: '' }),
      ).rejects.toThrow('role is required');
    });
  });
});
