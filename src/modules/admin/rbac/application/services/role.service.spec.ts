import { Test, TestingModule } from '@nestjs/testing';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { RoleService } from './role.service';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';

const makeDomainRole = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: '1',
  name: 'admin',
  displayName: 'Admin',
  description: 'Full access',
  color: 'red',
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeDomainPermission = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'p1',
  resource: 'user',
  action: 'read',
  description: null,
  ...overrides,
});

describe('RoleService', () => {
  let service: RoleService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRoleRepo: any;

  beforeEach(async () => {
    mockRoleRepo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      findByNameInOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      getUsageSummary: jest.fn(),
      getPermissions: jest.fn(),
      setPermissions: jest.fn(),
      hasPermission: jest.fn(),
      getMemberRoleInOrg: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
      ],
    }).compile();

    service = module.get<RoleService>(RoleService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return visible roles for the active organization', async () => {
      mockRoleRepo.findAll.mockResolvedValue([makeDomainRole()]);

      const result = await service.findAll('org-1');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('admin');
      expect(result[0].displayName).toBe('Admin');
      expect(mockRoleRepo.findAll).toHaveBeenCalledWith('org-1');
    });

    it('should return all roles when no organization filter is provided', async () => {
      mockRoleRepo.findAll.mockResolvedValue([makeDomainRole(), makeDomainRole({ id: '2', name: 'member' })]);

      const result = await service.findAll(null);

      expect(result).toHaveLength(2);
      expect(mockRoleRepo.findAll).toHaveBeenCalledWith(null);
    });
  });

  describe('findByName', () => {
    it('should return role by name', async () => {
      mockRoleRepo.findByName.mockResolvedValue(makeDomainRole());

      const result = await service.findByName('admin');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('admin');
      expect(mockRoleRepo.findByName).toHaveBeenCalledWith('admin');
    });

    it('should return null if role not found', async () => {
      mockRoleRepo.findByName.mockResolvedValue(null);

      const result = await service.findByName('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByNameInOrganization', () => {
    it('should return role when found in the specified organization', async () => {
      mockRoleRepo.findByNameInOrganization.mockResolvedValue(makeDomainRole({ organizationId: 'org-1' }));

      const result = await service.findByNameInOrganization('admin', 'org-1');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('admin');
      expect(mockRoleRepo.findByNameInOrganization).toHaveBeenCalledWith('admin', 'org-1');
    });

    it('should return null when role not found in the specified organization', async () => {
      mockRoleRepo.findByNameInOrganization.mockResolvedValue(null);

      const result = await service.findByNameInOrganization('ghost', 'org-1');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new role for the active organization', async () => {
      const createDto = { name: 'editor', displayName: 'Editor', description: 'Can edit content', color: 'blue' };
      mockRoleRepo.create.mockResolvedValue(makeDomainRole({ id: '2', name: 'editor', displayName: 'Editor', isDefault: false }));

      const result = await service.create(createDto, 'org-1');

      expect(result.name).toBe('editor');
      expect(result.isDefault).toBe(false);
      expect(mockRoleRepo.create).toHaveBeenCalledWith(createDto, 'org-1');
    });
  });

  describe('update', () => {
    it('should update a role', async () => {
      const updateDto = { displayName: 'Updated Editor' };
      const existing = makeDomainRole({ id: '2', name: 'editor', displayName: 'Editor', isDefault: false });
      const updated = makeDomainRole({ id: '2', name: 'editor', displayName: 'Updated Editor', isDefault: false });
      mockRoleRepo.findById.mockResolvedValue(existing);
      mockRoleRepo.update.mockResolvedValue(updated);

      const result = await service.update('2', updateDto);

      expect(result?.displayName).toBe('Updated Editor');
    });

    it('should allow updating system role display fields', async () => {
      const existing = makeDomainRole({ id: '1', name: 'admin', displayName: 'Admin', isDefault: true });
      const updated = makeDomainRole({ id: '1', name: 'admin', displayName: 'Administrator', isDefault: true });
      mockRoleRepo.findById.mockResolvedValue(existing);
      mockRoleRepo.update.mockResolvedValue(updated);

      const result = await service.update('1', { displayName: 'Administrator' });

      expect(result?.displayName).toBe('Administrator');
    });

    it('renames an organization-scoped system role when the name is available', async () => {
      const existing = makeDomainRole({ id: '1', name: 'admin', organizationId: 'org-1', isDefault: true });
      const updated = makeDomainRole({ id: '1', name: 'owner', organizationId: 'org-1', isDefault: true });
      mockRoleRepo.findById.mockResolvedValue(existing);
      mockRoleRepo.findByNameInOrganization.mockResolvedValue(null);
      mockRoleRepo.update.mockResolvedValue(updated);

      const result = await service.update('1', { name: 'Owner' });

      expect(result?.name).toBe('owner');
      expect(mockRoleRepo.findByNameInOrganization).toHaveBeenCalledWith('owner', 'org-1');
      expect(mockRoleRepo.update).toHaveBeenCalledWith('1', expect.objectContaining({ name: 'owner' }));
    });

    it('blocks renaming a global role', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: 'global-admin', name: 'admin', organizationId: null }));

      await expect(service.update('global-admin', { name: 'owner' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockRoleRepo.update).not.toHaveBeenCalled();
    });

    it('blocks renaming a role when the target name already exists in the organization', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: '1', name: 'admin', organizationId: 'org-1', isDefault: true }));
      mockRoleRepo.findByNameInOrganization.mockResolvedValue(makeDomainRole({ id: '2', name: 'owner', organizationId: 'org-1', isDefault: false }));

      await expect(service.update('1', { name: 'owner' })).rejects.toBeInstanceOf(ConflictException);
      expect(mockRoleRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a non-system role', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: '2', name: 'editor', organizationId: 'org-1', isDefault: false }));
      mockRoleRepo.getUsageSummary.mockResolvedValue({ users: 0, members: 0, invitations: 0 });
      mockRoleRepo.remove.mockResolvedValue(undefined);

      await service.delete('2');

      expect(mockRoleRepo.remove).toHaveBeenCalledWith('2');
    });

    it('allows deleting an unused organization-scoped system role', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: '1', name: 'admin', organizationId: 'org-1', isDefault: true }));
      mockRoleRepo.getUsageSummary.mockResolvedValue({ users: 0, members: 0, invitations: 0 });
      mockRoleRepo.remove.mockResolvedValue(undefined);

      await expect(service.delete('1')).resolves.toBeUndefined();
      expect(mockRoleRepo.remove).toHaveBeenCalledWith('1');
    });

    it('blocks deleting a global role', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: 'global-admin', name: 'admin', organizationId: null }));

      await expect(service.delete('global-admin')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockRoleRepo.getUsageSummary).not.toHaveBeenCalled();
    });

    it('blocks deleting a role that is still assigned', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: '1', name: 'admin', organizationId: 'org-1', isDefault: true }));
      mockRoleRepo.getUsageSummary.mockResolvedValue({ users: 1, members: 1, invitations: 0 });

      await expect(service.delete('1')).rejects.toBeInstanceOf(ConflictException);
      expect(mockRoleRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('getPermissions', () => {
    it('should return permissions for a role', async () => {
      mockRoleRepo.getPermissions.mockResolvedValue([
        makeDomainPermission({ id: '1', action: 'create' }),
        makeDomainPermission({ id: '2', action: 'read' }),
      ]);

      const result = await service.getPermissions('1');

      expect(result).toHaveLength(2);
      expect(result[0].resource).toBe('user');
      expect(mockRoleRepo.getPermissions).toHaveBeenCalledWith('1');
    });
  });

  describe('assignPermissions', () => {
    it('should assign permissions to a role', async () => {
      mockRoleRepo.setPermissions.mockResolvedValue(undefined);

      await service.assignPermissions('2', ['perm1', 'perm2']);

      expect(mockRoleRepo.setPermissions).toHaveBeenCalledWith('2', ['perm1', 'perm2']);
    });

    it('should assign empty permissions array', async () => {
      mockRoleRepo.setPermissions.mockResolvedValue(undefined);

      await service.assignPermissions('2', []);

      expect(mockRoleRepo.setPermissions).toHaveBeenCalledWith('2', []);
    });
  });

  describe('findById', () => {
    it('returns role when found', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole());

      const result = await service.findById('1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('1');
    });

    it('returns null when not found', async () => {
      mockRoleRepo.findById.mockResolvedValue(null);

      const result = await service.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('update — branch coverage', () => {
    it('returns null when role not found — covers !existing branch', async () => {
      mockRoleRepo.findById.mockResolvedValue(null);

      const result = await service.update('missing', { displayName: 'X' });

      expect(result).toBeNull();
    });

    it('returns existing role when dto is empty — covers hasAnyField === false branch', async () => {
      const existing = makeDomainRole({ id: '2', name: 'editor', isDefault: false });
      mockRoleRepo.findById.mockResolvedValue(existing);

      const result = await service.update('2', {});

      expect(result?.name).toBe('editor');
      expect(mockRoleRepo.findById).toHaveBeenCalledTimes(1);
      expect(mockRoleRepo.update).not.toHaveBeenCalled();
    });

    it('updates description field', async () => {
      const existing = makeDomainRole({ id: '2', name: 'editor', isDefault: false });
      const updated = makeDomainRole({ id: '2', name: 'editor', description: 'Updated desc', isDefault: false });
      mockRoleRepo.findById.mockResolvedValue(existing);
      mockRoleRepo.update.mockResolvedValue(updated);

      const result = await service.update('2', { description: 'Updated desc' });

      expect(result?.name).toBe('editor');
    });

    it('updates color field', async () => {
      const existing = makeDomainRole({ id: '2', name: 'editor', isDefault: false });
      const updated = makeDomainRole({ id: '2', name: 'editor', color: 'green', isDefault: false });
      mockRoleRepo.findById.mockResolvedValue(existing);
      mockRoleRepo.update.mockResolvedValue(updated);

      const result = await service.update('2', { color: 'green' });

      expect(result?.name).toBe('editor');
    });

    it('returns null when repo update returns null', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: '2', name: 'editor', isDefault: false }));
      mockRoleRepo.update.mockResolvedValue(null);

      const result = await service.update('2', { displayName: 'New Name' });

      expect(result).toBeNull();
    });
  });

  describe('delete — branch coverage', () => {
    it('throws when role not found — covers !existing branch', async () => {
      mockRoleRepo.findById.mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toThrow('Role not found');
    });
  });

  describe('getUserPermissions', () => {
    it('returns empty array when global role not found — covers !role branch', async () => {
      mockRoleRepo.findByName.mockResolvedValue(null);

      const result = await service.getUserPermissions('nonexistent', null);

      expect(result).toEqual([]);
    });

    it('returns org-scoped permissions when active organization is provided', async () => {
      mockRoleRepo.findByNameInOrganization.mockResolvedValue(
        makeDomainRole({ id: '1', name: 'admin', isDefault: false, organizationId: 'org-1' }),
      );
      mockRoleRepo.getPermissions.mockResolvedValue([makeDomainPermission()]);

      const result = await service.getUserPermissions('admin', 'org-1');

      expect(result).toHaveLength(1);
      expect(result[0].resource).toBe('user');
      expect(mockRoleRepo.findByNameInOrganization).toHaveBeenCalledWith('admin', 'org-1');
    });

    it('returns global permissions when active organization is not provided', async () => {
      mockRoleRepo.findByName.mockResolvedValue(makeDomainRole({ id: '1', name: 'superadmin' }));
      mockRoleRepo.getPermissions.mockResolvedValue([makeDomainPermission()]);

      const result = await service.getUserPermissions('superadmin', null);

      expect(result).toHaveLength(1);
      expect(result[0].resource).toBe('user');
      expect(mockRoleRepo.findByName).toHaveBeenCalledWith('superadmin');
    });
  });

  describe('hasPermission', () => {
    it('returns true when repo returns true', async () => {
      mockRoleRepo.hasPermission.mockResolvedValue(true);

      const result = await service.hasPermission('admin', 'user', 'read');

      expect(result).toBe(true);
    });

    it('returns false when repo returns false', async () => {
      mockRoleRepo.hasPermission.mockResolvedValue(false);

      const result = await service.hasPermission('member', 'user', 'delete');

      expect(result).toBe(false);
    });
  });

  describe('getUserActiveMemberRole', () => {
    it('returns the member role from the repo', async () => {
      mockRoleRepo.getMemberRoleInOrg.mockResolvedValue('admin');

      const result = await service.getUserActiveMemberRole('u-1', 'org-1');

      expect(result).toBe('admin');
      expect(mockRoleRepo.getMemberRoleInOrg).toHaveBeenCalledWith('u-1', 'org-1');
    });

    it('returns null when user has no membership in org', async () => {
      mockRoleRepo.getMemberRoleInOrg.mockResolvedValue(null);

      const result = await service.getUserActiveMemberRole('u-ghost', 'org-1');

      expect(result).toBeNull();
    });
  });
});
