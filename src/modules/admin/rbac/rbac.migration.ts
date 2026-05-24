import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../../shared/infrastructure/database/database.module';

const ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS = [
  { resource: 'organization', action: 'read' },
  { resource: 'organization', action: 'update' },
  { resource: 'organization', action: 'delete' },
  { resource: 'organization', action: 'invite' },
  { resource: 'chat', action: 'read' },
  { resource: 'chat', action: 'create' },
  { resource: 'chat', action: 'stream' },
  { resource: 'chat', action: 'delete' },
  { resource: 'role', action: 'read' },
  { resource: 'role', action: 'create' },
  { resource: 'role', action: 'update' },
  { resource: 'role', action: 'delete' },
  { resource: 'role', action: 'assign' },
  { resource: 'session', action: 'read' },
  { resource: 'session', action: 'revoke' },
  { resource: 'user', action: 'create' },
  { resource: 'user', action: 'read' },
  { resource: 'user', action: 'update' },
  { resource: 'user', action: 'delete' },
  { resource: 'user', action: 'ban' },
  { resource: 'user', action: 'impersonate' },
  { resource: 'user', action: 'set-role' },
  { resource: 'user', action: 'set-password' },
  { resource: 'user', action: 'approve' },
  { resource: 'project', action: 'create' },
  { resource: 'project', action: 'read' },
  { resource: 'project', action: 'update' },
  { resource: 'project', action: 'delete' },
  { resource: 'project', action: 'manage-sources' },
  { resource: 'dashboard', action: 'view' },
  { resource: 'airweave', action: 'create' },
  { resource: 'airweave', action: 'read' },
  { resource: 'airweave', action: 'update' },
  { resource: 'airweave', action: 'delete' },
  { resource: 'airweave', action: 'manage-sources' },
] as const;

const ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS = [
  { resource: 'organization', action: 'read' },
  { resource: 'organization', action: 'update' },
  { resource: 'organization', action: 'invite' },
  { resource: 'chat', action: 'read' },
  { resource: 'chat', action: 'create' },
  { resource: 'chat', action: 'stream' },
  { resource: 'chat', action: 'delete' },
  { resource: 'role', action: 'read' },
  { resource: 'session', action: 'read' },
  { resource: 'session', action: 'revoke' },
  { resource: 'user', action: 'create' },
  { resource: 'user', action: 'read' },
  { resource: 'user', action: 'update' },
  { resource: 'project', action: 'read' },
  { resource: 'project', action: 'update' },
  { resource: 'project', action: 'manage-sources' },
  { resource: 'dashboard', action: 'view' },
  // Manager: airweave CRU + manage-sources but no delete (intentional
  // asymmetry per ADR-011 — collection disposal is admin-only).
  { resource: 'airweave', action: 'create' },
  { resource: 'airweave', action: 'read' },
  { resource: 'airweave', action: 'update' },
  { resource: 'airweave', action: 'manage-sources' },
] as const;

const ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS = [
  { resource: 'organization', action: 'read' },
  { resource: 'chat', action: 'read' },
  { resource: 'chat', action: 'create' },
  { resource: 'chat', action: 'stream' },
  { resource: 'project', action: 'read' },
  { resource: 'airweave', action: 'read' },
] as const;

/**
 * RBAC Migration service - creates tables and seeds default data
 */
