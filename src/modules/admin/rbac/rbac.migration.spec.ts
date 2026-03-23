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
        .mockResolvedValueOnce(true)   // rbac_005 already run
        .mockResolvedValueOnce(true)   // rbac_006 already run
        .mockResolvedValueOnce(true)   // rbac_007 already run
        .mockResolvedValueOnce(true)   // rbac_008 already run
        .mockResolvedValueOnce(true)   // rbac_009 already run
        .mockResolvedValueOnce(true)   // rbac_010 already run
        .mockResolvedValueOnce(true)   // rbac_011 already run
        .mockResolvedValueOnce(true);  // rbac_012 already run

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
        .mockResolvedValueOnce(true)    // rbac_005 already run
        .mockResolvedValueOnce(true)    // rbac_006 already run
        .mockResolvedValueOnce(false)   // rbac_007 NOT run
        .mockResolvedValueOnce(false)   // rbac_008 NOT run
        .mockResolvedValueOnce(false)   // rbac_009 NOT run
        .mockResolvedValueOnce(false)   // rbac_010 NOT run
        .mockResolvedValueOnce(false)   // rbac_011 NOT run
        .mockResolvedValueOnce(false);  // rbac_012 NOT run

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await service.runTrackedMigrations();

      expect(dbService.recordMigration).toHaveBeenCalledWith('rbac_002_migrate_old_role_names');
      expect(dbService.recordMigration).toHaveBeenCalledWith('rbac_003_seed_default_data');
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_004_add_manager_org_create_permission',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_007_add_role_organization_scope',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_008_redesign_superadmin_org_roles',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_009_normalize_org_default_role_permissions',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_010_remove_superadmin_org_memberships',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_011_add_manage_members_permission',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_012_assign_admin_full_permissions',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('9 new'),
      );
      consoleSpy.mockRestore();
    });

    it('should check all tracked RBAC migrations', async () => {
      dbService.hasMigrationRun.mockResolvedValue(true);

      jest.spyOn(console, 'log').mockImplementation(() => {});
      await service.runTrackedMigrations();

      expect(dbService.hasMigrationRun).toHaveBeenCalledWith('rbac_001_create_tables');
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith('rbac_002_migrate_old_role_names');
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith('rbac_003_seed_default_data');
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_004_add_manager_org_create_permission',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_005_backfill_role_permissions',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_006_assign_all_permissions_to_admin',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_007_add_role_organization_scope',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_008_redesign_superadmin_org_roles',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_009_normalize_org_default_role_permissions',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_010_remove_superadmin_org_memberships',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_011_add_manage_members_permission',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_012_assign_admin_full_permissions',
      );
    });
  });

  describe('createRbacTables', () => {
    it('should execute CREATE TABLE queries for roles, permissions, and role_permissions', async () => {
      await service.createRbacTables();

      expect(dbService.query).toHaveBeenCalledTimes(5);
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS roles'));
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE UNIQUE INDEX IF NOT EXISTS roles_system_name_unique_idx'),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE UNIQUE INDEX IF NOT EXISTS roles_org_name_unique_idx'),
      );
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS permissions'));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS role_permissions'));
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE'),
      );
    });
  });

  describe('migrateOldRoleNames', () => {
    it('should execute role, user, member, and default-role normalization queries', async () => {
      await service.migrateOldRoleNames();

      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining("name = 'moderator'"));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining("name = 'user'"));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining("role = 'moderator'"));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining("role = 'user'"));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE member SET role = \'manager\''));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE member SET role = \'member\''));
      expect(dbService.query).toHaveBeenCalledWith(expect.stringContaining('ALTER COLUMN role SET DEFAULT \'member\''));
    });
  });

  describe('redesignSuperadminAndOrganizationRoles', () => {
    it('migrates global admins to superadmin and seeds org-scoped default roles', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization')) {
          return [{ id: 'org-1' }, { id: 'org-2' }];
        }
        if (sql.includes('SELECT id FROM permissions')) {
          return [{ id: 'perm-1' }, { id: 'perm-2' }];
        }
        return [];
      });

      await service.redesignSuperadminAndOrganizationRoles();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "user" SET role = \'superadmin\' WHERE role = \'admin\''),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM roles WHERE organization_id IS NULL AND name IN ('admin', 'manager', 'member')"),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM organization'),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('VALUES ($1, $2, $3, $4, $5, NULL)'),
        ['superadmin', 'Superadmin', expect.any(String), 'red', true],
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('VALUES ($1, $2, $3, $4, $5, $6)'),
        ['admin', 'Admin', expect.any(String), 'red', true, 'org-1'],
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('VALUES ($1, $2, $3, $4, $5, $6)'),
        ['manager', 'Manager', expect.any(String), 'blue', true, 'org-1'],
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('VALUES ($1, $2, $3, $4, $5, $6)'),
        ['member', 'Member', expect.any(String), 'gray', true, 'org-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('RBAC superadmin/org role redesign seeded'));
      consoleSpy.mockRestore();
    });
  });

  describe('normalizeOrganizationDefaultRolePermissions', () => {
    it('replaces stale manager/member role permissions with the approved org defaults', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization')) {
          return [{ id: 'org-1' }];
        }
        return [];
      });

      dbService.queryOne
        .mockResolvedValueOnce({ id: 'manager-role-1' })
        .mockResolvedValueOnce({ id: 'perm-org-read' })
        .mockResolvedValueOnce({ id: 'perm-org-update' })
        .mockResolvedValueOnce({ id: 'perm-org-invite' })
        .mockResolvedValueOnce({ id: 'perm-role-read' })
        .mockResolvedValueOnce({ id: 'perm-session-read' })
        .mockResolvedValueOnce({ id: 'perm-session-revoke' })
        .mockResolvedValueOnce({ id: 'perm-user-create' })
        .mockResolvedValueOnce({ id: 'perm-user-read' })
        .mockResolvedValueOnce({ id: 'perm-user-update' })
        .mockResolvedValueOnce({ id: 'member-role-1' })
        .mockResolvedValueOnce({ id: 'perm-member-org-read' });

      await service.normalizeOrganizationDefaultRolePermissions();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM role_permissions'),
        [
          'manager-role-1',
          'organization',
          'read',
          'organization',
          'update',
          'organization',
          'invite',
          'role',
          'read',
          'session',
          'read',
          'session',
          'revoke',
          'user',
          'create',
          'user',
          'read',
          'user',
          'update',
        ],
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM role_permissions'),
        ['member-role-1', 'organization', 'read'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Organization default role permissions normalized'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('removeSuperadminOrganizationMemberships', () => {
    it('deletes all organization memberships for users whose role includes superadmin', async () => {
      await service.removeSuperadminOrganizationMemberships();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM member'),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM "user"'),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("LIKE '%superadmin%'"),
      );
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

  describe('assignAllPermissionsToAdmin', () => {
    it('should assign all permissions to admin when admin role exists', async () => {
      dbService.queryOne.mockResolvedValueOnce({ id: 'admin-id' });
      dbService.query.mockResolvedValueOnce([{ id: 'perm-1' }, { id: 'perm-2' }]);

      await service.assignAllPermissionsToAdmin();

      expect(dbService.queryOne).toHaveBeenCalledWith(`SELECT id FROM roles WHERE name = 'admin'`);
      expect(dbService.query).toHaveBeenCalledWith(`SELECT id FROM permissions`);
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['admin-id', 'perm-1'],
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['admin-id', 'perm-2'],
      );
    });

    it('should skip inserts when admin role does not exist', async () => {
      dbService.queryOne.mockResolvedValueOnce(null);

      await service.assignAllPermissionsToAdmin();

      expect(dbService.query).not.toHaveBeenCalledWith(`SELECT id FROM permissions`);
      expect(dbService.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.anything(),
      );
    });
  });
});
