import { Test, TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { RbacMigrationService } from './rbac.migration';
import { DatabaseService } from '../../../shared/infrastructure/database/database.module';

/**
 * Unit tests for RbacMigrationService tracked migrations (PR#3 - migration tracking system)
 */
describe('RbacMigrationService', () => {
  let service: RbacMigrationService;
  let dbService: any;

  beforeEach(async () => {
    const mockDbService = {
      query: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      queryOne: jest.fn<() => Promise<unknown | null>>().mockResolvedValue(null),
      hasMigrationRun: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
      recordMigration: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacMigrationService,
        { provide: DatabaseService, useValue: mockDbService },
      ],
    }).compile();

    service = module.get<RbacMigrationService>(RbacMigrationService);
    dbService = module.get(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('runTrackedMigrations', () => {
    it('should skip migrations that have already run', async () => {
      dbService.hasMigrationRun
        .mockResolvedValueOnce(true)   // rbac_001 already run
        .mockResolvedValueOnce(true)   // rbac_002 already run
        .mockResolvedValueOnce(true)   // rbac_003 already run
        .mockResolvedValueOnce(true)   // rbac_004 already run
        .mockResolvedValueOnce(true);  // rbac_005 already run

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await service.runTrackedMigrations();

      expect(dbService.recordMigration).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('up to date'),
      );
      consoleSpy.mockRestore();
    });

    it('should run and record pending migrations', async () => {
      dbService.hasMigrationRun
        .mockResolvedValueOnce(true)    // rbac_001 already run
        .mockResolvedValueOnce(false)   // rbac_002 NOT run
        .mockResolvedValueOnce(false)   // rbac_003 NOT run
        .mockResolvedValueOnce(false)   // rbac_004 NOT run
        .mockResolvedValueOnce(true);   // rbac_005 already run

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await service.runTrackedMigrations();

      expect(dbService.recordMigration).toHaveBeenCalledWith('rbac_002_migrate_old_role_names');
      expect(dbService.recordMigration).toHaveBeenCalledWith('rbac_003_seed_default_data');
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_004_add_manager_org_create_permission',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('3 new'),
      );
      consoleSpy.mockRestore();
    });

    it('should check all four RBAC migrations', async () => {
      dbService.hasMigrationRun.mockResolvedValue(true);

      jest.spyOn(console, 'log').mockImplementation(() => {});
      await service.runTrackedMigrations();

      expect(dbService.hasMigrationRun).toHaveBeenCalledWith('rbac_001_create_tables');
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith('rbac_002_migrate_old_role_names');
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith('rbac_003_seed_default_data');
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_004_add_manager_org_create_permission',
      );
    });
  });

  describe('createRbacTables', () => {
    it('should execute CREATE TABLE queries for roles, permissions, and role_permissions', async () => {
      await service.createRbacTables();

      expect(dbService.query).toHaveBeenCalledTimes(3);
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS roles'));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS permissions'));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS role_permissions'));
    });
  });

  describe('migrateOldRoleNames', () => {
    it('should execute UPDATE queries for role renames and user table updates', async () => {
      await service.migrateOldRoleNames();

      expect(dbService.query).toHaveBeenCalledTimes(4);
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining("name = 'moderator'"));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining("name = 'user'"));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining("role = 'moderator'"));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining("role = 'user'"));
    });
  });

  describe('seedDefaultData', () => {
    it('should seed permissions, roles, and assign permissions when all roles found', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // queryOne returns: admin role, then manager role, then member role
      // Also returns permission lookups for manager and member assignments
      dbService.queryOne
        .mockResolvedValueOnce({ id: 'admin-id' })   // admin role lookup
        .mockResolvedValueOnce({ id: 'manager-id' })  // manager role lookup
        .mockResolvedValueOnce({ id: 'perm-1' })      // manager perm lookup 1
        .mockResolvedValueOnce({ id: 'perm-2' })      // manager perm lookup 2
        .mockResolvedValueOnce({ id: 'perm-3' })      // manager perm lookup 3
        .mockResolvedValueOnce({ id: 'perm-4' })      // manager perm lookup 4
        .mockResolvedValueOnce({ id: 'perm-5' })      // manager perm lookup 5
        .mockResolvedValueOnce({ id: 'perm-6' })      // manager perm lookup 6
        .mockResolvedValueOnce({ id: 'perm-7' })      // manager perm lookup 7
        .mockResolvedValueOnce({ id: 'perm-8' })      // manager perm lookup 8
        .mockResolvedValueOnce({ id: 'perm-9' })      // manager perm lookup 9
        .mockResolvedValueOnce({ id: 'perm-10' })     // manager perm lookup 10
        .mockResolvedValueOnce({ id: 'member-id' })   // member role lookup
        .mockResolvedValueOnce({ id: 'perm-11' })     // member perm lookup 1
        .mockResolvedValueOnce({ id: 'perm-12' })     // member perm lookup 2
        .mockResolvedValueOnce({ id: 'perm-13' });    // member perm lookup 3

      // query returns all permissions for admin assignment
      dbService.query.mockResolvedValue([
        { id: 'all-perm-1' },
        { id: 'all-perm-2' },
      ]);

      await service.seedDefaultData();

      // Should have inserted permissions (21) + roles (3) + admin perms (2) + manager perms (10) + member perms (3)
      expect(dbService.query).toHaveBeenCalled();
      expect(dbService.queryOne).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('RBAC default data seeded'));
      consoleSpy.mockRestore();
    });

    it('should skip admin permission assignment when admin role not found', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      dbService.queryOne
        .mockResolvedValueOnce(null)              // admin role not found
        .mockResolvedValueOnce(null)              // manager role not found
        .mockResolvedValueOnce(null);             // member role not found

      await service.seedDefaultData();

      // Should still seed permissions and roles, just skip assignments
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('RBAC default data seeded'));
      consoleSpy.mockRestore();
    });

    it('should skip manager permission insert when permission lookup returns null', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      dbService.queryOne
        .mockResolvedValueOnce(null)              // admin not found
        .mockResolvedValueOnce({ id: 'mgr-id' }) // manager found
        .mockResolvedValueOnce(null)              // first manager perm not found
        .mockResolvedValueOnce(null)              // second manager perm not found
        .mockResolvedValueOnce(null)              // etc.
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'mem-id' }) // member found
        .mockResolvedValueOnce(null)              // member perms not found
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await service.seedDefaultData();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('RBAC default data seeded'));
      consoleSpy.mockRestore();
    });
  });

  describe('addManagerOrganizationCreatePermission', () => {
    it('should assign org:create permission to manager when both exist', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ id: 'manager-id' })     // manager role
        .mockResolvedValueOnce({ id: 'org-create-id' }); // org:create permission

      await service.addManagerOrganizationCreatePermission();

      // INSERT permission + INSERT role_permissions
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO permissions'),
        ['organization', 'create', 'Create organizations'],
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['manager-id', 'org-create-id'],
      );
    });

    it('should skip role_permissions insert when manager role not found', async () => {
      dbService.queryOne
        .mockResolvedValueOnce(null)                      // manager role not found
        .mockResolvedValueOnce({ id: 'org-create-id' }); // org:create permission found

      await service.addManagerOrganizationCreatePermission();

      // Should only insert permission, not role_permissions
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO permissions'),
        ['organization', 'create', 'Create organizations'],
      );
      expect(dbService.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.anything(),
      );
    });

    it('should skip role_permissions insert when permission not found', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ id: 'manager-id' }) // manager role found
        .mockResolvedValueOnce(null);                 // org:create permission not found

      await service.addManagerOrganizationCreatePermission();

      expect(dbService.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.anything(),
      );
    });
  });
});
