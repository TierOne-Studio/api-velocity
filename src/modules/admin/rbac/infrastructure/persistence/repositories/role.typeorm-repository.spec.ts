import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { TypeOrmRoleRepository } from './role.typeorm-repository';

const mockRoleFind = jest.fn<any>();
const mockRoleFindOne = jest.fn<any>();
const mockRoleCreate = jest.fn<any>();
const mockRoleSave = jest.fn<any>();
const mockRoleUpdate = jest.fn<any>();
const mockRoleDelete = jest.fn<any>();

const mockPermFindBy = jest.fn<any>();

const mockRoleRepo = {
  find: mockRoleFind,
  findOne: mockRoleFindOne,
  create: mockRoleCreate,
  save: mockRoleSave,
  update: mockRoleUpdate,
  delete: mockRoleDelete,
};

const mockPermRepo = {
  findBy: mockPermFindBy,
};

const mockQueryBuilder = {
  setLock: jest.fn<any>().mockReturnThis(),
  where: jest.fn<any>().mockReturnThis(),
  getOne: jest.fn<any>(),
};

const mockTransactionManager = {
  findOne: jest.fn<any>(),
  findBy: jest.fn<any>(),
  query: jest.fn<any>(),
  update: jest.fn<any>(),
  save: jest.fn<any>(),
  delete: jest.fn<any>(),
  createQueryBuilder: jest.fn<any>().mockReturnValue(mockQueryBuilder),
};

const mockDataSource = {
  transaction: jest.fn<any>().mockImplementation(
    async (fn: (manager: typeof mockTransactionManager) => Promise<unknown>) => {
      return fn(mockTransactionManager);
    },
  ),
  query: jest.fn<any>(),
};

