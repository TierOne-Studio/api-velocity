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
      queryOne: jest
        .fn<() => Promise<unknown | null>>()
        .mockResolvedValue(null),
      hasMigrationRun: jest
        .fn<() => Promise<boolean>>()
        .mockResolvedValue(false),
      recordMigration: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
      transaction: jest
        .fn()
        .mockImplementation((cb: (q: any) => Promise<void>) =>
          cb(jest.fn<() => Promise<unknown[]>>().mockResolvedValue([])),
        ),
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

  describe('onModuleInit', () => {
    it('calls runTrackedMigrations on module init', async () => {
      dbService.hasMigrationRun.mockResolvedValue(true);
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      await service.onModuleInit();

      consoleSpy.mockRestore();
      expect(dbService.hasMigrationRun).toHaveBeenCalled();
    });
  });

  describe('runTrackedMigrations', () => {
    it('should skip migrations that have already run', async () => {
      dbService.hasMigrationRun
        .mockResolvedValueOnce(true) // rbac_001 already run
        .mockResolvedValueOnce(true) // rbac_002 already run
        .mockResolvedValueOnce(true) // rbac_003 already run
        .mockResolvedValueOnce(true) // rbac_004 already run
        .mockResolvedValueOnce(true) // rbac_005 already run
        .mockResolvedValueOnce(true) // rbac_006 already run
        .mockResolvedValueOnce(true) // rbac_007 already run
        .mockResolvedValueOnce(true) // rbac_008 already run
        .mockResolvedValueOnce(true) // rbac_009 already run
        .mockResolvedValueOnce(true) // rbac_010 already run
        .mockResolvedValueOnce(true) // rbac_011 already run
        .mockResolvedValueOnce(true) // rbac_012 already run
        .mockResolvedValueOnce(true) // rbac_013 already run
        .mockResolvedValueOnce(true) // rbac_014 already run
        .mockResolvedValueOnce(true) // rbac_015 already run
        .mockResolvedValueOnce(true) // rbac_016 already run
        .mockResolvedValueOnce(true) // rbac_017 already run
        .mockResolvedValueOnce(true) // rbac_018 already run
        .mockResolvedValueOnce(true) // rbac_019 already run
        .mockResolvedValueOnce(true) // rbac_020 already run
        .mockResolvedValueOnce(true) // rbac_021 already run
        .mockResolvedValueOnce(true) // rbac_022 already run
        .mockResolvedValueOnce(true) // rbac_023 already run
        .mockResolvedValueOnce(true) // rbac_024 already run
        .mockResolvedValueOnce(true); // rbac_025 already run

      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      await service.runTrackedMigrations();

      expect(dbService.recordMigration).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('up to date'),
      );
      consoleSpy.mockRestore();
    });

    it('should run and record pending migrations', async () => {
      dbService.hasMigrationRun
        .mockResolvedValueOnce(true) // rbac_001 already run
        .mockResolvedValueOnce(false) // rbac_002 NOT run
        .mockResolvedValueOnce(false) // rbac_003 NOT run
        .mockResolvedValueOnce(false) // rbac_004 NOT run
        .mockResolvedValueOnce(true) // rbac_005 already run
        .mockResolvedValueOnce(true) // rbac_006 already run
        .mockResolvedValueOnce(false) // rbac_007 NOT run
        .mockResolvedValueOnce(false) // rbac_008 NOT run
        .mockResolvedValueOnce(false) // rbac_009 NOT run
        .mockResolvedValueOnce(false) // rbac_010 NOT run
        .mockResolvedValueOnce(false) // rbac_011 NOT run
        .mockResolvedValueOnce(false) // rbac_012 NOT run
        .mockResolvedValueOnce(false) // rbac_013 NOT run
        .mockResolvedValueOnce(false) // rbac_014 NOT run
        .mockResolvedValueOnce(false) // rbac_015 NOT run
        .mockResolvedValueOnce(false) // rbac_016 NOT run
        .mockResolvedValueOnce(false) // rbac_017 NOT run
        .mockResolvedValueOnce(true) // rbac_018 already run
        .mockResolvedValueOnce(true) // rbac_019 already run
        .mockResolvedValueOnce(true) // rbac_020 already run
        .mockResolvedValueOnce(true) // rbac_021 already run
        .mockResolvedValueOnce(true) // rbac_022 already run
        .mockResolvedValueOnce(true) // rbac_023 already run
        .mockResolvedValueOnce(true) // rbac_024 already run
        .mockResolvedValueOnce(true); // rbac_025 already run

      // rbac_013 calls seedDefaultOrganization → UPSERT returns new org id.
      // Use mockImplementation so it isn't consumed by earlier migrations that also call queryOne.
      dbService.queryOne.mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO organization'))
          return { id: 'seeded-org-id' };
        return null;
      });

      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      await service.runTrackedMigrations();

      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_002_migrate_old_role_names',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_003_seed_default_data',
      );
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
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_013_seed_default_organization',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_014_add_project_permissions',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_015_add_chat_permissions',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_016_add_user_approve_permission',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_017_remove_phantom_permissions',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('14 new'),
      );
      consoleSpy.mockRestore();
    });

    it('should check all tracked RBAC migrations', async () => {
      dbService.hasMigrationRun.mockResolvedValue(true);

      jest.spyOn(console, 'log').mockImplementation(() => {});
      await service.runTrackedMigrations();

      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_001_create_tables',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_002_migrate_old_role_names',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_003_seed_default_data',
      );
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
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_013_seed_default_organization',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_014_add_project_permissions',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_015_add_chat_permissions',
      );
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
        'rbac_016_add_user_approve_permission',
      );
    });
  });

  describe('seedDefaultOrganization', () => {
    afterEach(() => {
      delete process.env.DEFAULT_ORGANIZATION_SLUG;
    });

    it('does nothing when the default org already exists', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      // UPSERT returns null (conflict — row already exists); fallback SELECT returns existing id
      dbService.queryOne
        .mockResolvedValueOnce(null) // INSERT ... ON CONFLICT DO NOTHING RETURNING → nothing inserted
        .mockResolvedValueOnce({ id: 'existing-org' }); // fallback SELECT

      await service.seedDefaultOrganization();

      expect(dbService.transaction).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('already exists'),
      );
      consoleSpy.mockRestore();
    });

    it('creates the org and seeds roles when the slug does not exist (uses DEFAULT_ORGANIZATION_SLUG)', async () => {
      process.env.DEFAULT_ORGANIZATION_SLUG = 'acme';
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      // UPSERT succeeds — new row inserted and returned
      dbService.queryOne.mockResolvedValueOnce({ id: 'new-org-id' });

      await service.seedDefaultOrganization();

      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organization'),
        expect.arrayContaining(['acme']),
      );
      expect(dbService.transaction).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('created with default roles'),
      );
      consoleSpy.mockRestore();
    });

    it("falls back to slug 'default' when DEFAULT_ORGANIZATION_SLUG is not set", async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      // UPSERT succeeds with the default slug
      dbService.queryOne.mockResolvedValueOnce({ id: 'new-org-id' });

      await service.seedDefaultOrganization();

      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organization'),
        expect.arrayContaining(['default']),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('createRbacTables', () => {
    it('should execute CREATE TABLE queries for roles, permissions, and role_permissions', async () => {
      await service.createRbacTables();

      expect(dbService.query).toHaveBeenCalledTimes(5);
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS roles'),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'CREATE UNIQUE INDEX IF NOT EXISTS roles_system_name_unique_idx',
        ),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'CREATE UNIQUE INDEX IF NOT EXISTS roles_org_name_unique_idx',
        ),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS permissions'),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS role_permissions'),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE',
        ),
      );
    });
  });

  describe('migrateOldRoleNames', () => {
    it('should execute role, user, member, and default-role normalization queries', async () => {
      await service.migrateOldRoleNames();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("name = 'moderator'"),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("name = 'user'"),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("role = 'moderator'"),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("role = 'user'"),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE member SET role = 'manager'"),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE member SET role = 'member'"),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("ALTER COLUMN role SET DEFAULT 'member'"),
      );
    });
  });

  describe('redesignSuperadminAndOrganizationRoles', () => {
    it('migrates global admins to superadmin and seeds org-scoped default roles', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

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
        expect.stringContaining(
          "UPDATE \"user\" SET role = 'superadmin' WHERE role = 'admin'",
        ),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "DELETE FROM roles WHERE organization_id IS NULL AND name IN ('admin', 'manager', 'member')",
        ),
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
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('RBAC superadmin/org role redesign seeded'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('normalizeOrganizationDefaultRolePermissions', () => {
    it('replaces stale manager/member role permissions with the approved org defaults', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

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
        .mockResolvedValueOnce({ id: 'perm-chat-read' })
        .mockResolvedValueOnce({ id: 'perm-chat-create' })
        .mockResolvedValueOnce({ id: 'perm-chat-stream' })
        .mockResolvedValueOnce({ id: 'perm-chat-delete' })
        .mockResolvedValueOnce({ id: 'perm-role-read' })
        .mockResolvedValueOnce({ id: 'perm-session-read' })
        .mockResolvedValueOnce({ id: 'perm-session-revoke' })
        .mockResolvedValueOnce({ id: 'perm-user-create' })
        .mockResolvedValueOnce({ id: 'perm-user-read' })
        .mockResolvedValueOnce({ id: 'perm-user-update' })
        .mockResolvedValueOnce({ id: 'perm-project-read' })
        .mockResolvedValueOnce({ id: 'perm-project-update' })
        .mockResolvedValueOnce({ id: 'perm-project-manage-sources' })
        .mockResolvedValueOnce({ id: 'perm-dashboard-view' })
        // rbac_020 — manager gains airweave: create / read / update /
        // manage-sources (no delete; see ADR-011 asymmetry).
        .mockResolvedValueOnce({ id: 'perm-airweave-create' })
        .mockResolvedValueOnce({ id: 'perm-airweave-read' })
        .mockResolvedValueOnce({ id: 'perm-airweave-update' })
        .mockResolvedValueOnce({ id: 'perm-airweave-manage-sources' })
        // rbac_021 — manager gains the full sql-connection CRUD set per ADR-012
        // (no delete-asymmetry because SQL connections have no nested resources).
        .mockResolvedValueOnce({ id: 'perm-sql-connection-read' })
        .mockResolvedValueOnce({ id: 'perm-sql-connection-create' })
        .mockResolvedValueOnce({ id: 'perm-sql-connection-update' })
        .mockResolvedValueOnce({ id: 'perm-sql-connection-delete' })
        // rbac_022 — manager gains vector-db read/create/update (no delete:
        // removal is admin-only, revoked from the constant by rbac_023).
        // rbac_024 — manager gains vector-db:upload.
        .mockResolvedValueOnce({ id: 'perm-vector-db-read' })
        .mockResolvedValueOnce({ id: 'perm-vector-db-create' })
        .mockResolvedValueOnce({ id: 'perm-vector-db-update' })
        .mockResolvedValueOnce({ id: 'perm-vector-db-upload' })
        // rbac_025 — manager gains embed-site read/create/update (no delete:
        // disposal is admin-only, mirrors the vector-db asymmetry).
        .mockResolvedValueOnce({ id: 'perm-embed-site-read' })
        .mockResolvedValueOnce({ id: 'perm-embed-site-create' })
        .mockResolvedValueOnce({ id: 'perm-embed-site-update' })
        .mockResolvedValueOnce({ id: 'member-role-1' })
        .mockResolvedValueOnce({ id: 'perm-member-org-read' })
        .mockResolvedValueOnce({ id: 'perm-member-chat-read' })
        .mockResolvedValueOnce({ id: 'perm-member-chat-create' })
        .mockResolvedValueOnce({ id: 'perm-member-chat-stream' })
        .mockResolvedValueOnce({ id: 'perm-member-project-read' })
        // rbac_020 — member gains airweave:read only.
        .mockResolvedValueOnce({ id: 'perm-member-airweave-read' })
        // rbac_021 — member gains sql-connection:read only per ADR-012.
        .mockResolvedValueOnce({ id: 'perm-member-sql-connection-read' })
        // rbac_022 — member gains vector-db:read only.
        .mockResolvedValueOnce({ id: 'perm-member-vector-db-read' })
        // rbac_025 — member gains embed-site:read only.
        .mockResolvedValueOnce({ id: 'perm-member-embed-site-read' });

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
          'chat',
          'read',
          'chat',
          'create',
          'chat',
          'stream',
          'chat',
          'delete',
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
          'project',
          'read',
          'project',
          'update',
          'project',
          'manage-sources',
          'dashboard',
          'view',
          // rbac_020 — manager airweave permissions (no 'delete', per ADR-011).
          'airweave',
          'create',
          'airweave',
          'read',
          'airweave',
          'update',
          'airweave',
          'manage-sources',
          // rbac_021 — manager sql-connection full CRUD per ADR-012.
          'sql-connection',
          'read',
          'sql-connection',
          'create',
          'sql-connection',
          'update',
          'sql-connection',
          'delete',
          // rbac_022 — manager vector-db read/create/update (no delete).
          // rbac_024 — manager vector-db:upload.
          'vector-db',
          'read',
          'vector-db',
          'create',
          'vector-db',
          'update',
          'vector-db',
          'upload',
          // rbac_025 — manager embed-site read/create/update (no delete).
          'embed-site',
          'read',
          'embed-site',
          'create',
          'embed-site',
          'update',
        ],
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM role_permissions'),
        [
          'member-role-1',
          'organization',
          'read',
          'chat',
          'read',
          'chat',
          'create',
          'chat',
          'stream',
          'project',
          'read',
          // rbac_020 — member airweave (read only).
          'airweave',
          'read',
          // rbac_021 — member sql-connection (read only) per ADR-012.
          'sql-connection',
          'read',
          // rbac_022 — member vector-db (read only).
          'vector-db',
          'read',
          // rbac_025 — member embed-site (read only).
          'embed-site',
          'read',
        ],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Organization default role permissions normalized',
        ),
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
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      // queryOne returns: admin role, then manager role (14 perm lookups), then member role (4 perm lookups)
      // seedDefaultData manager has 14 permissions
      dbService.queryOne
        .mockResolvedValueOnce({ id: 'admin-id' }) // admin role lookup
        .mockResolvedValueOnce({ id: 'manager-id' }) // manager role lookup
        .mockResolvedValueOnce({ id: 'perm-1' }) // manager perm lookup 1
        .mockResolvedValueOnce({ id: 'perm-2' }) // manager perm lookup 2
        .mockResolvedValueOnce({ id: 'perm-3' }) // manager perm lookup 3
        .mockResolvedValueOnce({ id: 'perm-4' }) // manager perm lookup 4
        .mockResolvedValueOnce({ id: 'perm-5' }) // manager perm lookup 5
        .mockResolvedValueOnce({ id: 'perm-6' }) // manager perm lookup 6
        .mockResolvedValueOnce({ id: 'perm-7' }) // manager perm lookup 7
        .mockResolvedValueOnce({ id: 'perm-8' }) // manager perm lookup 8
        .mockResolvedValueOnce({ id: 'perm-9' }) // manager perm lookup 9
        .mockResolvedValueOnce({ id: 'perm-10' }) // manager perm lookup 10
        .mockResolvedValueOnce({ id: 'perm-11' }) // manager perm lookup 11
        .mockResolvedValueOnce({ id: 'perm-12' }) // manager perm lookup 12
        .mockResolvedValueOnce({ id: 'perm-13' }) // manager perm lookup 13
        .mockResolvedValueOnce({ id: 'perm-14' }) // manager perm lookup 14
        .mockResolvedValueOnce({ id: 'member-id' }) // member role lookup
        .mockResolvedValueOnce({ id: 'mperm-1' }) // member perm lookup 1
        .mockResolvedValueOnce({ id: 'mperm-2' }) // member perm lookup 2
        .mockResolvedValueOnce({ id: 'mperm-3' }) // member perm lookup 3
        .mockResolvedValueOnce({ id: 'mperm-4' }); // member perm lookup 4

      // query returns all permissions for admin assignment
      dbService.query.mockResolvedValue([
        { id: 'all-perm-1' },
        { id: 'all-perm-2' },
      ]);

      await service.seedDefaultData();

      // Should have inserted permissions (21) + roles (3) + admin perms (2) + manager perms (10) + member perms (3)
      expect(dbService.query).toHaveBeenCalled();
      expect(dbService.queryOne).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('RBAC default data seeded'),
      );
      consoleSpy.mockRestore();
    });

    it('should skip admin permission assignment when admin role not found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.queryOne
        .mockResolvedValueOnce(null) // admin role not found
        .mockResolvedValueOnce(null) // manager role not found
        .mockResolvedValueOnce(null); // member role not found

      await service.seedDefaultData();

      // Should still seed permissions and roles, just skip assignments
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('RBAC default data seeded'),
      );
      consoleSpy.mockRestore();
    });

    it('should skip manager permission insert when permission lookup returns null', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      // manager has 14 perms in seedDefaultData, all null → no inserts
      dbService.queryOne
        .mockResolvedValueOnce(null) // admin not found
        .mockResolvedValueOnce({ id: 'mgr-id' }) // manager found
        .mockResolvedValueOnce(null) // manager perm 1
        .mockResolvedValueOnce(null) // manager perm 2
        .mockResolvedValueOnce(null) // manager perm 3
        .mockResolvedValueOnce(null) // manager perm 4
        .mockResolvedValueOnce(null) // manager perm 5
        .mockResolvedValueOnce(null) // manager perm 6
        .mockResolvedValueOnce(null) // manager perm 7
        .mockResolvedValueOnce(null) // manager perm 8
        .mockResolvedValueOnce(null) // manager perm 9
        .mockResolvedValueOnce(null) // manager perm 10
        .mockResolvedValueOnce(null) // manager perm 11
        .mockResolvedValueOnce(null) // manager perm 12
        .mockResolvedValueOnce(null) // manager perm 13
        .mockResolvedValueOnce(null) // manager perm 14
        .mockResolvedValueOnce({ id: 'mem-id' }) // member found
        .mockResolvedValueOnce(null) // member perm 1
        .mockResolvedValueOnce(null) // member perm 2
        .mockResolvedValueOnce(null) // member perm 3
        .mockResolvedValueOnce(null); // member perm 4

      await service.seedDefaultData();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('RBAC default data seeded'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('addManagerOrganizationCreatePermission', () => {
    it('should assign org:create permission to manager when both exist', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ id: 'manager-id' }) // manager role
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
        .mockResolvedValueOnce(null) // manager role not found
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
        .mockResolvedValueOnce(null); // org:create permission not found

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
      dbService.query.mockResolvedValueOnce([
        { id: 'perm-1' },
        { id: 'perm-2' },
      ]);

      await service.assignAllPermissionsToAdmin();

      expect(dbService.queryOne).toHaveBeenCalledWith(
        `SELECT id FROM roles WHERE name = 'admin'`,
      );
      expect(dbService.query).toHaveBeenCalledWith(
        `SELECT id FROM permissions`,
      );
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

      expect(dbService.query).not.toHaveBeenCalledWith(
        `SELECT id FROM permissions`,
      );
      expect(dbService.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.anything(),
      );
    });
  });

  describe('backfillRolePermissions', () => {
    it('should assign permissions to admin, manager, and member when all roles and permissions exist', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      // All permissions list returned for admin
      dbService.query.mockResolvedValue([
        { id: 'all-perm-1' },
        { id: 'all-perm-2' },
      ]);

      dbService.queryOne
        .mockResolvedValueOnce({ id: 'admin-id' }) // admin role lookup
        .mockResolvedValueOnce({ id: 'manager-id' }) // manager role lookup
        .mockResolvedValueOnce({ id: 'perm-1' }) // manager perm 1
        .mockResolvedValueOnce({ id: 'perm-2' }) // manager perm 2
        .mockResolvedValueOnce({ id: 'perm-3' }) // manager perm 3
        .mockResolvedValueOnce({ id: 'perm-4' }) // manager perm 4
        .mockResolvedValueOnce({ id: 'perm-5' }) // manager perm 5
        .mockResolvedValueOnce({ id: 'perm-6' }) // manager perm 6
        .mockResolvedValueOnce({ id: 'perm-7' }) // manager perm 7
        .mockResolvedValueOnce({ id: 'perm-8' }) // manager perm 8
        .mockResolvedValueOnce({ id: 'perm-9' }) // manager perm 9
        .mockResolvedValueOnce({ id: 'perm-10' }) // manager perm 10
        .mockResolvedValueOnce({ id: 'member-id' }) // member role lookup
        .mockResolvedValueOnce({ id: 'perm-11' }) // member perm 1
        .mockResolvedValueOnce({ id: 'perm-12' }) // member perm 2
        .mockResolvedValueOnce({ id: 'perm-13' }); // member perm 3

      await service.backfillRolePermissions();

      expect(dbService.queryOne).toHaveBeenCalledWith(
        `SELECT id FROM roles WHERE name = 'admin'`,
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        `SELECT id FROM roles WHERE name = 'manager'`,
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        `SELECT id FROM roles WHERE name = 'member'`,
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['admin-id', 'all-perm-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('role_permissions backfill complete'),
      );
      consoleSpy.mockRestore();
    });

    it('should skip inserts when no roles are found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.queryOne.mockResolvedValue(null);

      await service.backfillRolePermissions();

      expect(dbService.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.anything(),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('role_permissions backfill complete'),
      );
      consoleSpy.mockRestore();
    });

    it('should skip permission inserts when permission lookup returns null for manager', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockResolvedValue([{ id: 'all-perm-1' }]);

      dbService.queryOne
        .mockResolvedValueOnce({ id: 'admin-id' }) // admin role found
        .mockResolvedValueOnce({ id: 'mgr-id' }) // manager role found
        .mockResolvedValue(null); // all permission lookups return null

      await service.backfillRolePermissions();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('role_permissions backfill complete'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('redesignSuperadminAndOrganizationRoles (with roles found)', () => {
    it('assigns permissions to superadmin, org admin, manager, and member when all roles exist', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        if (sql.includes('SELECT id FROM permissions')) return [{ id: 'p-1' }];
        return [];
      });

      // superadminRole, then per org: adminRole, managerRole (sync perms), memberRole (sync perms)
      dbService.queryOne
        .mockResolvedValueOnce({ id: 'superadmin-id' }) // superadmin role
        .mockResolvedValueOnce({ id: 'admin-id' }) // org admin role
        .mockResolvedValueOnce({ id: 'manager-id' }) // org manager role
        // syncRolePermissions for manager (9 perms) — return null for each so no insert
        .mockResolvedValue(null);

      await service.redesignSuperadminAndOrganizationRoles();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['superadmin-id', 'p-1'],
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['admin-id', 'p-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('RBAC superadmin/org role redesign seeded'),
      );
      consoleSpy.mockRestore();
    });

    it('calls syncRolePermissions for member role when member role is found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        if (sql.includes('SELECT id FROM permissions')) return [{ id: 'p-1' }];
        return [];
      });

      // Build all 14 queryOne calls in sequence:
      // 1: superadmin role
      // 2: org-1 admin role
      // 3: org-1 manager role
      // 4-12: syncRolePermissions for manager (9 perm lookups → null)
      // 13: org-1 member role ← LINE 682 TRIGGER
      // 14: syncRolePermissions for member (1 perm lookup → null)
      dbService.queryOne
        .mockResolvedValueOnce({ id: 'superadmin-id' }) // 1: superadmin
        .mockResolvedValueOnce({ id: 'admin-id' }) // 2: org admin
        .mockResolvedValueOnce({ id: 'manager-id' }) // 3: org manager
        .mockResolvedValueOnce(null) // 4: manager perm 1 (org:read)
        .mockResolvedValueOnce(null) // 5: manager perm 2 (org:update)
        .mockResolvedValueOnce(null) // 6: manager perm 3 (org:invite)
        .mockResolvedValueOnce(null) // 7: manager perm 4 (role:read)
        .mockResolvedValueOnce(null) // 8: manager perm 5 (session:read)
        .mockResolvedValueOnce(null) // 9: manager perm 6 (session:revoke)
        .mockResolvedValueOnce(null) // 10: manager perm 7 (user:create)
        .mockResolvedValueOnce(null) // 11: manager perm 8 (user:read)
        .mockResolvedValueOnce(null) // 12: manager perm 9 (user:update)
        .mockResolvedValueOnce({ id: 'member-id' }) // 13: org member role ← line 682
        .mockResolvedValueOnce(null); // 14: member perm 1 (org:read)

      await service.redesignSuperadminAndOrganizationRoles();

      // Verify the member role lookup was executed
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'member'"),
        ['org-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('RBAC superadmin/org role redesign seeded'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('addManageMembersPermission', () => {
    it('assigns manage-members permission to superadmin and org admin roles when both exist', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.queryOne
        .mockResolvedValueOnce({ id: 'superadmin-id' }) // superadmin role
        .mockResolvedValueOnce({ id: 'manage-members-id' }); // manage-members permission

      await service.addManageMembersPermission();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['superadmin-id', 'manage-members-id'],
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.arrayContaining(['manage-members-id']),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('organization:manage-members permission added'),
      );
      consoleSpy.mockRestore();
    });

    it('skips superadmin assignment when superadmin role not found but still assigns org admins', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.queryOne
        .mockResolvedValueOnce(null) // superadmin role not found
        .mockResolvedValueOnce({ id: 'manage-members-id' }); // manage-members permission found

      await service.addManageMembersPermission();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.arrayContaining(['manage-members-id']),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('organization:manage-members permission added'),
      );
      consoleSpy.mockRestore();
    });

    it('skips all permission assignments when manage-members permission not found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.queryOne
        .mockResolvedValueOnce({ id: 'superadmin-id' }) // superadmin role found
        .mockResolvedValueOnce(null); // manage-members permission not found

      await service.addManageMembersPermission();

      expect(dbService.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.anything(),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('organization:manage-members permission added'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('assignAdminFullPermissions', () => {
    it('calls syncRolePermissions for each org admin role found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }, { id: 'org-2' }];
        return [];
      });

      dbService.queryOne
        .mockResolvedValueOnce({ id: 'admin-id-1' }) // admin role for org-1
        .mockResolvedValue(null); // no admin for org-2, and permission lookups null

      await service.assignAdminFullPermissions();

      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'admin'"),
        ['org-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Org admin roles updated with full permission set',
        ),
      );
      consoleSpy.mockRestore();
    });

    it('does nothing when no organizations exist', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockResolvedValueOnce([]);

      await service.assignAdminFullPermissions();

      expect(dbService.queryOne).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Org admin roles updated with full permission set',
        ),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('runTrackedMigrations (migrations rbac_001, rbac_005, rbac_006)', () => {
    it('runs createRbacTables, backfillRolePermissions, and assignAllPermissionsToAdmin when not yet applied', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      // Only rbac_001, rbac_005, and rbac_006 are pending; all others already ran
      dbService.hasMigrationRun
        .mockResolvedValueOnce(false) // rbac_001 NOT run
        .mockResolvedValueOnce(true) // rbac_002 already run
        .mockResolvedValueOnce(true) // rbac_003 already run
        .mockResolvedValueOnce(true) // rbac_004 already run
        .mockResolvedValueOnce(false) // rbac_005 NOT run
        .mockResolvedValueOnce(false) // rbac_006 NOT run
        .mockResolvedValueOnce(true) // rbac_007 already run
        .mockResolvedValueOnce(true) // rbac_008 already run
        .mockResolvedValueOnce(true) // rbac_009 already run
        .mockResolvedValueOnce(true) // rbac_010 already run
        .mockResolvedValueOnce(true) // rbac_011 already run
        .mockResolvedValueOnce(true) // rbac_012 already run
        .mockResolvedValueOnce(true) // rbac_013 already run
        .mockResolvedValueOnce(true) // rbac_014 already run
        .mockResolvedValueOnce(true) // rbac_015 already run
        .mockResolvedValueOnce(true) // rbac_016 already run
        .mockResolvedValueOnce(true) // rbac_017 already run
        .mockResolvedValueOnce(true) // rbac_018 already run
        .mockResolvedValueOnce(true) // rbac_019 already run
        .mockResolvedValueOnce(true) // rbac_020 already run
        .mockResolvedValueOnce(true) // rbac_021 already run
        .mockResolvedValueOnce(true) // rbac_022 already run
        .mockResolvedValueOnce(true) // rbac_023 already run
        .mockResolvedValueOnce(true) // rbac_024 already run
        .mockResolvedValueOnce(true); // rbac_025 already run

      // Needed by backfillRolePermissions and assignAllPermissionsToAdmin
      dbService.queryOne.mockResolvedValue(null);
      dbService.query.mockResolvedValue([]);

      await service.runTrackedMigrations();

      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_001_create_tables',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_005_backfill_role_permissions',
      );
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_006_assign_all_permissions_to_admin',
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('3 new'));
      consoleSpy.mockRestore();
    });
  });

  describe('backfillRolePermissions (member branch)', () => {
    it('assigns permissions to member role when member role and permissions are found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      // admin role (14 perms inserted via query), manager role (14 perm lookups → null), member role found
      dbService.query.mockResolvedValue([{ id: 'all-perm-1' }]);

      dbService.queryOne
        .mockResolvedValueOnce({ id: 'admin-id' }) // admin role found
        .mockResolvedValueOnce({ id: 'manager-id' }) // manager role found
        // 14 manager permission lookups → null (so no inserts for manager)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        // member role found
        .mockResolvedValueOnce({ id: 'member-id' })
        // 4 member permission lookups → found
        .mockResolvedValueOnce({ id: 'mperm-1' })
        .mockResolvedValueOnce({ id: 'mperm-2' })
        .mockResolvedValueOnce({ id: 'mperm-3' })
        .mockResolvedValueOnce({ id: 'mperm-4' });

      await service.backfillRolePermissions();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['member-id', 'mperm-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('member role'),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('role_permissions backfill complete'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('addProjectPermissions', () => {
    it('syncs global admin/manager/member roles and org-scoped roles', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes("IN ('admin', 'manager', 'member')"))
          return [
            { id: 'g-admin', name: 'admin' },
            { id: 'g-manager', name: 'manager' },
            { id: 'g-member', name: 'member' },
          ];
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });

      // Use mockImplementation to differentiate role lookups from permission lookups
      dbService.queryOne.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'admin'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-admin-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'manager'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-manager-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'member'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-member-id' };
          // permission lookups return null (inside syncRolePermissions)
          return null;
        },
      );

      await service.addProjectPermissions();

      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'admin'"),
        ['org-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'manager'"),
        ['org-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'member'"),
        ['org-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('project permissions added'),
      );
      consoleSpy.mockRestore();
    });

    it('skips org-scoped roles when none found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes("IN ('admin', 'manager', 'member')")) return [];
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });

      dbService.queryOne.mockResolvedValue(null);

      await service.addProjectPermissions();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('project permissions added'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('addChatPermissions', () => {
    it('assigns chat permissions to superadmin and syncs org roles', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes("resource = 'chat'"))
          return [{ id: 'chat-p-1' }, { id: 'chat-p-2' }];
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });

      // Use SQL-based implementation to distinguish role lookups from permission lookups
      dbService.queryOne.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          if (sql.includes("name = 'superadmin'"))
            return { id: 'superadmin-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'admin'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-admin-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'manager'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-manager-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'member'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-member-id' };
          return null;
        },
      );

      await service.addChatPermissions();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['superadmin-id', 'chat-p-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'admin'"),
        ['org-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'manager'"),
        ['org-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'member'"),
        ['org-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Chat permissions added'),
      );
      consoleSpy.mockRestore();
    });

    it('skips superadmin chat assignment when superadmin role not found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization')) return [];
        return [];
      });

      dbService.queryOne.mockResolvedValue(null);

      await service.addChatPermissions();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Chat permissions added'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('addUserApprovePermission', () => {
    it('assigns user:approve to superadmin and syncs org admin roles when both exist', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });

      // superadmin and approvePerm are fetched with queryOne, then org admin role
      // syncRolePermissions for org admin calls queryOne many times for each permission
      dbService.queryOne.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          if (sql.includes("name = 'superadmin'"))
            return { id: 'superadmin-id' };
          if (sql.includes("action = 'approve'"))
            return { id: 'approve-perm-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'admin'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-admin-id' };
          return null;
        },
      );

      await service.addUserApprovePermission();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['superadmin-id', 'approve-perm-id'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'admin'"),
        ['org-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('user:approve permission added'),
      );
      consoleSpy.mockRestore();
    });

    it('skips superadmin insert when superadmin or permission not found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization')) return [];
        return [];
      });

      dbService.queryOne
        .mockResolvedValueOnce(null) // superadmin role not found
        .mockResolvedValueOnce({ id: 'approve-perm-id' }); // permission found

      await service.addUserApprovePermission();

      expect(dbService.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.anything(),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('user:approve permission added'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('addDashboardPermission', () => {
    it('assigns dashboard:view to superadmin and syncs org admin and manager roles', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });

      // SQL-based queryOne: superadmin + dashboard perm by SQL pattern, org roles by params
      dbService.queryOne.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          if (sql.includes("name = 'superadmin'"))
            return { id: 'superadmin-id' };
          if (sql.includes("action = 'view'"))
            return { id: 'dashboard-perm-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'admin'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-admin-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'manager'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-manager-id' };
          return null;
        },
      );

      await service.addDashboardPermission();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        ['superadmin-id', 'dashboard-perm-id'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'admin'"),
        ['org-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'manager'"),
        ['org-1'],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('dashboard:view permission added'),
      );
      consoleSpy.mockRestore();
    });

    it('skips superadmin insert when roles or permission not found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });

      dbService.queryOne
        .mockResolvedValueOnce(null) // superadmin role not found
        .mockResolvedValueOnce({ id: 'dashboard-perm-id' }) // permission found
        .mockResolvedValueOnce(null) // org-1 admin role not found
        .mockResolvedValueOnce(null); // org-1 manager role not found

      await service.addDashboardPermission();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('dashboard:view permission added'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('runTrackedMigrations (rbac_018)', () => {
    it('runs addDashboardPermission when rbac_018 is pending', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      // All migrations already run except rbac_018
      dbService.hasMigrationRun
        .mockResolvedValueOnce(true) // rbac_001
        .mockResolvedValueOnce(true) // rbac_002
        .mockResolvedValueOnce(true) // rbac_003
        .mockResolvedValueOnce(true) // rbac_004
        .mockResolvedValueOnce(true) // rbac_005
        .mockResolvedValueOnce(true) // rbac_006
        .mockResolvedValueOnce(true) // rbac_007
        .mockResolvedValueOnce(true) // rbac_008
        .mockResolvedValueOnce(true) // rbac_009
        .mockResolvedValueOnce(true) // rbac_010
        .mockResolvedValueOnce(true) // rbac_011
        .mockResolvedValueOnce(true) // rbac_012
        .mockResolvedValueOnce(true) // rbac_013
        .mockResolvedValueOnce(true) // rbac_014
        .mockResolvedValueOnce(true) // rbac_015
        .mockResolvedValueOnce(true) // rbac_016
        .mockResolvedValueOnce(true) // rbac_017
        .mockResolvedValueOnce(false) // rbac_018 NOT run
        .mockResolvedValueOnce(true) // rbac_019 already run
        .mockResolvedValueOnce(true) // rbac_020 already run
        .mockResolvedValueOnce(true) // rbac_021 already run
        .mockResolvedValueOnce(true) // rbac_022 already run
        .mockResolvedValueOnce(true) // rbac_023 already run
        .mockResolvedValueOnce(true) // rbac_024 already run
        .mockResolvedValueOnce(true); // rbac_025 already run

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization')) return [];
        return [];
      });
      dbService.queryOne.mockResolvedValue(null);

      await service.runTrackedMigrations();

      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_018_add_dashboard_permission',
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 new'));
      consoleSpy.mockRestore();
    });
  });

  describe('addAirweavePermissions', () => {
    // Mirrors addProjectPermissions test pattern (rbac_014). Verifies:
    //  - The 5 airweave:* permissions are inserted into the permissions table.
    //  - Superadmin is granted them (matches established repo pattern of
    //    redundant grants even though PermissionsGuard bypasses superadmin
    //    by code — see ADR-011 "Decision" and the architectural note in
    //    addAirweavePermissions().)
    //  - Global + org-scoped admin/manager/member roles are re-synced.
    //
    // Note on per-role asymmetry: manager has 'manage-sources' but not
    // 'delete'. This is encoded in the ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS
    // constant in rbac.migration.ts (visible at PR-diff time) and is the
    // load-bearing intent per ADR-011 § "Consequences > Negative". Testing
    // the constant content here would require exposing private module state;
    // PR review + ADR are the durable enforcement surface.
    it('inserts the 5 airweave permissions and syncs all roles', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes("IN ('admin', 'manager', 'member')"))
          return [
            { id: 'g-admin', name: 'admin' },
            { id: 'g-manager', name: 'manager' },
            { id: 'g-member', name: 'member' },
          ];
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });

      dbService.queryOne.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          if (sql.includes("name = 'superadmin'"))
            return { id: 'superadmin-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'admin'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-admin-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'manager'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-manager-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'member'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-member-id' };
          return null;
        },
      );

      await service.addAirweavePermissions();

      // 5 airweave:* permissions inserted
      for (const action of [
        'create',
        'read',
        'update',
        'delete',
        'manage-sources',
      ]) {
        expect(dbService.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO permissions'),
          expect.arrayContaining(['airweave', action]),
        );
      }

      // Superadmin grant (redundant per ADR-011 — matches repo pattern)
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("p.resource = 'airweave'"),
        ['superadmin-id'],
      );

      // Org-scoped role syncs
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'admin'"),
        ['org-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'manager'"),
        ['org-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'member'"),
        ['org-1'],
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('airweave permissions added'),
      );
      consoleSpy.mockRestore();
    });

    it('skips org-scoped roles when none found', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes("IN ('admin', 'manager', 'member')")) return [];
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });

      dbService.queryOne.mockResolvedValue(null);

      await service.addAirweavePermissions();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('airweave permissions added'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('addSqlConnectionPermissions (rbac_021)', () => {
    // ADR-012: SQL connection permission family.
    //
    // Per the addAirweavePermissions precedent (rbac_020), the migration is
    // NOT wrapped in db.transaction — the internal syncRolePermissions helper
    // already does its own DELETE-then-INSERT against this.db, and a wrapper
    // would create a false-atomicity claim. The migration converges on
    // re-run via hasMigrationRun + ON CONFLICT DO NOTHING semantics. See the
    // function-level docstring for the full recovery-semantics rationale.

    function setupSqlConnectionMigrationMocks() {
      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes("IN ('admin', 'manager', 'member')"))
          return [
            { id: 'g-admin', name: 'admin' },
            { id: 'g-manager', name: 'manager' },
            { id: 'g-member', name: 'member' },
          ];
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });

      dbService.queryOne.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          if (sql.includes("name = 'superadmin'"))
            return { id: 'superadmin-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'admin'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-admin-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'manager'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-manager-id' };
          if (
            sql.includes('FROM roles') &&
            sql.includes("name = 'member'") &&
            params?.[0] === 'org-1'
          )
            return { id: 'org-member-id' };
          return null;
        },
      );
    }

    it('does NOT wrap in db.transaction (false-atomicity avoidance per addAirweavePermissions precedent)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      setupSqlConnectionMigrationMocks();
      await service.addSqlConnectionPermissions();

      expect(dbService.transaction).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('inserts the 4 sql-connection permissions into the catalog', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      setupSqlConnectionMigrationMocks();
      await service.addSqlConnectionPermissions();

      for (const action of ['read', 'create', 'update', 'delete']) {
        expect(dbService.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO permissions'),
          expect.arrayContaining(['sql-connection', action]),
        );
      }
      consoleSpy.mockRestore();
    });

    it('grants all sql-connection permissions to superadmin (matches repo pattern)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      setupSqlConnectionMigrationMocks();
      await service.addSqlConnectionPermissions();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("p.resource = 'sql-connection'"),
        ['superadmin-id'],
      );
      consoleSpy.mockRestore();
    });

    it('syncs global + org-scoped admin/manager/member roles from updated constants', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      setupSqlConnectionMigrationMocks();
      await service.addSqlConnectionPermissions();

      // Org-scoped role enumeration (the syncs themselves go through
      // syncRolePermissions which does its own DB queries — covered by the
      // existing syncRolePermissions test coverage).
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'admin'"),
        ['org-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'manager'"),
        ['org-1'],
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'member'"),
        ['org-1'],
      );
      consoleSpy.mockRestore();
    });

    it('additively grants sql-connection:create|update|delete to roles holding organization:update (custom-role inheritance per ADR-012 Alt C)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      setupSqlConnectionMigrationMocks();
      await service.addSqlConnectionPermissions();

      const inheritUpdateCall = dbService.query.mock.calls.find(
        (call: unknown[]) => {
          const sql = call[0];
          return (
            typeof sql === 'string' &&
            sql.includes("p_old.resource = 'organization'") &&
            sql.includes("p_old.action = 'update'") &&
            sql.includes("p_new.resource = 'sql-connection'") &&
            sql.includes("p_new.action IN ('create', 'update', 'delete')")
          );
        },
      );
      expect(inheritUpdateCall).toBeDefined();
      expect(inheritUpdateCall?.[0]).toContain('ON CONFLICT DO NOTHING');
      consoleSpy.mockRestore();
    });

    it('additively grants sql-connection:read to roles holding organization:read (custom-role inheritance per ADR-012 Alt C)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      setupSqlConnectionMigrationMocks();
      await service.addSqlConnectionPermissions();

      const inheritReadCall = dbService.query.mock.calls.find(
        (call: unknown[]) => {
          const sql = call[0];
          return (
            typeof sql === 'string' &&
            sql.includes("p_old.resource = 'organization'") &&
            sql.includes("p_old.action = 'read'") &&
            sql.includes("p_new.resource = 'sql-connection'") &&
            sql.includes("p_new.action = 'read'")
          );
        },
      );
      expect(inheritReadCall).toBeDefined();
      expect(inheritReadCall?.[0]).toContain('ON CONFLICT DO NOTHING');
      consoleSpy.mockRestore();
    });

    it('runs cleanly when no global default roles AND no organizations exist (empty-environment path)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes("IN ('admin', 'manager', 'member')")) return [];
        if (sql.includes('SELECT id FROM organization')) return [];
        return [];
      });
      dbService.queryOne.mockResolvedValue(null);

      await service.addSqlConnectionPermissions();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('sql-connection permissions added'),
      );
      consoleSpy.mockRestore();
    });

    it('is idempotent on intentional re-run (call twice → no duplicate writes, same SQL shape)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      setupSqlConnectionMigrationMocks();
      await service.addSqlConnectionPermissions();
      const queryCallsAfterFirst = dbService.query.mock.calls.length;
      const queryOneCallsAfterFirst = dbService.queryOne.mock.calls.length;

      await service.addSqlConnectionPermissions();
      const queryCallsAfterSecond = dbService.query.mock.calls.length;
      const queryOneCallsAfterSecond = dbService.queryOne.mock.calls.length;

      // Second invocation issues the SAME pattern of calls as the first.
      // The actual DB-level idempotency is provided by ON CONFLICT DO NOTHING
      // on every INSERT (catalog, superadmin grant, additive custom-role
      // passes) and by syncRolePermissions converging to the constants
      // snapshot. Real-DB row-count idempotency is covered by the
      // integration spec — this assertion proves the migration is safe to
      // re-invoke without re-checking the migration tracker.
      expect(queryCallsAfterSecond - queryCallsAfterFirst).toBe(
        queryCallsAfterFirst,
      );
      expect(queryOneCallsAfterSecond - queryOneCallsAfterFirst).toBe(
        queryOneCallsAfterFirst,
      );
      consoleSpy.mockRestore();
    });

    it('is registered as rbac_021 in the migrations array', async () => {
      // Verify the migration is in the tracked migrations list with the
      // expected name. Indirect check via runTrackedMigrations dispatch.
      dbService.hasMigrationRun.mockImplementation(async (name: string) => {
        // Only let rbac_021 run; skip all others.
        return name !== 'rbac_021_add_sql_connection_permissions';
      });

      // Stub the migration method to detect dispatch without re-executing.
      const sqlConnSpy = jest
        .spyOn(service, 'addSqlConnectionPermissions')
        .mockResolvedValue();
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      await service.runTrackedMigrations();

      expect(sqlConnSpy).toHaveBeenCalledTimes(1);
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_021_add_sql_connection_permissions',
      );
      sqlConnSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('revokeManagerVectorDbDelete (rbac_023)', () => {
    // Policy change: manager must not remove vector-db elements. rbac_022 had
    // granted manager full vector-db CRUD (incl. delete); this step re-syncs
    // manager roles to the updated constant, dropping the delete grant.

    function setupRevokeMocks() {
      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });
      dbService.queryOne.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          if (
            sql.includes('organization_id IS NULL') &&
            sql.includes("name = 'manager'")
          )
            return { id: 'g-manager' };
          if (sql.includes("name = 'manager'") && params?.[0] === 'org-1')
            return { id: 'org-manager' };
          if (sql.includes('FROM permissions')) return { id: 'perm-x' };
          return null;
        },
      );
    }

    function deleteAllowlistPairs(): Array<[string, string]> {
      const deleteCall = dbService.query.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('DELETE FROM role_permissions'),
      );
      expect(deleteCall).toBeDefined();
      const params = deleteCall![1] as string[];
      // params[0] is the role id; the remainder are (resource, action) pairs.
      const pairs: Array<[string, string]> = [];
      for (let i = 1; i < params.length; i += 2) {
        pairs.push([params[i], params[i + 1]]);
      }
      return pairs;
    }

    it('re-syncs manager to an allowlist that keeps vector-db read/create/update but NOT delete', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      setupRevokeMocks();

      await service.revokeManagerVectorDbDelete();

      const pairs = deleteAllowlistPairs();
      expect(pairs).toContainEqual(['vector-db', 'read']);
      expect(pairs).toContainEqual(['vector-db', 'create']);
      expect(pairs).toContainEqual(['vector-db', 'update']);
      // The whole point of the migration: delete is no longer in the allowlist,
      // so syncRolePermissions' DELETE removes any existing grant.
      expect(pairs).not.toContainEqual(['vector-db', 'delete']);
      consoleSpy.mockRestore();
    });

    it('re-syncs both the global manager role and each org-scoped manager role', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      setupRevokeMocks();

      await service.revokeManagerVectorDbDelete();

      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('organization_id IS NULL'),
      );
      expect(dbService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("name = 'manager'"),
        ['org-1'],
      );
      consoleSpy.mockRestore();
    });

    it('does NOT touch admin or member roles (manager-only revoke)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      setupRevokeMocks();

      await service.revokeManagerVectorDbDelete();

      const touchedAdmin = dbService.queryOne.mock.calls.some(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes("name = 'admin'"),
      );
      const touchedMember = dbService.queryOne.mock.calls.some(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes("name = 'member'"),
      );
      expect(touchedAdmin).toBe(false);
      expect(touchedMember).toBe(false);
      consoleSpy.mockRestore();
    });

    it('does NOT wrap in db.transaction (false-atomicity avoidance, matches precedent)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      setupRevokeMocks();

      await service.revokeManagerVectorDbDelete();

      expect(dbService.transaction).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('runs cleanly when no global manager role and no organizations exist', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM organization')) return [];
        return [];
      });
      dbService.queryOne.mockResolvedValue(null);

      await service.revokeManagerVectorDbDelete();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('vector-db:delete revoked from manager role'),
      );
      consoleSpy.mockRestore();
    });

    it('is registered as rbac_023 in the migrations array', async () => {
      dbService.hasMigrationRun.mockImplementation(async (name: string) => {
        // Only let rbac_023 run; skip all others.
        return name !== 'rbac_023_revoke_manager_vector_db_delete';
      });

      const revokeSpy = jest
        .spyOn(service, 'revokeManagerVectorDbDelete')
        .mockResolvedValue();
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      await service.runTrackedMigrations();

      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_023_revoke_manager_vector_db_delete',
      );
      revokeSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('addVectorDbUploadPermission (rbac_024)', () => {
    // rbac_022 omitted vector-db:upload from the catalog, so admin + manager
    // upload was broken at the DB-backed guard. This step registers it and
    // grants it to admin + manager (member stays read-only).

    function setupUploadMocks() {
      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes("IN ('admin', 'manager', 'member')"))
          return [
            { id: 'g-admin', name: 'admin' },
            { id: 'g-manager', name: 'manager' },
            { id: 'g-member', name: 'member' },
          ];
        if (sql.includes('SELECT id FROM organization'))
          return [{ id: 'org-1' }];
        return [];
      });
      dbService.queryOne.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          if (sql.includes("name = 'superadmin'"))
            return { id: 'superadmin-id' };
          if (sql.includes("name = 'admin'") && params?.[0] === 'org-1')
            return { id: 'org-admin' };
          if (sql.includes("name = 'manager'") && params?.[0] === 'org-1')
            return { id: 'org-manager' };
          if (sql.includes("name = 'member'") && params?.[0] === 'org-1')
            return { id: 'org-member' };
          if (sql.includes('FROM permissions')) return { id: 'perm-x' };
          return null;
        },
      );
    }

    function deletePairsForRole(
      roleId: string,
    ): Array<[string, string]> | undefined {
      const call = dbService.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('DELETE FROM role_permissions') &&
          (c[1] as unknown[] | undefined)?.[0] === roleId,
      );
      if (!call) return undefined;
      const params = call[1] as string[];
      const pairs: Array<[string, string]> = [];
      for (let i = 1; i < params.length; i += 2) {
        pairs.push([params[i], params[i + 1]]);
      }
      return pairs;
    }

    it('inserts vector-db:upload into the catalog', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      setupUploadMocks();

      await service.addVectorDbUploadPermission();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO permissions'),
        expect.arrayContaining(['vector-db', 'upload']),
      );
      consoleSpy.mockRestore();
    });

    it('grants vector-db:upload to superadmin', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      setupUploadMocks();

      await service.addVectorDbUploadPermission();

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining("p.action = 'upload'"),
        ['superadmin-id'],
      );
      consoleSpy.mockRestore();
    });

    it('re-syncs admin + manager to include vector-db:upload but leaves member read-only', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      setupUploadMocks();

      await service.addVectorDbUploadPermission();

      expect(deletePairsForRole('g-admin')).toContainEqual([
        'vector-db',
        'upload',
      ]);
      expect(deletePairsForRole('g-manager')).toContainEqual([
        'vector-db',
        'upload',
      ]);
      // Member is read-only — upload must NOT be in its allowlist.
      expect(deletePairsForRole('g-member')).not.toContainEqual([
        'vector-db',
        'upload',
      ]);
      consoleSpy.mockRestore();
    });

    it('additively grants vector-db:upload to roles holding organization:update', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      setupUploadMocks();

      await service.addVectorDbUploadPermission();

      const inheritCall = dbService.query.mock.calls.find((c: unknown[]) => {
        const sql = c[0];
        return (
          typeof sql === 'string' &&
          sql.includes("p_old.action = 'update'") &&
          sql.includes("p_new.resource = 'vector-db'") &&
          sql.includes("p_new.action = 'upload'")
        );
      });
      expect(inheritCall).toBeDefined();
      expect(inheritCall?.[0]).toContain('ON CONFLICT DO NOTHING');
      consoleSpy.mockRestore();
    });

    it('does NOT wrap in db.transaction (false-atomicity avoidance)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      setupUploadMocks();

      await service.addVectorDbUploadPermission();

      expect(dbService.transaction).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('runs cleanly when no default roles and no organizations exist', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      dbService.query.mockImplementation(async (sql: string) => {
        if (sql.includes("IN ('admin', 'manager', 'member')")) return [];
        if (sql.includes('SELECT id FROM organization')) return [];
        return [];
      });
      dbService.queryOne.mockResolvedValue(null);

      await service.addVectorDbUploadPermission();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('vector-db:upload permission added'),
      );
      consoleSpy.mockRestore();
    });

    it('is registered as rbac_024 in the migrations array', async () => {
      dbService.hasMigrationRun.mockImplementation(async (name: string) => {
        // Only let rbac_024 run; skip all others.
        return name !== 'rbac_024_add_vector_db_upload_permission';
      });

      const uploadSpy = jest
        .spyOn(service, 'addVectorDbUploadPermission')
        .mockResolvedValue();
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      await service.runTrackedMigrations();

      expect(uploadSpy).toHaveBeenCalledTimes(1);
      expect(dbService.recordMigration).toHaveBeenCalledWith(
        'rbac_024_add_vector_db_upload_permission',
      );
      uploadSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});
