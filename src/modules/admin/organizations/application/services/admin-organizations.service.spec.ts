import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminOrganizationsService,
  ROLE_HIERARCHY,
  getRoleLevel,
  filterAssignableRoles,
} from './admin-organizations.service';
import {
  IAdminOrgRepository,
  ADMIN_ORG_REPOSITORY,
} from '../../domain/repositories/admin-org.repository.interface';
import { EmailService } from '../../../../../shared/email/email.service';

describe('AdminOrganizationsService', () => {
  let service: AdminOrganizationsService;
  let orgRepo: jest.Mocked<IAdminOrgRepository>;
  let emailService: jest.Mocked<EmailService>;

  const mockOrganization = {
    id: 'org-1',
    name: 'Test Org',
    slug: 'test-org',
    logo: null,
    metadata: null,
    createdAt: new Date(),
    member_count: '5',
  };

  beforeEach(async () => {
    const mockOrgRepo: jest.Mocked<IAdminOrgRepository> = {
      findAll: jest.fn(),
      countAll: jest.fn(),
      findAllForUser: jest.fn(),
      countAllForUser: jest.fn(),
      canUserReadOrganization: jest.fn(),
      findById: jest.fn(),
      findBasicById: jest.fn(),
      findBySlug: jest.fn(),
      createOrg: jest.fn(),
      updateOrg: jest.fn(),
      deleteOrg: jest.fn(),
      getMembers: jest.fn(),
      listMemberCandidates: jest.fn(),
      findMemberById: jest.fn(),
      findMemberByUserId: jest.fn(),
      findMemberByEmail: jest.fn(),
      countMembersWithManageCapability: jest.fn(),
      roleGrantsManagePermission: jest.fn(),
      addMember: jest.fn(),
      updateMemberRole: jest.fn(),
      removeMember: jest.fn(),
      findUserById: jest.fn(),
      findPendingInvitation: jest.fn(),
      findInvitationById: jest.fn(),
      createInvitation: jest.fn(),
      getInvitations: jest.fn(),
      deleteInvitation: jest.fn(),
      getRoles: jest.fn(),
    };

    const mockEmailService = {
      sendOrganizationInvitation: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      sendEmailVerification: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      sendEmail: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOrganizationsService,
        { provide: ADMIN_ORG_REPOSITORY, useValue: mockOrgRepo },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<AdminOrganizationsService>(AdminOrganizationsService);
    orgRepo = module.get(ADMIN_ORG_REPOSITORY);
    emailService = module.get(EmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated organizations', async () => {
      orgRepo.countAll.mockResolvedValue(10);
      orgRepo.findAll.mockResolvedValue([mockOrganization]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.total).toBe(10);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Test Org');
      expect(result.data[0].memberCount).toBe(5);
    });

    it('should apply search filter', async () => {
      orgRepo.countAll.mockResolvedValue(1);
      orgRepo.findAll.mockResolvedValue([mockOrganization]);

      await service.findAll({ page: 1, limit: 20, search: 'test' });

      expect(orgRepo.countAll).toHaveBeenCalledWith('test');
      expect(orgRepo.findAll).toHaveBeenCalledWith('test', 20, 0);
    });

    it('should handle empty results', async () => {
      orgRepo.countAll.mockResolvedValue(0);
      orgRepo.findAll.mockResolvedValue([]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.total).toBe(0);
      expect(result.data).toHaveLength(0);
      expect(result.totalPages).toBe(0);
    });
  });

  describe('findAllForUser', () => {
    it('should return paginated readable member organizations for the user', async () => {
      orgRepo.countAllForUser.mockResolvedValue(2);
      orgRepo.findAllForUser.mockResolvedValue([mockOrganization]);

      const result = await service.findAllForUser('user-1', { page: 2, limit: 5 });

      expect(orgRepo.countAllForUser).toHaveBeenCalledWith('user-1', undefined);
      expect(orgRepo.findAllForUser).toHaveBeenCalledWith('user-1', undefined, 5, 5);
      expect(result.total).toBe(2);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
      expect(result.data[0].memberCount).toBe(5);
    });

    it('should apply search filter for readable member organizations', async () => {
      orgRepo.countAllForUser.mockResolvedValue(1);
      orgRepo.findAllForUser.mockResolvedValue([mockOrganization]);

      await service.findAllForUser('user-99', { page: 1, limit: 20, search: 'acme' });

      expect(orgRepo.countAllForUser).toHaveBeenCalledWith('user-99', 'acme');
      expect(orgRepo.findAllForUser).toHaveBeenCalledWith('user-99', 'acme', 20, 0);
    });
  });

  describe('create', () => {
    it('should assign admin member role when actor is manager', async () => {
      orgRepo.createOrg.mockResolvedValue(undefined);
      orgRepo.findById.mockResolvedValue({ id: 'org-2', name: 'New Org', slug: 'new-org', logo: null, metadata: null, createdAt: new Date(), member_count: '0' });

      const created = await service.create(
        {
          name: 'New Org',
          slug: 'new-org',
        },
        {
          id: 'manager-1',
          platformRole: 'manager',
        },
      );

      expect(created.name).toBe('New Org');
      expect(created.slug).toBe('new-org');
      expect(orgRepo.createOrg).toHaveBeenCalledWith(
        expect.objectContaining({ actorRole: 'admin' }),
      );
    });

    it('should not create a creator membership when actor is superadmin', async () => {
      orgRepo.createOrg.mockResolvedValue(undefined);
      orgRepo.findById.mockResolvedValue({ id: 'org-4', name: 'Superadmin Org', slug: 'superadmin-org', logo: null, metadata: null, createdAt: new Date(), member_count: '0' });

      const created = await service.create(
        {
          name: 'Superadmin Org',
          slug: 'superadmin-org',
        },
        {
          id: 'superadmin-1',
          platformRole: 'superadmin',
        },
      );

      expect(created.name).toBe('Superadmin Org');
      expect(created.slug).toBe('superadmin-org');
      const createParams = orgRepo.createOrg.mock.calls[0][0];
      expect(createParams.actorId).toBe('superadmin-1');
      expect(createParams.actorRole).toBeUndefined();
      expect(createParams.memberId).toBeUndefined();
    });

    it('should reject duplicate organization slug', async () => {
      orgRepo.createOrg.mockRejectedValue(new ConflictException('Organization slug already exists'));

      await expect(
        service.create(
          {
            name: 'New Org',
            slug: 'new-org',
          },
          {
            id: 'admin-1',
            platformRole: 'admin',
          },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should throw BadRequestException when name is empty', async () => {
      await expect(
        service.create({ name: '  ', slug: 'valid-slug' }, { id: 'admin-1', platformRole: 'admin' }),
      ).rejects.toThrow('name is required');
    });

    it('should throw BadRequestException when slug is empty', async () => {
      await expect(
        service.create({ name: 'Valid Name', slug: '  ' }, { id: 'admin-1', platformRole: 'admin' }),
      ).rejects.toThrow('slug is required');
    });

    it('should throw BadRequestException when slug has special characters', async () => {
      await expect(
        service.create({ name: 'Valid Name', slug: 'has_underscore!' }, { id: 'admin-1', platformRole: 'admin' }),
      ).rejects.toThrow('invalid slug');
    });

    it('should throw BadRequestException for slug with spaces', async () => {
      await expect(
        service.create({ name: 'Valid Name', slug: 'has space' }, { id: 'admin-1', platformRole: 'admin' }),
      ).rejects.toThrow('invalid slug');
    });

    it('should throw InternalServerErrorException when findById returns null after createOrg', async () => {
      orgRepo.createOrg.mockResolvedValue(undefined);
      orgRepo.findById.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Ghost Org', slug: 'ghost-org' }, { id: 'admin-1', platformRole: 'admin' }),
      ).rejects.toThrow('Failed to create organization');
    });

    it('should assign admin member role when actor is admin', async () => {
      orgRepo.createOrg.mockResolvedValue(undefined);
      orgRepo.findById.mockResolvedValue({ id: 'org-3', name: 'Admin Org', slug: 'admin-org', logo: null, metadata: null, createdAt: new Date(), member_count: '0' });

      const created = await service.create(
        { name: 'Admin Org', slug: 'admin-org' },
        { id: 'admin-1', platformRole: 'admin' },
      );

      expect(created.name).toBe('Admin Org');
      expect(orgRepo.createOrg).toHaveBeenCalledWith(
        expect.objectContaining({ actorRole: 'admin' }),
      );
    });
  });

  describe('createInvitation', () => {
    const orgRoles = [
      { name: 'admin', display_name: 'Admin', description: null, color: 'red', is_default: true },
      { name: 'manager', display_name: 'Manager', description: null, color: 'blue', is_default: true },
      { name: 'member', display_name: 'Member', description: null, color: 'gray', is_default: true },
    ];

    it('should create invitation and send email for admin actor', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findBasicById.mockResolvedValue({ id: 'org-1', name: 'Test Org', slug: 'test-org' });
      orgRepo.findMemberByEmail.mockResolvedValue(null);
      orgRepo.findPendingInvitation.mockResolvedValue(null);
      orgRepo.createInvitation.mockResolvedValue({
        id: 'inv-1',
        organizationId: 'org-1',
        email: 'invitee@example.com',
        role: 'member',
        status: 'pending',
        expiresAt,
        inviterId: 'actor-1',
        createdAt: new Date(),
      });

      const result = await service.createInvitation(
        'org-1',
        'invitee@example.com',
        'member',
        'admin',
        { id: 'actor-1', email: 'admin@example.com', name: 'Admin User' },
      );

      expect(result.email).toBe('invitee@example.com');
      expect(orgRepo.createInvitation).toHaveBeenCalledWith(
        expect.any(String),
        'org-1',
        'invitee@example.com',
        'member',
        expect.any(Date),
        'actor-1',
      );
      expect(emailService.sendOrganizationInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'invitee@example.com',
          role: 'member',
          organizationId: 'org-1',
        }),
      );
    });

    it('should throw BadRequestException when role does not exist in organization', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);

      await expect(
        service.createInvitation(
          'org-1',
          'invitee@example.com',
          'owner',
          'admin',
          { id: 'actor-1', email: 'admin@example.com', name: 'Admin' },
        ),
      ).rejects.toThrow('Role does not exist in this organization');
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findBasicById.mockResolvedValue(null);

      await expect(
        service.createInvitation(
          'org-missing',
          'invitee@example.com',
          'member',
          'admin',
          { id: 'actor-1', email: 'admin@example.com', name: 'Admin User' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should throw BadRequestException when invitee is already a member', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findBasicById.mockResolvedValue({ id: 'org-1', name: 'Test Org', slug: 'test-org' });
      orgRepo.findMemberByEmail.mockResolvedValue({ id: 'member-1' });

      await expect(
        service.createInvitation(
          'org-1',
          'invitee@example.com',
          'member',
          'admin',
          { id: 'actor-1', email: 'admin@example.com', name: 'Admin User' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should throw ConflictException when pending invitation already exists', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findBasicById.mockResolvedValue({ id: 'org-1', name: 'Test Org', slug: 'test-org' });
      orgRepo.findMemberByEmail.mockResolvedValue(null);
      orgRepo.findPendingInvitation.mockResolvedValue({ id: 'inv-existing' });

      await expect(
        service.createInvitation(
          'org-1',
          'invitee@example.com',
          'member',
          'admin',
          { id: 'actor-1', email: 'admin@example.com', name: 'Admin User' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should throw InternalServerErrorException when repo returns null invitation', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findBasicById.mockResolvedValue({ id: 'org-1', name: 'Test Org', slug: 'test-org' });
      orgRepo.findMemberByEmail.mockResolvedValue(null);
      orgRepo.findPendingInvitation.mockResolvedValue(null);
      orgRepo.createInvitation.mockResolvedValue(null);

      await expect(
        service.createInvitation(
          'org-1',
          'invitee@example.com',
          'member',
          'admin',
          { id: 'actor-1', email: 'admin@example.com' },
        ),
      ).rejects.toThrow('Failed to create invitation');
    });

    it('should swallow email send errors and still return invitation', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findBasicById.mockResolvedValue({ id: 'org-1', name: 'Test Org', slug: 'test-org' });
      orgRepo.findMemberByEmail.mockResolvedValue(null);
      orgRepo.findPendingInvitation.mockResolvedValue(null);
      orgRepo.createInvitation.mockResolvedValue({
        id: 'inv-2',
        organizationId: 'org-1',
        email: 'invitee@example.com',
        role: 'member',
        status: 'pending',
        expiresAt,
        inviterId: 'actor-1',
        createdAt: new Date(),
      });
      emailService.sendOrganizationInvitation.mockRejectedValue(new Error('SMTP timeout'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const result = await service.createInvitation(
          'org-1',
          'invitee@example.com',
          'member',
          'admin',
          { id: 'actor-1', email: 'admin@example.com', name: 'Admin' },
        );

        expect(result.id).toBe('inv-2');
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to send organization invitation email'),
          expect.any(Error),
        );
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe('getInvitations', () => {
    it('should return invitations for an organization', async () => {
      const mockInvitations = [
        {
          id: 'inv-1',
          organizationId: 'org-1',
          email: 'a@example.com',
          role: 'member',
          status: 'pending',
          expiresAt: new Date(),
          inviterId: 'actor-1',
          createdAt: new Date(),
        },
      ];
      orgRepo.getInvitations.mockResolvedValue(mockInvitations);

      const result = await service.getInvitations('org-1');

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('a@example.com');
      expect(orgRepo.getInvitations).toHaveBeenCalledWith('org-1');
    });

    it('should return empty array when no invitations exist', async () => {
      orgRepo.getInvitations.mockResolvedValue([]);

      const result = await service.getInvitations('org-1');

      expect(result).toHaveLength(0);
    });
  });

  describe('addMember', () => {
    const mockMemberResult = {
      id: 'member-new',
      organizationId: 'org-1',
      userId: 'user-2',
      role: 'member',
      createdAt: new Date(),
    };
    const orgRoles = [
      { name: 'admin', display_name: 'Admin', description: null, color: 'red', is_default: true },
      { name: 'member', display_name: 'Member', description: null, color: 'gray', is_default: true },
    ];

    it('should throw NotFoundException when organization does not exist', async () => {
      orgRepo.findById.mockResolvedValueOnce(null);

      await expect(service.addMember('ghost-org', 'user-2', 'member')).rejects.toThrow('Organization not found');
      expect(orgRepo.findUserById).not.toHaveBeenCalled();
    });

    it('should add an existing user as a member', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findUserById.mockResolvedValue({ id: 'user-2', role: 'member' });
      orgRepo.findMemberByUserId.mockResolvedValue(null);
      orgRepo.addMember.mockResolvedValue(mockMemberResult);

      const result = await service.addMember('org-1', 'user-2', 'member');

      expect(result.userId).toBe('user-2');
      expect(result.role).toBe('member');
      expect(orgRepo.addMember).toHaveBeenCalledWith(
        expect.any(String),
        'org-1',
        'user-2',
        'member',
      );
    });

    it('should throw NotFoundException when user does not exist', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findUserById.mockResolvedValue(null);

      await expect(service.addMember('org-1', 'ghost-user', 'member')).rejects.toThrow('User not found');
    });

    it('should throw ConflictException when user is already a member', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findUserById.mockResolvedValue({ id: 'user-2', role: 'member' });
      orgRepo.findMemberByUserId.mockResolvedValue({ id: 'existing-member' });

      await expect(service.addMember('org-1', 'user-2', 'member')).rejects.toThrow(
        'User is already a member of this organization',
      );
    });

    it('should reject adding a superadmin as a member', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findUserById.mockResolvedValue({ id: 'user-2', role: 'superadmin' });

      await expect(service.addMember('org-1', 'user-2', 'member')).rejects.toThrow(
        'Superadmin users cannot be added as organization members',
      );
      expect(orgRepo.findMemberByUserId).not.toHaveBeenCalled();
      expect(orgRepo.addMember).not.toHaveBeenCalled();
    });
  });

  describe('canUserReadOrganization', () => {
    it('delegates readable organization checks to the repository', async () => {
      orgRepo.canUserReadOrganization.mockResolvedValue(true);

      await expect(service.canUserReadOrganization('user-1', 'org-2')).resolves.toBe(true);

      expect(orgRepo.canUserReadOrganization).toHaveBeenCalledWith('user-1', 'org-2');
    });
  });

  describe('findById', () => {
    it('should return organization with member count', async () => {
      orgRepo.findById.mockResolvedValue(mockOrganization);

      const result = await service.findById('org-1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('org-1');
      expect(result?.memberCount).toBe(5);
    });

    it('should return null for non-existent organization', async () => {
      orgRepo.findById.mockResolvedValue(null);

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('listMemberCandidates', () => {
    it('should throw NotFoundException when organization does not exist', async () => {
      orgRepo.findById.mockResolvedValueOnce(null);

      await expect((service as any).listMemberCandidates('ghost-org')).rejects.toThrow('Organization not found');
      expect((orgRepo as any).listMemberCandidates).not.toHaveBeenCalled();
    });

    it('should return candidate users who are not already members', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);
      (orgRepo as any).listMemberCandidates = jest.fn<any>().mockResolvedValueOnce([
        {
          id: 'user-2',
          name: 'Candidate User',
          email: 'candidate@example.com',
          role: 'member',
          image: null,
        },
      ]);

      const result = await (service as any).listMemberCandidates('org-1', { limit: 25, search: 'candidate' });

      expect(result).toEqual([
        {
          id: 'user-2',
          name: 'Candidate User',
          email: 'candidate@example.com',
          role: 'member',
          image: null,
        },
      ]);
      expect((orgRepo as any).listMemberCandidates).toHaveBeenCalledWith('org-1', { limit: 25, search: 'candidate' });
    });

    it('should return an empty array when no eligible candidates exist', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);
      (orgRepo as any).listMemberCandidates = jest.fn<any>().mockResolvedValueOnce([]);

      await expect((service as any).listMemberCandidates('org-1')).resolves.toEqual([]);
    });
  });

  describe('update', () => {
    it('should update organization name', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);
      orgRepo.updateOrg.mockResolvedValueOnce({ ...mockOrganization, name: 'Updated Org' });

      const result = await service.update('org-1', { name: 'Updated Org' });

      expect(result?.name).toBe('Updated Org');
      expect(orgRepo.findById).toHaveBeenCalledTimes(1);
      expect(orgRepo.updateOrg).toHaveBeenCalledTimes(1);
    });

    it('should return null for non-existent organization', async () => {
      orgRepo.findById.mockResolvedValue(null);

      const result = await service.update('non-existent', { name: 'Test' });

      expect(result).toBeNull();
    });

    it('should return existing org if no updates provided', async () => {
      orgRepo.findById.mockResolvedValue(mockOrganization);

      const result = await service.update('org-1', {});

      expect(result?.id).toBe('org-1');
      expect(orgRepo.findById).toHaveBeenCalledTimes(1);
      expect(orgRepo.updateOrg).not.toHaveBeenCalled();
    });

    it('should trim name before persisting', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);
      orgRepo.updateOrg.mockResolvedValueOnce({ ...mockOrganization, name: 'Trimmed Name' });

      await service.update('org-1', { name: '  Trimmed Name  ' });

      expect(orgRepo.updateOrg).toHaveBeenCalledWith('org-1', expect.objectContaining({ name: 'Trimmed Name' }));
    });

    it('should throw BadRequestException when updated name is blank', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);

      await expect(service.update('org-1', { name: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('should lowercase and trim slug before persisting', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);
      orgRepo.updateOrg.mockResolvedValueOnce({ ...mockOrganization, slug: 'new-slug' });

      await service.update('org-1', { slug: '  New-Slug  ' });

      expect(orgRepo.updateOrg).toHaveBeenCalledWith('org-1', expect.objectContaining({ slug: 'new-slug' }));
    });

    it('should throw BadRequestException when updated slug is blank', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);

      await expect(service.update('org-1', { slug: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when updated slug has invalid format', async () => {
      orgRepo.findById.mockResolvedValueOnce(mockOrganization);

      await expect(service.update('org-1', { slug: 'invalid slug!' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    it('should delete organization and related data', async () => {
      orgRepo.findById.mockResolvedValue(mockOrganization);
      orgRepo.deleteOrg.mockResolvedValue(undefined);

      await service.delete('org-1');

      expect(orgRepo.deleteOrg).toHaveBeenCalledWith('org-1');
    });

    it('should throw error for non-existent organization', async () => {
      orgRepo.findById.mockResolvedValue(null);

      await expect(service.delete('non-existent')).rejects.toThrow('Organization not found');
    });
  });

  describe('getMembers', () => {
    it('should return members with user info', async () => {
      const mockMember = {
        id: 'member-1',
        userId: 'user-1',
        role: 'admin',
        createdAt: new Date(),
        user_name: 'John Doe',
        user_email: 'john@example.com',
        user_image: null,
      };
      orgRepo.getMembers.mockResolvedValue([mockMember]);

      const result = await service.getMembers('org-1');

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user-1');
      expect(result[0].user.name).toBe('John Doe');
      expect(result[0].user.email).toBe('john@example.com');
    });
  });

  describe('updateMemberRole', () => {
    const orgRoles = [
      { name: 'admin', display_name: 'Admin', description: null, color: 'red', is_default: true },
      { name: 'manager', display_name: 'Manager', description: null, color: 'blue', is_default: true },
      { name: 'member', display_name: 'Member', description: null, color: 'gray', is_default: true },
    ];

    it('should update member role for admin actor', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findMemberById.mockResolvedValue({ id: 'member-1', role: 'member', userId: 'user-1' });
      orgRepo.roleGrantsManagePermission.mockResolvedValue(false);
      orgRepo.updateMemberRole.mockResolvedValue({ id: 'member-1', role: 'manager', userId: 'user-1', organizationId: 'org-1', createdAt: new Date() });

      const result = await service.updateMemberRole('org-1', 'member-1', 'manager', 'admin');

      expect(result.role).toBe('manager');
      expect(orgRepo.updateMemberRole).toHaveBeenCalledWith('member-1', 'org-1', 'manager');
    });

    it('should throw BadRequestException when new role does not exist in organization', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);

      await expect(service.updateMemberRole('org-1', 'member-1', 'owner', 'admin')).rejects.toThrow(
        'Role does not exist in this organization',
      );
    });

    it('should throw NotFoundException when member does not exist', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findMemberById.mockResolvedValue(null);

      await expect(
        service.updateMemberRole('org-1', 'missing-member', 'member', 'admin'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should block downgrading the last member with manage-members permission', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findMemberById.mockResolvedValue({ id: 'member-1', role: 'admin', userId: 'user-1' });
      orgRepo.roleGrantsManagePermission.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      orgRepo.countMembersWithManageCapability.mockResolvedValue(1);

      await expect(service.updateMemberRole('org-1', 'member-1', 'member', 'admin')).rejects.toThrow(
        'Cannot change role of the last member with organization manage-members permission',
      );
    });

    it('should allow changing role when new role also has manage-members', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findMemberById.mockResolvedValue({ id: 'member-1', role: 'admin', userId: 'user-1' });
      orgRepo.roleGrantsManagePermission.mockResolvedValue(true);
      orgRepo.countMembersWithManageCapability.mockResolvedValue(1);
      orgRepo.updateMemberRole.mockResolvedValue({
        id: 'member-1', role: 'manager', userId: 'user-1', organizationId: 'org-1', createdAt: new Date(),
      });

      const result = await service.updateMemberRole('org-1', 'member-1', 'manager', 'admin');
      expect(result.role).toBe('manager');
    });

    it('should allow superadmin to downgrade the last manage-members holder', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findMemberById.mockResolvedValue({ id: 'member-1', role: 'admin', userId: 'user-1' });
      orgRepo.updateMemberRole.mockResolvedValue({
        id: 'member-1', role: 'manager', userId: 'user-1', organizationId: 'org-1', createdAt: new Date(),
      });

      const result = await service.updateMemberRole('org-1', 'member-1', 'manager', 'superadmin');

      expect(result.role).toBe('manager');
      expect(orgRepo.roleGrantsManagePermission).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when updateMemberRole returns null', async () => {
      orgRepo.getRoles.mockResolvedValue(orgRoles);
      orgRepo.findMemberById.mockResolvedValue({ id: 'member-1', role: 'member', userId: 'user-1' });
      orgRepo.roleGrantsManagePermission.mockResolvedValue(false);
      orgRepo.updateMemberRole.mockResolvedValue(null);

      await expect(
        service.updateMemberRole('org-1', 'member-1', 'manager', 'admin'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeMember', () => {
    it('should remove member whose role has no manage-members permission', async () => {
      orgRepo.findMemberById.mockResolvedValue({ id: 'member-1', role: 'member', userId: 'user-1' });
      orgRepo.roleGrantsManagePermission.mockResolvedValue(false);
      orgRepo.removeMember.mockResolvedValue(true);

      const result = await service.removeMember('org-1', 'member-1', 'admin');

      expect(result.success).toBe(true);
      expect(orgRepo.removeMember).toHaveBeenCalledWith('member-1', 'org-1');
    });

    it('should block removing the last member with manage-members permission', async () => {
      orgRepo.findMemberById.mockResolvedValue({ id: 'member-1', role: 'admin', userId: 'user-1' });
      orgRepo.roleGrantsManagePermission.mockResolvedValue(true);
      orgRepo.countMembersWithManageCapability.mockResolvedValue(1);

      await expect(service.removeMember('org-1', 'member-1', 'admin')).rejects.toThrow(
        'Cannot remove the last member with organization manage-members permission',
      );
    });

    it('should allow removing a manage-members holder when others remain', async () => {
      orgRepo.findMemberById.mockResolvedValue({ id: 'member-1', role: 'admin', userId: 'user-1' });
      orgRepo.roleGrantsManagePermission.mockResolvedValue(true);
      orgRepo.countMembersWithManageCapability.mockResolvedValue(2);
      orgRepo.removeMember.mockResolvedValue(true);

      const result = await service.removeMember('org-1', 'member-1', 'admin');
      expect(result.success).toBe(true);
    });
  });

  describe('getRoles', () => {
    const mockRoles = [
      { name: 'admin', display_name: 'Admin', description: 'Org admin', color: '#ff0000', is_default: true },
      { name: 'manager', display_name: 'Manager', description: 'Org manager', color: '#00ff00', is_default: true },
      { name: 'member', display_name: 'Member', description: 'Regular user', color: '#0000ff', is_default: true },
    ];

    it('should return roles for an organization', async () => {
      orgRepo.getRoles.mockResolvedValue(mockRoles);

      const result = await service.getRoles('org-1');

      expect(result.roles).toHaveLength(3);
      expect(result.roles[0].name).toBe('admin');
      expect(result.roles[0].displayName).toBe('Admin');
      expect(result.roles[0].description).toBe('Org admin');
      expect(result.roles[0].color).toBe('#ff0000');
      expect(result.roles[0].isDefault).toBe(true);
      expect(orgRepo.getRoles).toHaveBeenCalledWith('org-1');
    });

    it('should return all org roles as assignableRoles', async () => {
      orgRepo.getRoles.mockResolvedValue(mockRoles);

      const result = await service.getRoles('org-1');

      expect(result.assignableRoles).toEqual(['admin', 'manager', 'member']);
    });

    it('should return global roles when organizationId is null', async () => {
      orgRepo.getRoles.mockResolvedValue(mockRoles);

      const result = await service.getRoles(null);

      expect(orgRepo.getRoles).toHaveBeenCalledWith(null);
      expect(result.roles).toHaveLength(3);
    });

    it('should handle empty roles table', async () => {
      orgRepo.getRoles.mockResolvedValue([]);

      const result = await service.getRoles('org-1');

      expect(result.roles).toHaveLength(0);
      expect(result.assignableRoles).toEqual([]);
    });

    it('should return custom roles alongside default ones', async () => {
      orgRepo.getRoles.mockResolvedValue([
        ...mockRoles,
        { name: 'owner', display_name: 'Owner', description: 'Organization owner', color: '#ffaa00', is_default: false },
      ]);

      const result = await service.getRoles('org-1');

      expect(result.assignableRoles).toEqual(expect.arrayContaining(['admin', 'manager', 'member', 'owner']));
    });
  });
});

// Pure function unit tests (no DI needed)
describe('Role Hierarchy Utilities', () => {
  describe('ROLE_HIERARCHY', () => {
    it('should have member < manager < admin', () => {
      expect(ROLE_HIERARCHY.member).toBeLessThan(ROLE_HIERARCHY.manager);
      expect(ROLE_HIERARCHY.manager).toBeLessThan(ROLE_HIERARCHY.admin);
    });

    it('should not include owner role', () => {
      expect(ROLE_HIERARCHY['owner']).toBeUndefined();
    });
  });

  describe('getRoleLevel', () => {
    it('should return correct level for known roles', () => {
      expect(getRoleLevel('member')).toBe(0);
      expect(getRoleLevel('manager')).toBe(1);
      expect(getRoleLevel('admin')).toBe(2);
    });

    it('should return 0 for owner (now an unknown role)', () => {
      expect(getRoleLevel('owner')).toBe(0);
    });

    it('should return 0 for unknown roles', () => {
      expect(getRoleLevel('unknown')).toBe(0);
      expect(getRoleLevel('')).toBe(0);
    });
  });

  describe('filterAssignableRoles', () => {
    const allRoles = ['admin', 'manager', 'member'];

    it('manager should only assign manager and member', () => {
      expect(filterAssignableRoles(allRoles, 'manager')).toEqual(['manager', 'member']);
    });

    it('admin should assign all roles', () => {
      expect(filterAssignableRoles(allRoles, 'admin')).toEqual(['admin', 'manager', 'member']);
    });

    it('superadmin should assign all org roles', () => {
      expect(filterAssignableRoles(allRoles, 'superadmin')).toEqual(['admin', 'manager', 'member']);
    });

    it('member should only assign member', () => {
      expect(filterAssignableRoles(allRoles, 'member')).toEqual(['member']);
    });

    it('owner requester role defaults to level 0 — can only assign member', () => {
      expect(filterAssignableRoles(allRoles, 'owner')).toEqual(['member']);
    });

    it('should ignore unknown role names from input', () => {
      expect(filterAssignableRoles(['super-admin', 'admin', 'manager', 'member'], 'admin')).toEqual([
        'admin',
        'manager',
        'member',
      ]);
    });

    it('unknown role should only assign member-level roles', () => {
      expect(filterAssignableRoles(allRoles, 'unknown')).toEqual(['member']);
    });

    it('should filter out unknown role names from input list', () => {
      const rolesWithOwner = ['owner', 'admin', 'manager', 'member'];
      expect(filterAssignableRoles(rolesWithOwner, 'admin')).toEqual(['admin', 'manager', 'member']);
    });

    it('should handle empty input', () => {
      expect(filterAssignableRoles([], 'admin')).toEqual([]);
    });
  });
});