describe('TypeOrmRoleRepository', () => {
  let repo: TypeOrmRoleRepository;

  const roleEntity = {
    id: 'r-1',
    name: 'admin',
    displayName: 'Admin',
    description: 'Admin role',
    color: 'red',
    isDefault: true,
    organizationId: 'org-1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    permissions: [],
  };
  const roleMapped = {
    id: 'r-1',
    name: 'admin',
    displayName: 'Admin',
    description: 'Admin role',
    color: 'red',
    isDefault: true,
    isSystem: false,
    organizationId: 'org-1',
    createdAt: roleEntity.createdAt,
    updatedAt: roleEntity.updatedAt,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryBuilder.setLock.mockReturnThis();
    mockQueryBuilder.where.mockReturnThis();
    mockTransactionManager.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    repo = new TypeOrmRoleRepository(mockRoleRepo as any, mockPermRepo as any, mockDataSource as any);
    mockDataSource.transaction.mockImplementation(
      async (fn: (manager: typeof mockTransactionManager) => Promise<unknown>) => {
        return fn(mockTransactionManager);
      },
    );
  });

  // ─── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns mapped role array', async () => {
      mockRoleFind.mockResolvedValue([roleEntity]);
      expect(await repo.findAll('org-1')).toEqual([roleMapped]);
      expect(mockRoleFind).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        order: { isDefault: 'DESC', name: 'ASC' },
      });
    });

    it('returns mapped role array for all organizations when no org filter is provided', async () => {
      mockRoleFind.mockResolvedValue([roleEntity]);
      expect(await repo.findAll(null)).toEqual([roleMapped]);
      expect(mockRoleFind).toHaveBeenCalledWith({
        order: { organizationId: 'ASC', isDefault: 'DESC', name: 'ASC' },
      });
    });

    it('returns empty array when no roles', async () => {
      mockRoleFind.mockResolvedValue([]);
      expect(await repo.findAll('org-1')).toEqual([]);
    });
  });

  // ─── findById ────────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns mapped role when found', async () => {
      mockRoleFindOne.mockResolvedValue(roleEntity);
      expect(await repo.findById('r-1')).toEqual(roleMapped);
    });

    it('returns null when not found', async () => {
      mockRoleFindOne.mockResolvedValue(null);
      expect(await repo.findById('nope')).toBeNull();
    });
  });

  // ─── findByName ──────────────────────────────────────────────────────────────

  describe('findByName', () => {
    it('returns mapped role when found', async () => {
      mockRoleFindOne.mockResolvedValue(roleEntity);
      expect(await repo.findByName('admin')).toEqual(roleMapped);
    });

    it('returns null when not found', async () => {
      mockRoleFindOne.mockResolvedValue(null);
      expect(await repo.findByName('ghost')).toBeNull();
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('saves and returns mapped role', async () => {
      mockRoleCreate.mockReturnValue(roleEntity);
      mockRoleSave.mockResolvedValue(roleEntity);
      const result = await repo.create({ name: 'admin', displayName: 'Admin' }, 'org-1');
      expect(result).toEqual(roleMapped);
    });

    it('defaults color to gray and description to null', async () => {
      mockRoleCreate.mockReturnValue(roleEntity);
      mockRoleSave.mockResolvedValue(roleEntity);
      await repo.create({ name: 'custom', displayName: 'Custom' }, 'org-1');
      expect(mockRoleCreate).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'gray', description: null, organizationId: 'org-1' }),
      );
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('applies partial fields and returns mapped role', async () => {
      mockTransactionManager.findOne.mockResolvedValue(roleEntity);
      mockTransactionManager.update.mockResolvedValue(undefined);
      mockTransactionManager.findOne.mockResolvedValueOnce(roleEntity).mockResolvedValueOnce(roleEntity);
      const result = await repo.update('r-1', { displayName: 'Super Admin', color: 'blue' });
      expect(result).toEqual(roleMapped);
      expect(mockTransactionManager.update).toHaveBeenCalledWith(
        expect.anything(),
        'r-1',
        expect.objectContaining({ displayName: 'Super Admin', color: 'blue' }),
      );
    });

    it('returns null when role not found after update', async () => {
      mockTransactionManager.findOne.mockResolvedValue(null);
      expect(await repo.update('nope', { displayName: 'X' })).toBeNull();
    });

    it('skips undefined fields in partial', async () => {
      mockTransactionManager.findOne.mockResolvedValueOnce(roleEntity).mockResolvedValueOnce(roleEntity);
      mockTransactionManager.update.mockResolvedValue(undefined);
      await repo.update('r-1', { description: 'new desc' });
      const [, , partial] = (mockTransactionManager.update as jest.Mock).mock.calls[0] as [unknown, string, object];
      expect(partial).not.toHaveProperty('displayName');
      expect(partial).not.toHaveProperty('color');
    });

    it('propagates a role rename to member and invitation rows only (not user)', async () => {
      mockTransactionManager.findOne
        .mockResolvedValueOnce(roleEntity)
        .mockResolvedValueOnce({ ...roleEntity, name: 'owner' });
      mockTransactionManager.update.mockResolvedValue(undefined);
      mockTransactionManager.query.mockResolvedValue(undefined);

      const result = await repo.update('r-1', { name: 'owner' });

      expect(result).toEqual({ ...roleMapped, name: 'owner' });
      expect(mockTransactionManager.query).toHaveBeenCalledTimes(2);
      expect((mockTransactionManager.query as jest.Mock).mock.calls[0][0]).toContain('UPDATE member SET role = $1');
      expect((mockTransactionManager.query as jest.Mock).mock.calls[1][0]).toContain('UPDATE invitation SET role = $1');
    });
  });

  // ─── remove ──────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes role via transaction with pessimistic lock', async () => {
      mockQueryBuilder.getOne.mockResolvedValue({ id: 'r-1', name: 'admin' });
      mockTransactionManager.delete.mockResolvedValue(undefined);
      await repo.remove('r-1');
      expect(mockTransactionManager.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(mockTransactionManager.delete).toHaveBeenCalledWith(expect.anything(), 'r-1');
    });

    it('does nothing when role is not found', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      await repo.remove('ghost');
      expect(mockTransactionManager.delete).not.toHaveBeenCalled();
    });
  });

  describe('getUsageSummary', () => {
    it('returns zeroes when role is missing', async () => {
      mockRoleFindOne.mockResolvedValue(null);

      await expect(repo.getUsageSummary('missing')).resolves.toEqual({ users: 0, members: 0, invitations: 0 });
    });

    it('returns organization-scoped usage counts', async () => {
      mockRoleFindOne.mockResolvedValue(roleEntity);
      mockDataSource.query.mockResolvedValue([{ users: '1', members: '2', invitations: '3' }]);

      await expect(repo.getUsageSummary('r-1')).resolves.toEqual({ users: 1, members: 2, invitations: 3 });
    });
  });

  // ─── getPermissions ──────────────────────────────────────────────────────────

  describe('getPermissions', () => {
    it('returns empty array when role not found', async () => {
      mockRoleFindOne.mockResolvedValue(null);
      expect(await repo.getPermissions('nope')).toEqual([]);
    });

    it('returns sorted mapped permissions', async () => {
      const permA = { id: 'p-1', resource: 'users', action: 'write', description: null };
      const permB = { id: 'p-2', resource: 'users', action: 'read', description: null };
      const permC = { id: 'p-3', resource: 'orgs', action: 'read', description: null };
      mockRoleFindOne.mockResolvedValue({ ...roleEntity, permissions: [permA, permB, permC] });
      const result = await repo.getPermissions('r-1');
      expect(result[0].resource).toBe('orgs');
      expect(result[1].action).toBe('read');
      expect(result[2].action).toBe('write');
    });

    it('returns empty array when permissions is null/undefined', async () => {
      mockRoleFindOne.mockResolvedValue({ ...roleEntity, permissions: null });
      const result = await repo.getPermissions('r-1');
      expect(result).toEqual([]);
    });
  });

  // ─── setPermissions ──────────────────────────────────────────────────────────

  describe('setPermissions', () => {
    it('throws NotFoundException when role not found in transaction', async () => {
      mockTransactionManager.findOne.mockResolvedValue(null);
      await expect(repo.setPermissions('nope', ['p-1'])).rejects.toThrow(NotFoundException);
      expect(mockTransactionManager.save).not.toHaveBeenCalled();
    });

    it('assigns permissions when permissionIds are provided', async () => {
      const permEntity = { id: 'p-1', resource: 'users', action: 'read', description: null };
      mockTransactionManager.findOne.mockResolvedValue({ ...roleEntity, permissions: [] });
      mockTransactionManager.findBy.mockResolvedValue([permEntity]);
      mockTransactionManager.save.mockResolvedValue(undefined);
      await repo.setPermissions('r-1', ['p-1']);
      expect(mockTransactionManager.save).toHaveBeenCalled();
    });

    it('assigns empty permissions when permissionIds is empty', async () => {
      mockTransactionManager.findOne.mockResolvedValue({ ...roleEntity, permissions: [] });
      mockTransactionManager.save.mockResolvedValue(undefined);
      await repo.setPermissions('r-1', []);
      expect(mockTransactionManager.findBy).not.toHaveBeenCalled();
      expect(mockTransactionManager.save).toHaveBeenCalled();
    });
  });

  // ─── hasPermission ───────────────────────────────────────────────────────────

  describe('hasPermission', () => {
    it('returns true when count > 0', async () => {
      mockDataSource.query.mockResolvedValue([{ count: '1' }]);
      expect(await repo.hasPermission('admin', 'users', 'read')).toBe(true);
    });

    it('returns false when count is 0', async () => {
      mockDataSource.query.mockResolvedValue([{ count: '0' }]);
      expect(await repo.hasPermission('member', 'users', 'delete')).toBe(false);
    });

    it('returns false when result is empty', async () => {
      mockDataSource.query.mockResolvedValue([]);
      expect(await repo.hasPermission('member', 'users', 'delete')).toBe(false);
    });
  });

  // ─── getMemberRoleInOrg ───────────────────────────────────────────────────────

  describe('getMemberRoleInOrg', () => {
    it('returns the member role when found', async () => {
      mockDataSource.query.mockResolvedValue([{ role: 'admin' }]);
      expect(await repo.getMemberRoleInOrg('u-1', 'org-1')).toBe('admin');
    });

    it('returns null when no membership found', async () => {
      mockDataSource.query.mockResolvedValue([]);
      expect(await repo.getMemberRoleInOrg('u-ghost', 'org-1')).toBeNull();
    });
  });
});
