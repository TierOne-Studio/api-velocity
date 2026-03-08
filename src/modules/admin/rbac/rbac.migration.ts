import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../../shared/infrastructure/database/database.module';

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
      { name: 'rbac_002_migrate_old_role_names', up: () => this.migrateOldRoleNames() },
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
        name VARCHAR(50) UNIQUE NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        description TEXT,
        color VARCHAR(20) DEFAULT 'gray',
        is_system BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
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
    await this.db.query(`UPDATE "user" SET role = 'manager' WHERE role = 'moderator'`);
    
    // Update user table: rename 'user' role to 'member'
    await this.db.query(`UPDATE "user" SET role = 'member' WHERE role = 'user'`);
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
      { resource: 'user', action: 'update', description: 'Update user information' },
      { resource: 'user', action: 'delete', description: 'Delete users' },
      { resource: 'user', action: 'ban', description: 'Ban/unban users' },
      { resource: 'user', action: 'impersonate', description: 'Impersonate users' },
      { resource: 'user', action: 'set-role', description: 'Change user roles' },
      { resource: 'user', action: 'set-password', description: 'Reset user passwords' },
      // Session permissions
      { resource: 'session', action: 'read', description: 'View sessions' },
      { resource: 'session', action: 'revoke', description: 'Revoke sessions' },
      // Organization permissions
      { resource: 'organization', action: 'create', description: 'Create organizations' },
      { resource: 'organization', action: 'read', description: 'View organizations' },
      { resource: 'organization', action: 'update', description: 'Update organizations' },
      { resource: 'organization', action: 'delete', description: 'Delete organizations' },
      { resource: 'organization', action: 'invite', description: 'Invite members' },
      // Role permissions
      { resource: 'role', action: 'create', description: 'Create roles' },
      { resource: 'role', action: 'read', description: 'View roles' },
      { resource: 'role', action: 'update', description: 'Update roles' },
      { resource: 'role', action: 'delete', description: 'Delete roles' },
      { resource: 'role', action: 'assign', description: 'Assign permissions to roles' },
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
        description: 'Global platform administrator with full access to all organizations and settings',
        color: 'red',
        isSystem: true,
      },
      {
        name: 'manager',
        displayName: 'Manager',
        description: 'Organization manager with full access within their assigned organization',
        color: 'blue',
        isSystem: true,
      },
      {
        name: 'member',
        displayName: 'Member',
        description: 'Organization member with basic access within their assigned organization',
        color: 'gray',
        isSystem: true,
      },
    ];

    for (const role of roles) {
      await this.db.query(
        `INSERT INTO roles (name, display_name, description, color, is_system)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           color = EXCLUDED.color,
           is_system = EXCLUDED.is_system,
           updated_at = NOW()`,
        [role.name, role.displayName, role.description, role.color, role.isSystem],
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
      console.log(`  ↳ Assigned ${allPermissions.length} permissions to admin role`);
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
      console.log(`  ↳ Assigned ${managerPermissions.length} permissions to manager role`);
    }

    // Member: basic read access
    const memberRole = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'member'`,
    );
    if (memberRole) {
      const memberPermissions = [
        { resource: 'user', action: 'read' },
        { resource: 'organization', action: 'read' },
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
      console.log(`  ↳ Assigned ${memberPermissions.length} permissions to member role`);
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
}
