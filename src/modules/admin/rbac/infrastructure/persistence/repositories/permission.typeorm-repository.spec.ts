import { jest } from '@jest/globals';
import { TypeOrmPermissionRepository } from './permission.typeorm-repository';

const mockFind = jest.fn<any>();
const mockFindOne = jest.fn<any>();
const mockCreate = jest.fn<any>();
const mockSave = jest.fn<any>();

const mockPermissionRepo = {
  find: mockFind,
  findOne: mockFindOne,
  create: mockCreate,
  save: mockSave,
};

describe('TypeOrmPermissionRepository', () => {
  let repo: TypeOrmPermissionRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new TypeOrmPermissionRepository(mockPermissionRepo as any);
  });

  const permEntity = {
    id: 'p-1',
    resource: 'users',
    action: 'read',
    description: 'Read users',
  };
  const permMapped = {
    id: 'p-1',
    resource: 'users',
    action: 'read',
    description: 'Read users',
  };

  describe('findAll', () => {
    it('returns mapped permission array', async () => {
      mockFind.mockResolvedValue([permEntity]);
      expect(await repo.findAll()).toEqual([permMapped]);
    });

    it('returns empty array when no permissions', async () => {
      mockFind.mockResolvedValue([]);
      expect(await repo.findAll()).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns mapped permission when found', async () => {
      mockFindOne.mockResolvedValue(permEntity);
      expect(await repo.findById('p-1')).toEqual(permMapped);
    });

    it('returns null when not found', async () => {
      mockFindOne.mockResolvedValue(null);
      expect(await repo.findById('nope')).toBeNull();
    });
  });

  describe('findByResourceAction', () => {
    it('returns mapped permission when found', async () => {
      mockFindOne.mockResolvedValue(permEntity);
      expect(await repo.findByResourceAction('users', 'read')).toEqual(
        permMapped,
      );
    });

    it('returns null when not found', async () => {
      mockFindOne.mockResolvedValue(null);
      expect(await repo.findByResourceAction('users', 'write')).toBeNull();
    });
  });

  describe('findGroupedByResource', () => {
    it('groups permissions by resource key', async () => {
      mockFind.mockResolvedValue([
        { id: 'p-1', resource: 'users', action: 'read', description: null },
        { id: 'p-2', resource: 'users', action: 'write', description: null },
        { id: 'p-3', resource: 'orgs', action: 'read', description: null },
      ]);
      const result = await repo.findGroupedByResource();
      expect(Object.keys(result)).toEqual(['users', 'orgs']);
      expect(result['users']).toHaveLength(2);
      expect(result['orgs']).toHaveLength(1);
    });

    it('returns empty object when no permissions', async () => {
      mockFind.mockResolvedValue([]);
      expect(await repo.findGroupedByResource()).toEqual({});
    });
  });

  describe('create', () => {
    it('creates and returns mapped permission', async () => {
      mockCreate.mockReturnValue(permEntity);
      mockSave.mockResolvedValue(permEntity);
      const result = await repo.create('users', 'read', 'Read users');
      expect(result).toEqual(permMapped);
    });

    it('uses null description when omitted', async () => {
      const entity = { ...permEntity, description: null };
      mockCreate.mockReturnValue(entity);
      mockSave.mockResolvedValue(entity);
      await repo.create('users', 'read');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
      );
    });
  });
});
