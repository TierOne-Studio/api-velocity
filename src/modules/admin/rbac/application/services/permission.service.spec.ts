import { Test, TestingModule } from '@nestjs/testing';
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { PermissionService } from './permission.service';
import { PERMISSION_REPOSITORY } from '../../domain/repositories/permission.repository.interface';

const makeDomainPermission = (
  overrides: Partial<Record<string, unknown>> = {},
) => ({
  id: 'perm-1',
  resource: 'user',
  action: 'read',
  description: 'Read users',
  ...overrides,
});

describe('PermissionService', () => {
  let service: PermissionService;

  let mockPermRepo: any;

  beforeEach(async () => {
    mockPermRepo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByResourceAction: jest.fn(),
      findGroupedByResource: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        { provide: PERMISSION_REPOSITORY, useValue: mockPermRepo },
      ],
    }).compile();

    service = module.get<PermissionService>(PermissionService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('returns mapped permissions', async () => {
      mockPermRepo.findAll.mockResolvedValue([
        makeDomainPermission({ id: '1', resource: 'user', action: 'read' }),
        makeDomainPermission({ id: '2', resource: 'user', action: 'create' }),
      ]);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].resource).toBe('user');
      expect(result[0].action).toBe('read');
      expect(mockPermRepo.findAll).toHaveBeenCalled();
    });

    it('returns empty array when no permissions exist', async () => {
      mockPermRepo.findAll.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('returns permission when found', async () => {
      mockPermRepo.findById.mockResolvedValue(
        makeDomainPermission({ id: 'perm-1' }),
      );

      const result = await service.findById('perm-1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('perm-1');
      expect(mockPermRepo.findById).toHaveBeenCalledWith('perm-1');
    });

    it('returns null when not found', async () => {
      mockPermRepo.findById.mockResolvedValue(null);

      const result = await service.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('findByResourceAction', () => {
    it('returns permission when found', async () => {
      mockPermRepo.findByResourceAction.mockResolvedValue(
        makeDomainPermission({ resource: 'org', action: 'delete' }),
      );

      const result = await service.findByResourceAction('org', 'delete');

      expect(result).not.toBeNull();
      expect(result?.resource).toBe('org');
      expect(result?.action).toBe('delete');
      expect(mockPermRepo.findByResourceAction).toHaveBeenCalledWith(
        'org',
        'delete',
      );
    });

    it('returns null when not found', async () => {
      mockPermRepo.findByResourceAction.mockResolvedValue(null);

      const result = await service.findByResourceAction('org', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findGroupedByResource', () => {
    it('groups permissions by resource', async () => {
      mockPermRepo.findGroupedByResource.mockResolvedValue({
        user: [
          makeDomainPermission({ id: '1', resource: 'user', action: 'read' }),
          makeDomainPermission({ id: '2', resource: 'user', action: 'create' }),
        ],
        org: [
          makeDomainPermission({ id: '3', resource: 'org', action: 'list' }),
        ],
      });

      const result = await service.findGroupedByResource();

      expect(Object.keys(result)).toEqual(
        expect.arrayContaining(['user', 'org']),
      );
      expect(result['user']).toHaveLength(2);
      expect(result['org']).toHaveLength(1);
    });

    it('returns empty object when no permissions', async () => {
      mockPermRepo.findGroupedByResource.mockResolvedValue({});

      const result = await service.findGroupedByResource();

      expect(result).toEqual({});
    });

    it('accumulates multiple resources correctly', async () => {
      mockPermRepo.findGroupedByResource.mockResolvedValue({
        user: [
          makeDomainPermission({ id: '1', resource: 'user', action: 'read' }),
          makeDomainPermission({ id: '2', resource: 'user', action: 'create' }),
          makeDomainPermission({ id: '3', resource: 'user', action: 'delete' }),
        ],
      });

      const result = await service.findGroupedByResource();

      expect(result['user']).toHaveLength(3);
    });
  });

  describe('create', () => {
    it('creates permission with description', async () => {
      mockPermRepo.create.mockResolvedValue(
        makeDomainPermission({
          id: 'new-1',
          resource: 'report',
          action: 'export',
          description: 'Export reports',
        }),
      );

      const result = await service.create('report', 'export', 'Export reports');

      expect(result.resource).toBe('report');
      expect(result.action).toBe('export');
      expect(mockPermRepo.create).toHaveBeenCalledWith(
        'report',
        'export',
        'Export reports',
      );
    });

    it('creates permission without description', async () => {
      mockPermRepo.create.mockResolvedValue(
        makeDomainPermission({
          id: 'new-2',
          resource: 'report',
          action: 'view',
          description: null,
        }),
      );

      const result = await service.create('report', 'view');

      expect(result.resource).toBe('report');
      expect(mockPermRepo.create).toHaveBeenCalledWith(
        'report',
        'view',
        undefined,
      );
    });
  });
});
