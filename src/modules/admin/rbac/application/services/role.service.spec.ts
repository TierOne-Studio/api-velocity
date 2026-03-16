import { Test, TestingModule } from '@nestjs/testing';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { RoleService } from './role.service';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';

const makeDomainRole = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: '1',
  name: 'admin',
  displayName: 'Admin',
  description: 'Full access',
  color: 'red',
  isSystem: true,
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
      getPermissions: jest.fn(),
      setPermissions: jest.fn(),
      hasPermission: jest.fn(),
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

  describe('create', () => {
    it('should create a new role for the active organization', async () => {
      const createDto = { name: 'editor', displayName: 'Editor', description: 'Can edit content', color: 'blue' };
      mockRoleRepo.create.mockResolvedValue(makeDomainRole({ id: '2', name: 'editor', displayName: 'Editor', isSystem: false }));

      const result = await service.create(createDto, 'org-1');

      expect(result.name).toBe('editor');
      expect(result.isSystem).toBe(false);
      expect(mockRoleRepo.create).toHaveBeenCalledWith(createDto, 'org-1');
    });
  });

  describe('update', () => {
    it('should update a role', async () => {
      const updateDto = { displayName: 'Updated Editor' };
      const existing = makeDomainRole({ id: '2', name: 'editor', displayName: 'Editor', isSystem: false });
      const updated = makeDomainRole({ id: '2', name: 'editor', displayName: 'Updated Editor', isSystem: false });
      mockRoleRepo.findById.mockResolvedValue(existing);
      mockRoleRepo.update.mockResolvedValue(updated);

      const result = await service.update('2', updateDto);

      expect(result?.displayName).toBe('Updated Editor');
    });

    it('should allow updating system role display fields', async () => {
      const existing = makeDomainRole({ id: '1', name: 'admin', displayName: 'Admin', isSystem: true });
      const updated = makeDomainRole({ id: '1', name: 'admin', displayName: 'Administrator', isSystem: true });
      mockRoleRepo.findById.mockResolvedValue(existing);
      mockRoleRepo.update.mockResolvedValue(updated);

      const result = await service.update('1', { displayName: 'Administrator' });

      expect(result?.displayName).toBe('Administrator');
    });
  });

  describe('delete', () => {
    it('should delete a non-system role', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: '2', name: 'editor', isSystem: false }));
      mockRoleRepo.remove.mockResolvedValue(undefined);

      await service.delete('2');

      expect(mockRoleRepo.remove).toHaveBeenCalledWith('2');
    });

    it('should throw error when deleting system role', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: '1', name: 'admin', isSystem: true }));

      await expect(service.delete('1')).rejects.toThrow('Cannot delete system role');
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
      const existing = makeDomainRole({ id: '2', name: 'editor', isSystem: false });
      mockRoleRepo.findById.mockResolvedValue(existing);

      const result = await service.update('2', {});

      expect(result?.name).toBe('editor');
      expect(mockRoleRepo.findById).toHaveBeenCalledTimes(1);
      expect(mockRoleRepo.update).not.toHaveBeenCalled();
    });

    it('updates description field', async () => {
      const existing = makeDomainRole({ id: '2', name: 'editor', isSystem: false });
      const updated = makeDomainRole({ id: '2', name: 'editor', description: 'Updated desc', isSystem: false });
      mockRoleRepo.findById.mockResolvedValue(existing);
      mockRoleRepo.update.mockResolvedValue(updated);

      const result = await service.update('2', { description: 'Updated desc' });

      expect(result?.name).toBe('editor');
    });

    it('updates color field', async () => {
      const existing = makeDomainRole({ id: '2', name: 'editor', isSystem: false });
      const updated = makeDomainRole({ id: '2', name: 'editor', color: 'green', isSystem: false });
      mockRoleRepo.findById.mockResolvedValue(existing);
      mockRoleRepo.update.mockResolvedValue(updated);

      const result = await service.update('2', { color: 'green' });

      expect(result?.name).toBe('editor');
    });

    it('returns null when repo update returns null', async () => {
      mockRoleRepo.findById.mockResolvedValue(makeDomainRole({ id: '2', name: 'editor', isSystem: false }));
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
        makeDomainRole({ id: '1', name: 'admin', isSystem: false, organizationId: 'org-1' }),
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
});