@Injectable()
export class RbacMigrationService implements OnModuleInit {
  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    await this.runTrackedMigrations();
  }

  /**
   * Run RBAC migrations with tracking (only runs new migrations)
   */
  async runTrackedMigrations(): Promise<void> {
    const migrations = [
      { name: 'rbac_001_create_tables', up: () => this.createRbacTables() },
      {
        name: 'rbac_002_migrate_old_role_names',
        up: () => this.migrateOldRoleNames(),
      },
      { name: 'rbac_003_seed_default_data', up: () => this.seedDefaultData() },
      {
        name: 'rbac_004_add_manager_org_create_permission',
        up: () => this.addManagerOrganizationCreatePermission(),
      },
      {
        name: 'rbac_005_backfill_role_permissions',
        up: () => this.backfillRolePermissions(),
      },
      {
        name: 'rbac_006_assign_all_permissions_to_admin',
        up: () => this.assignAllPermissionsToAdmin(),
      },
      {
        name: 'rbac_007_add_role_organization_scope',
        up: () => this.addRoleOrganizationScope(),
      },
      {
        name: 'rbac_008_redesign_superadmin_org_roles',
        up: () => this.redesignSuperadminAndOrganizationRoles(),
      },
      {
        name: 'rbac_009_normalize_org_default_role_permissions',
        up: () => this.normalizeOrganizationDefaultRolePermissions(),
      },
      {
        name: 'rbac_010_remove_superadmin_org_memberships',
        up: () => this.removeSuperadminOrganizationMemberships(),
      },
      {
        name: 'rbac_011_add_manage_members_permission',
        up: () => this.addManageMembersPermission(),
      },
      {
        name: 'rbac_012_assign_admin_full_permissions',
        up: () => this.assignAdminFullPermissions(),
      },
      {
        name: 'rbac_013_seed_default_organization',
        up: () => this.seedDefaultOrganization(),
      },
      {
        name: 'rbac_014_add_project_permissions',
        up: () => this.addProjectPermissions(),
      },
      {
        name: 'rbac_015_add_chat_permissions',
        up: () => this.addChatPermissions(),
      },
      {
        name: 'rbac_016_add_user_approve_permission',
        up: () => this.addUserApprovePermission(),
      },
      {
        name: 'rbac_017_remove_phantom_permissions',
        up: () => this.removePhantomPermissions(),
      },
      {
        name: 'rbac_018_add_dashboard_permission',
        up: () => this.addDashboardPermission(),
      },
      {
        name: 'rbac_019_restore_project_permissions',
        up: () => this.restoreProjectPermissions(),
      },
      {
        name: 'rbac_020_add_airweave_permissions',
        up: () => this.addAirweavePermissions(),
      },
    ];

    let pendingCount = 0;
    for (const migration of migrations) {
      const hasRun = await this.db.hasMigrationRun(migration.name);
      if (!hasRun) {
        await migration.up();
        await this.db.recordMigration(migration.name);
        pendingCount++;
        console.log(`  ↳ Migration ${migration.name} applied`);
      }
    }

    if (pendingCount > 0) {
      console.log(`✅ RBAC migrations completed (${pendingCount} new)`);
    } else {
      console.log('✅ RBAC migrations up to date');
    }
  }

  /**
   * Create RBAC tables
   */
  async createRbacTables(): Promise<void> {
    // Create roles table
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(50) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        description TEXT,
        color VARCHAR(20) DEFAULT 'gray',
        is_default BOOLEAN DEFAULT false,
        organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS roles_system_name_unique_idx
      ON roles (name)
      WHERE organization_id IS NULL
    `);
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS roles_org_name_unique_idx
      ON roles (organization_id, name)
      WHERE organization_id IS NOT NULL
    `);

    // Create permissions table
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        description TEXT,
        UNIQUE(resource, action)
      )
    `);

    // Create role_permissions junction table
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
        permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      )
    `);
  }

  /**
   * Migrate old role names to unified role model
   */
  async migrateOldRoleNames(): Promise<void> {
    // Rename 'moderator' -> 'manager' if it exists
    await this.db.query(`
      UPDATE roles SET name = 'manager', display_name = 'Manager', 
        description = 'Organization manager with full access within their assigned organization',
        updated_at = NOW()
      WHERE name = 'moderator' AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'manager')
    `);

    // Rename 'user' -> 'member' if it exists (and 'member' doesn't exist)
    await this.db.query(`
      UPDATE roles SET name = 'member', display_name = 'Member',
        description = 'Organization member with basic access within their assigned organization',
        updated_at = NOW()
      WHERE name = 'user' AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'member')
    `);

    // Update user table: rename 'moderator' role to 'manager'
    await this.db.query(
      `UPDATE "user" SET role = 'manager' WHERE role = 'moderator'`,
    );

    // Update user table: rename 'user' role to 'member'
    await this.db.query(
      `UPDATE "user" SET role = 'member' WHERE role = 'user'`,
    );

    // Update organization member table: rename 'moderator' role to 'manager'
    await this.db.query(
      `UPDATE member SET role = 'manager' WHERE role = 'moderator'`,
    );

    // Update organization member table: rename 'user' role to 'member'
    await this.db.query(
      `UPDATE member SET role = 'member' WHERE role = 'user'`,
    );

    // Ensure fresh Better Auth signups default to the canonical built-in member role
    await this.db.query(
      `ALTER TABLE "user" ALTER COLUMN role SET DEFAULT 'member'`,
    );
  }

  /**
   * Seed default roles and permissions
   */
  async seedDefaultData(): Promise<void> {
    // Seed permissions
    const permissions = [
      // User permissions
      { resource: 'user', action: 'create', description: 'Create new users' },
      { resource: 'user', action: 'read', description: 'View user details' },
      {
        resource: 'user',
        action: 'update',
        description: 'Update user information',
      },
      { resource: 'user', action: 'delete', description: 'Delete users' },
      { resource: 'user', action: 'ban', description: 'Ban/unban users' },
      {
        resource: 'user',
        action: 'impersonate',
        description: 'Impersonate users',
      },
      {
        resource: 'user',
        action: 'set-role',
        description: 'Change user roles',
      },
      {
        resource: 'user',
        action: 'set-password',
        description: 'Reset user passwords',
      },
      // Session permissions
      { resource: 'session', action: 'read', description: 'View sessions' },
      { resource: 'session', action: 'revoke', description: 'Revoke sessions' },
      // Organization permissions
      {
        resource: 'organization',
        action: 'create',
        description: 'Create organizations',
      },
      {
        resource: 'organization',
        action: 'read',
        description: 'View organizations',
      },
      {
        resource: 'organization',
        action: 'update',
        description: 'Update organizations',
      },
      {
        resource: 'organization',
        action: 'delete',
        description: 'Delete organizations',
      },
      {
        resource: 'organization',
        action: 'invite',
        description: 'Invite members',
      },
      { resource: 'project', action: 'create', description: 'Create projects' },
      { resource: 'project', action: 'read', description: 'View projects' },
      { resource: 'project', action: 'update', description: 'Update projects' },
      { resource: 'project', action: 'delete', description: 'Delete projects' },
      // Role permissions
      { resource: 'role', action: 'create', description: 'Create roles' },
      { resource: 'role', action: 'read', description: 'View roles' },
      { resource: 'role', action: 'update', description: 'Update roles' },
      { resource: 'role', action: 'delete', description: 'Delete roles' },
      {
        resource: 'role',
        action: 'assign',
        description: 'Assign permissions to roles',
      },
    ];

    for (const perm of permissions) {
      await this.db.query(
        `INSERT INTO permissions (resource, action, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (resource, action) DO NOTHING`,
        [perm.resource, perm.action, perm.description],
      );
    }

    // Seed default roles - Unified role model:
    // - Admin: Global platform administrator (can manage all orgs, users, settings)
    // - Manager: Organization manager (can manage everything within their org)
    // - Member: Organization member (regular user within an org)
    const roles = [
      {
        name: 'admin',
        displayName: 'Admin',
        description:
          'Global platform administrator with full access to all organizations and settings',
        color: 'red',
        isDefault: true,
      },
      {
        name: 'manager',
        displayName: 'Manager',
        description:
          'Organization manager with full access within their assigned organization',
        color: 'blue',
        isDefault: true,
      },
      {
        name: 'member',
        displayName: 'Member',
        description:
          'Organization member with basic access within their assigned organization',
        color: 'gray',
        isDefault: true,
      },
    ];

    for (const role of roles) {
      await this.db.query(
        `INSERT INTO roles (name, display_name, description, color, is_default, organization_id)
         VALUES ($1, $2, $3, $4, $5, NULL)
         ON CONFLICT (name) WHERE organization_id IS NULL DO UPDATE SET
           display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           color = EXCLUDED.color,
           is_default = EXCLUDED.is_default,
           updated_at = NOW()`,
        [
          role.name,
          role.displayName,
          role.description,
          role.color,
          role.isDefault,
        ],
      );
    }

    // Assign permissions to admin role (all permissions)
    const adminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'admin'`,
    );
    if (adminRole) {
      const allPermissions = await this.db.query<{ id: string }>(
        `SELECT id FROM permissions`,
      );
      for (const perm of allPermissions) {
        await this.db.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [adminRole.id, perm.id],
        );
      }
    }

    // Assign permissions to manager role (org-level management)
    const managerRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'manager'`,
    );
    if (managerRole) {
      const managerPermissions = [
        // User management within org
        { resource: 'user', action: 'read' },
        { resource: 'user', action: 'update' },
        { resource: 'user', action: 'ban' },
        // Session management within org
        { resource: 'session', action: 'read' },
        { resource: 'session', action: 'revoke' },
        // Organization management (their own org)
        { resource: 'organization', action: 'create' },
        { resource: 'organization', action: 'read' },
        { resource: 'organization', action: 'update' },
        { resource: 'organization', action: 'invite' },
        { resource: 'project', action: 'create' },
        { resource: 'project', action: 'read' },
        { resource: 'project', action: 'update' },
        { resource: 'project', action: 'delete' },
        // Role viewing
        { resource: 'role', action: 'read' },
      ];
      for (const perm of managerPermissions) {
        const permission = await this.db.queryOne<{ id: string }>(
          `SELECT id FROM permissions WHERE resource = $1 AND action = $2`,
          [perm.resource, perm.action],
        );
        if (permission) {
          await this.db.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [managerRole.id, permission.id],
          );
        }
      }
    }

    // Assign permissions to member role (basic org access)
    const memberRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'member'`,
    );
    if (memberRole) {
      const memberPermissions = [
        { resource: 'user', action: 'read' },
        { resource: 'organization', action: 'read' },
        { resource: 'project', action: 'read' },
        { resource: 'role', action: 'read' },
      ];
      for (const perm of memberPermissions) {
        const permission = await this.db.queryOne<{ id: string }>(
          `SELECT id FROM permissions WHERE resource = $1 AND action = $2`,
          [perm.resource, perm.action],
        );
        if (permission) {
          await this.db.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [memberRole.id, permission.id],
          );
        }
      }
    }

    console.log('✅ RBAC default data seeded');
  }

  /**
   * Backfill role_permissions for all roles.
   * rbac_003 seeded permissions and roles but role_permissions inserts failed
   * silently on first run, leaving the junction table empty.
   */
  async backfillRolePermissions(): Promise<void> {
    // Admin: all permissions
    const adminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'admin'`,
    );
    if (adminRole) {
      const allPermissions = await this.db.query<{ id: string }>(
        `SELECT id FROM permissions`,
      );
      for (const perm of allPermissions) {
        await this.db.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [adminRole.id, perm.id],
        );
      }
      console.log(
        `  ↳ Assigned ${allPermissions.length} permissions to admin role`,
      );
    }

    // Manager: org-level management permissions
    const managerRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'manager'`,
    );
    if (managerRole) {
      const managerPermissions = [
        { resource: 'user', action: 'read' },
        { resource: 'user', action: 'update' },
        { resource: 'user', action: 'ban' },
        { resource: 'session', action: 'read' },
        { resource: 'session', action: 'revoke' },
        { resource: 'organization', action: 'create' },
        { resource: 'organization', action: 'read' },
        { resource: 'organization', action: 'update' },
        { resource: 'organization', action: 'invite' },
        { resource: 'project', action: 'create' },
        { resource: 'project', action: 'read' },
        { resource: 'project', action: 'update' },
        { resource: 'project', action: 'delete' },
        { resource: 'role', action: 'read' },
      ];
      for (const perm of managerPermissions) {
        const permission = await this.db.queryOne<{ id: string }>(
          `SELECT id FROM permissions WHERE resource = $1 AND action = $2`,
          [perm.resource, perm.action],
        );
        if (permission) {
          await this.db.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [managerRole.id, permission.id],
          );
        }
      }
      console.log(
        `  ↳ Assigned ${managerPermissions.length} permissions to manager role`,
      );
    }

    // Member: basic read access
    const memberRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'member'`,
    );
    if (memberRole) {
      const memberPermissions = [
        { resource: 'user', action: 'read' },
        { resource: 'organization', action: 'read' },
        { resource: 'project', action: 'read' },
        { resource: 'role', action: 'read' },
      ];
      for (const perm of memberPermissions) {
        const permission = await this.db.queryOne<{ id: string }>(
          `SELECT id FROM permissions WHERE resource = $1 AND action = $2`,
          [perm.resource, perm.action],
        );
        if (permission) {
          await this.db.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [memberRole.id, permission.id],
          );
        }
      }
      console.log(
        `  ↳ Assigned ${memberPermissions.length} permissions to member role`,
      );
    }

    console.log('✅ role_permissions backfill complete');
  }

  /**
   * Backfill manager organization:create permission for existing deployments.
   * This must be a tracked migration because rbac_003 only runs once.
   */
  async addManagerOrganizationCreatePermission(): Promise<void> {
    await this.db.query(
      `INSERT INTO permissions (resource, action, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (resource, action) DO NOTHING`,
      ['organization', 'create', 'Create organizations'],
    );

    const managerRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'manager'`,
    );

    const orgCreatePermission = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM permissions WHERE resource = $1 AND action = $2`,
      ['organization', 'create'],
    );

    if (managerRole && orgCreatePermission) {
      await this.db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [managerRole.id, orgCreatePermission.id],
      );
    }
  }

  async assignAllPermissionsToAdmin(): Promise<void> {
    const adminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'admin'`,
    );

    if (!adminRole) {
      return;
    }

    const allPermissions = await this.db.query<{ id: string }>(
      `SELECT id FROM permissions`,
    );

    for (const perm of allPermissions) {
      await this.db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [adminRole.id, perm.id],
      );
    }
  }

  async addRoleOrganizationScope(): Promise<void> {
    await this.db.query(`
      ALTER TABLE roles
      ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE
    `);
    await this.db.query(`
      ALTER TABLE roles
      DROP CONSTRAINT IF EXISTS roles_name_key
    `);
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS roles_system_name_unique_idx
      ON roles (name)
      WHERE organization_id IS NULL
    `);
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS roles_org_name_unique_idx
      ON roles (organization_id, name)
      WHERE organization_id IS NOT NULL
    `);
  }

  private async syncRolePermissions(
    roleId: string,
    permissions: ReadonlyArray<{ resource: string; action: string }>,
  ): Promise<void> {
    const allowedPermissionTuples = permissions
      .map((_, index) => `($${index * 2 + 2}, $${index * 2 + 3})`)
      .join(', ');

    await this.db.query(
      `DELETE FROM role_permissions
       WHERE role_id = $1
         AND permission_id NOT IN (
           SELECT id
           FROM permissions
           WHERE (resource, action) IN (${allowedPermissionTuples})
         )`,
      [
        roleId,
        ...permissions.flatMap((permission) => [
          permission.resource,
          permission.action,
        ]),
      ],
    );

    for (const permissionDescriptor of permissions) {
      const permission = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM permissions WHERE resource = $1 AND action = $2`,
        [permissionDescriptor.resource, permissionDescriptor.action],
      );
      if (permission) {
        await this.db.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, permission.id],
        );
      }
    }
  }

  async redesignSuperadminAndOrganizationRoles(): Promise<void> {
    await this.db.query(
      `UPDATE "user" SET role = 'superadmin' WHERE role = 'admin'`,
    );

    await this.db.query(
      `DELETE FROM roles WHERE organization_id IS NULL AND name IN ('admin', 'manager', 'member')`,
    );

    await this.db.query(
      `INSERT INTO roles (name, display_name, description, color, is_default, organization_id)
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (name) WHERE organization_id IS NULL DO UPDATE SET
         display_name = EXCLUDED.display_name,
         description = EXCLUDED.description,
         color = EXCLUDED.color,
         is_default = EXCLUDED.is_default,
         updated_at = NOW()`,
      [
        'superadmin',
        'Superadmin',
        'Global platform administrator with unrestricted access across the entire system',
        'red',
        true,
      ],
    );

    const allPermissions = await this.db.query<{ id: string }>(
      `SELECT id FROM permissions`,
    );
    const superadminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'superadmin' AND organization_id IS NULL`,
    );

    if (superadminRole) {
      for (const permission of allPermissions) {
        await this.db.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [superadminRole.id, permission.id],
        );
      }
    }

    const organizations = await this.db.query<{ id: string }>(
      `SELECT id FROM organization`,
    );

    for (const organization of organizations) {
      const defaultRoles = [
        [
          'admin',
          'Admin',
          'Organization administrator with full access within their organization',
          'red',
        ] as const,
        [
          'manager',
          'Manager',
          'Organization manager with elevated operational access within their organization',
          'blue',
        ] as const,
        [
          'member',
          'Member',
          'Organization member with basic access within their organization',
          'gray',
        ] as const,
      ];

      for (const [name, displayName, description, color] of defaultRoles) {
        await this.db.query(
          `INSERT INTO roles (name, display_name, description, color, is_default, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organization_id, name) WHERE organization_id IS NOT NULL DO UPDATE SET
             display_name = EXCLUDED.display_name,
             description = EXCLUDED.description,
             color = EXCLUDED.color,
             is_default = EXCLUDED.is_default,
             updated_at = NOW()`,
          [name, displayName, description, color, true, organization.id],
        );
      }

      const adminRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'admin'`,
        [organization.id],
      );
      if (adminRole) {
        for (const permission of allPermissions) {
          await this.db.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [adminRole.id, permission.id],
          );
        }
      }

      const managerRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'manager'`,
        [organization.id],
      );
      if (managerRole) {
        await this.syncRolePermissions(
          managerRole.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      }

      const memberRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'member'`,
        [organization.id],
      );
      if (memberRole) {
        await this.syncRolePermissions(
          memberRole.id,
          ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS,
        );
      }
    }

    console.log('✅ RBAC superadmin/org role redesign seeded');
  }

  async normalizeOrganizationDefaultRolePermissions(): Promise<void> {
    const organizations = await this.db.query<{ id: string }>(
      `SELECT id FROM organization`,
    );

    for (const organization of organizations) {
      const managerRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'manager'`,
        [organization.id],
      );
      if (managerRole) {
        await this.syncRolePermissions(
          managerRole.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      }

      const memberRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'member'`,
        [organization.id],
      );
      if (memberRole) {
        await this.syncRolePermissions(
          memberRole.id,
          ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS,
        );
      }
    }

    console.log('✅ Organization default role permissions normalized');
  }

  async removeSuperadminOrganizationMemberships(): Promise<void> {
    await this.db.query(`
      DELETE FROM member
      WHERE "userId" IN (
        SELECT id
        FROM "user"
        WHERE COALESCE(role, '') LIKE '%superadmin%'
      )
    `);
  }

  /**
   * Add the organization:manage-members permission and assign it to all existing
   * org-scoped admin roles. This is the capability that drives org-lockout invariants.
   */
  async addManageMembersPermission(): Promise<void> {
    await this.db.query(
      `INSERT INTO permissions (resource, action, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (resource, action) DO NOTHING`,
      [
        'organization',
        'manage-members',
        'Manage organization members and roles',
      ],
    );

    // Assign to global superadmin role
    const superadminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'superadmin' AND organization_id IS NULL`,
    );
    const manageMembersPerm = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM permissions WHERE resource = 'organization' AND action = 'manage-members'`,
    );

    if (superadminRole && manageMembersPerm) {
      await this.db.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [superadminRole.id, manageMembersPerm.id],
      );
    }

    // Assign to all existing org-scoped admin roles
    if (manageMembersPerm) {
      await this.db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, $1
         FROM roles r
         WHERE r.organization_id IS NOT NULL
           AND r.name = 'admin'
         ON CONFLICT DO NOTHING`,
        [manageMembersPerm.id],
      );
    }

    console.log(
      '✅ organization:manage-members permission added and assigned to org admin roles',
    );
  }

  async addProjectPermissions(): Promise<void> {
    const projectPermissions = [
      ['project', 'create', 'Create projects'],
      ['project', 'read', 'View projects'],
      ['project', 'update', 'Update projects'],
      ['project', 'delete', 'Delete projects'],
    ] as const;

    for (const [resource, action, description] of projectPermissions) {
      await this.db.query(
        `INSERT INTO permissions (resource, action, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (resource, action) DO NOTHING`,
        [resource, action, description],
      );
    }

    const globalRoles = await this.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM roles WHERE organization_id IS NULL AND name IN ('admin', 'manager', 'member')`,
    );

    for (const role of globalRoles) {
      if (role.name === 'admin') {
        await this.syncRolePermissions(
          role.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      }
      if (role.name === 'manager') {
        await this.syncRolePermissions(
          role.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      }
      if (role.name === 'member') {
        await this.syncRolePermissions(
          role.id,
          ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS,
        );
      }
    }

    const organizations = await this.db.query<{ id: string }>(
      `SELECT id FROM organization`,
    );

    for (const organization of organizations) {
      const adminRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'admin'`,
        [organization.id],
      );
      if (adminRole) {
        await this.syncRolePermissions(
          adminRole.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      }

      const managerRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'manager'`,
        [organization.id],
      );
      if (managerRole) {
        await this.syncRolePermissions(
          managerRole.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      }

      const memberRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'member'`,
        [organization.id],
      );
      if (memberRole) {
        await this.syncRolePermissions(
          memberRole.id,
          ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS,
        );
      }
    }

    console.log('✅ project permissions added and assigned to roles');
  }

  /**
   * Assign the full ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS set to all existing
   * org-scoped admin roles so they are consistent with the new spec.
   */
  /**
   * Ensure a default organization exists.
   * Uses DEFAULT_ORGANIZATION_SLUG env var, falling back to 'default'.
   * Idempotent: does nothing when the org already exists.
   * Creates admin / manager / member roles with their standard permissions.
   */
  async seedDefaultOrganization(): Promise<void> {
    const slug = process.env.DEFAULT_ORGANIZATION_SLUG || 'default';
    const name = slug.charAt(0).toUpperCase() + slug.slice(1);

    // Atomic upsert: safe under concurrent multi-instance startup.
    // ON CONFLICT DO NOTHING + RETURNING returns the new row; the follow-up
    // SELECT covers the case where a concurrent node already inserted it.
    const inserted = await this.db.queryOne<{ id: string }>(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [randomUUID(), name, slug],
    );

    const orgId = inserted
      ? inserted.id
      : (
          await this.db.queryOne<{ id: string }>(
            `SELECT id FROM organization WHERE slug = $1`,
            [slug],
          )
        ).id;

    if (!inserted) {
      console.log(`✅ Default organization "${slug}" already exists`);
      return;
    }

    // Seed roles and permissions atomically using orgId from the UPSERT above
    const managerTuples = ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS.map(
      (p) => `('${p.resource}','${p.action}')`,
    ).join(', ');
    await this.db.transaction(async (query) => {
      await query(
        `INSERT INTO roles (name, display_name, description, color, is_default, organization_id)
         VALUES
           ('admin',   'Admin',   'Organization administrator with full access within their organization',              'red',  true, $1),
           ('manager', 'Manager', 'Organization manager with elevated operational access within their organization',   'blue', true, $1),
           ('member',  'Member',  'Organization member with basic access within their organization',                   'gray', true, $1)
         ON CONFLICT (organization_id, name) WHERE organization_id IS NOT NULL DO NOTHING`,
        [orgId],
      );

      // Admin gets all permissions
      await query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id
         FROM roles r CROSS JOIN permissions p
         WHERE r.organization_id = $1 AND r.name = 'admin'
         ON CONFLICT DO NOTHING`,
        [orgId],
      );

      // Manager gets org-operational permissions (single round-trip via tuple IN list)
      await query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id
         FROM roles r JOIN permissions p ON (p.resource, p.action) IN (${managerTuples})
         WHERE r.organization_id = $1 AND r.name = 'manager'
         ON CONFLICT DO NOTHING`,
        [orgId],
      );

      // Member gets read-only org access
      await query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r JOIN permissions p ON p.resource = 'organization' AND p.action = 'read'
         WHERE r.organization_id = $1 AND r.name = 'member'
         ON CONFLICT DO NOTHING`,
        [orgId],
      );

      await query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id
         FROM roles r
         JOIN permissions p ON (p.resource, p.action) IN (('organization', 'read'), ('project', 'read'))
         WHERE r.organization_id = $1 AND r.name = 'member'
         ON CONFLICT DO NOTHING`,
        [orgId],
      );
    });

    console.log(
      `✅ Default organization "${slug}" (id: ${orgId}) created with default roles`,
    );
  }

  async assignAdminFullPermissions(): Promise<void> {
    const organizations = await this.db.query<{ id: string }>(
      `SELECT id FROM organization`,
    );

    for (const org of organizations) {
      const adminRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'admin'`,
        [org.id],
      );
      if (adminRole) {
        await this.syncRolePermissions(
          adminRole.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      }
    }

    console.log('✅ Org admin roles updated with full permission set');
  }

  /**
   * Add chat permissions (read, create, stream, delete) and assign them
   * to superadmin + all org-scoped roles using their default permission sets.
   */
  async addChatPermissions(): Promise<void> {
    const chatPermissions = [
      ['chat', 'read', 'View chat conversations and messages'],
      ['chat', 'create', 'Create chat conversations'],
      ['chat', 'stream', 'Send messages and stream chat responses'],
      ['chat', 'delete', 'Delete chat conversations'],
    ] as const;

    for (const [resource, action, description] of chatPermissions) {
      await this.db.query(
        `INSERT INTO permissions (resource, action, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (resource, action) DO NOTHING`,
        [resource, action, description],
      );
    }

    // Assign all chat permissions to global superadmin role
    const superadminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'superadmin' AND organization_id IS NULL`,
    );
    if (superadminRole) {
      const chatPerms = await this.db.query<{ id: string }>(
        `SELECT id FROM permissions WHERE resource = 'chat'`,
      );
      for (const perm of chatPerms) {
        await this.db.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [superadminRole.id, perm.id],
        );
      }
    }

    // Sync all org-scoped roles with their updated default permission sets
    const organizations = await this.db.query<{ id: string }>(
      `SELECT id FROM organization`,
    );

    for (const organization of organizations) {
      const adminRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'admin'`,
        [organization.id],
      );
      if (adminRole) {
        await this.syncRolePermissions(
          adminRole.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      }

      const managerRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'manager'`,
        [organization.id],
      );
      if (managerRole) {
        await this.syncRolePermissions(
          managerRole.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      }

      const memberRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'member'`,
        [organization.id],
      );
      if (memberRole) {
        await this.syncRolePermissions(
          memberRole.id,
          ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS,
        );
      }
    }

    console.log('✅ Chat permissions added and assigned to roles');
  }

  /**
   * Add user:approve permission and assign it to superadmin + all org-scoped
   * admin roles using their updated default permission sets.
   */
  async addUserApprovePermission(): Promise<void> {
    await this.db.query(
      `INSERT INTO permissions (resource, action, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (resource, action) DO NOTHING`,
      ['user', 'approve', 'Approve or reject pending user registrations'],
    );

    // Assign to global superadmin role
    const superadminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'superadmin' AND organization_id IS NULL`,
    );
    const approvePerm = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM permissions WHERE resource = 'user' AND action = 'approve'`,
    );

    if (superadminRole && approvePerm) {
      await this.db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [superadminRole.id, approvePerm.id],
      );
    }

    // Sync all org-scoped roles with their updated default permission sets
    const organizations = await this.db.query<{ id: string }>(
      `SELECT id FROM organization`,
    );

    for (const organization of organizations) {
      const adminRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'admin'`,
        [organization.id],
      );
      if (adminRole) {
        await this.syncRolePermissions(
          adminRole.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      }
    }

    console.log('✅ user:approve permission added and assigned to admin roles');
  }

  /**
   * Remove phantom permissions that exist in the DB but are never enforced
   * by any @RequirePermissions decorator or FE can() check:
   *   - project:* (4) — REMOVED AT THE TIME this migration shipped; they have
   *     since been restored as enforced first-class permissions by
   *     `rbac_019_restore_project_permissions` (ProjectsController wires
   *     @RequirePermissions('project:*') and AppRoutes guards /projects on
   *     project:read). Leaving `'project'` in the list below so migration
   *     behavior is preserved for existing installs; 019 re-inserts after.
   *   - organization:manage-members — internal-only, now replaced by organization:invite
   *   - organization-invitation:* — production-only phantoms (Better Auth leftovers)
   *   - organization-member:* — production-only phantoms (Better Auth leftovers)
   */
  async removePhantomPermissions(): Promise<void> {
    const phantomResources = [
      'project',
      'organization-invitation',
      'organization-member',
    ];

    for (const resource of phantomResources) {
      await this.db.query(
        `DELETE FROM role_permissions
         WHERE permission_id IN (
           SELECT id FROM permissions WHERE resource = $1
         )`,
        [resource],
      );
      await this.db.query(`DELETE FROM permissions WHERE resource = $1`, [
        resource,
      ]);
    }

    // Remove organization:manage-members specifically
    await this.db.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id FROM permissions WHERE resource = 'organization' AND action = 'manage-members'
       )`,
    );
    await this.db.query(
      `DELETE FROM permissions WHERE resource = 'organization' AND action = 'manage-members'`,
    );

    console.log(
      '✅ Phantom permissions removed (project:*, organization:manage-members, organization-invitation:*, organization-member:*)',
    );
  }

  /**
   * Add dashboard:view permission and assign it to superadmin + all org-scoped
   * admin and manager roles using their updated default permission sets.
   */
  async addDashboardPermission(): Promise<void> {
    await this.db.query(
      `INSERT INTO permissions (resource, action, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (resource, action) DO NOTHING`,
      ['dashboard', 'view', 'View admin analytics dashboard'],
    );

    const superadminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'superadmin' AND organization_id IS NULL`,
    );
    const dashboardPerm = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM permissions WHERE resource = 'dashboard' AND action = 'view'`,
    );

    if (superadminRole && dashboardPerm) {
      await this.db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [superadminRole.id, dashboardPerm.id],
      );
    }

    const organizations = await this.db.query<{ id: string }>(
      `SELECT id FROM organization`,
    );

    for (const organization of organizations) {
      const adminRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'admin'`,
        [organization.id],
      );
      if (adminRole) {
        await this.syncRolePermissions(
          adminRole.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      }

      const managerRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'manager'`,
        [organization.id],
      );
      if (managerRole) {
        await this.syncRolePermissions(
          managerRole.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      }
    }

    console.log(
      '✅ dashboard:view permission added and assigned to admin and manager roles',
    );
  }

  /**
   * Restore project permissions as first-class, enforced permissions.
   *
   * Migration `rbac_017_remove_phantom_permissions` deleted project:* under the
   * (then-true) assumption that no controller enforced them. Projects is now a
   * real feature with `@RequirePermissions` decorators on every endpoint and a
   * FE route guard that checks `project:read`. This migration:
   *
   *   1. Re-inserts the 5 project permissions (CRUD + manage-sources).
   *   2. Grants them to superadmin.
   *   3. Re-syncs global and org-scoped admin/manager/member roles using the
   *      updated `ORGANIZATION_*_DEFAULT_PERMISSIONS` constants above.
   */
  async restoreProjectPermissions(): Promise<void> {
    const projectPermissions = [
      ['project', 'create', 'Create projects'],
      ['project', 'read', 'View projects'],
      ['project', 'update', 'Update projects'],
      ['project', 'delete', 'Delete projects'],
      ['project', 'manage-sources', 'Add or remove data sources on projects'],
    ] as const;

    for (const [resource, action, description] of projectPermissions) {
      await this.db.query(
        `INSERT INTO permissions (resource, action, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (resource, action) DO NOTHING`,
        [resource, action, description],
      );
    }

    // Grant all project permissions to the global superadmin role.
    const superadminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'superadmin' AND organization_id IS NULL`,
    );
    if (superadminRole) {
      await this.db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id
         FROM permissions p
         WHERE p.resource = 'project'
         ON CONFLICT DO NOTHING`,
        [superadminRole.id],
      );
    }

    // Re-sync global admin/manager/member roles.
    const globalRoles = await this.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM roles
       WHERE organization_id IS NULL
         AND name IN ('admin', 'manager', 'member')`,
    );
    for (const role of globalRoles) {
      if (role.name === 'admin') {
        await this.syncRolePermissions(
          role.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      } else if (role.name === 'manager') {
        await this.syncRolePermissions(
          role.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      } else if (role.name === 'member') {
        await this.syncRolePermissions(
          role.id,
          ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS,
        );
      }
    }

    // Re-sync org-scoped default roles across every organization.
    const organizations = await this.db.query<{ id: string }>(
      `SELECT id FROM organization`,
    );
    for (const organization of organizations) {
      const adminRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'admin'`,
        [organization.id],
      );
      if (adminRole) {
        await this.syncRolePermissions(
          adminRole.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      }

      const managerRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'manager'`,
        [organization.id],
      );
      if (managerRole) {
        await this.syncRolePermissions(
          managerRole.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      }

      const memberRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'member'`,
        [organization.id],
      );
      if (memberRole) {
        await this.syncRolePermissions(
          memberRole.id,
          ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS,
        );
      }
    }

    console.log(
      '✅ project permissions restored and assigned to default roles (superadmin/admin/manager/member)',
    );
  }

  /**
   * Add airweave:* permissions for the Airweave collection / source-connection
   * CRUD feature shipped in the `feat/airweave-collections-crud` PR.
   *
   * Resource `airweave` with 5 actions: create / read / update / delete /
   * manage-sources. Distribution mirrors the `project` resource pattern
   * with one documented asymmetry (manager has `manage-sources` but not
   * `delete` — collection disposal is admin-only). See ADR-011 §
   * "Consequences > Negative" for the asymmetry rationale.
   *
   * Granting redundantly to superadmin follows the established repo
   * pattern (rbac_014/015/018/019). Runtime auth still bypasses superadmin
   * at the `PermissionsGuard` layer; table grants exist for query consistency.
   */
  async addAirweavePermissions(): Promise<void> {
    const airweavePermissions = [
      ['airweave', 'create', 'Create Airweave collections'],
      ['airweave', 'read', 'View Airweave collections and search results'],
      ['airweave', 'update', 'Rename Airweave collections'],
      ['airweave', 'delete', 'Delete Airweave collections'],
      [
        'airweave',
        'manage-sources',
        'Create, update, re-authenticate, and delete Airweave source connections',
      ],
    ] as const;

    for (const [resource, action, description] of airweavePermissions) {
      await this.db.query(
        `INSERT INTO permissions (resource, action, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (resource, action) DO NOTHING`,
        [resource, action, description],
      );
    }

    // Grant all airweave permissions to the global superadmin role.
    const superadminRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'superadmin' AND organization_id IS NULL`,
    );
    if (superadminRole) {
      await this.db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id
         FROM permissions p
         WHERE p.resource = 'airweave'
         ON CONFLICT DO NOTHING`,
        [superadminRole.id],
      );
    }

    // Re-sync global admin/manager/member roles.
    const globalRoles = await this.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM roles
       WHERE organization_id IS NULL
         AND name IN ('admin', 'manager', 'member')`,
    );
    for (const role of globalRoles) {
      if (role.name === 'admin') {
        await this.syncRolePermissions(
          role.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      } else if (role.name === 'manager') {
        await this.syncRolePermissions(
          role.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      } else if (role.name === 'member') {
        await this.syncRolePermissions(
          role.id,
          ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS,
        );
      }
    }

    // Re-sync org-scoped default roles across every organization.
    const organizations = await this.db.query<{ id: string }>(
      `SELECT id FROM organization`,
    );
    for (const organization of organizations) {
      const adminRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'admin'`,
        [organization.id],
      );
      if (adminRole) {
        await this.syncRolePermissions(
          adminRole.id,
          ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS,
        );
      }

      const managerRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'manager'`,
        [organization.id],
      );
      if (managerRole) {
        await this.syncRolePermissions(
          managerRole.id,
          ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS,
        );
      }

      const memberRole = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'member'`,
        [organization.id],
      );
      if (memberRole) {
        await this.syncRolePermissions(
          memberRole.id,
          ORGANIZATION_MEMBER_DEFAULT_PERMISSIONS,
        );
      }
    }

    console.log(
      '✅ airweave permissions added and assigned to default roles (superadmin/admin/manager/member)',
    );
  }
}
