import { Module, Global, OnModuleDestroy, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../../config';

/**
 * Migration definition interface
 */
interface Migration {
  name: string;
  up: () => Promise<void>;
}

/**
 * Database service for executing queries
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy, OnModuleInit {
  constructor(@Inject('DATABASE_POOL') private readonly pool: Pool) {}

  async onModuleInit() {
    await this.runMigrations();
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /**
   * Execute a query with parameters
   */
  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  /**
   * Execute a query and return a single row
   */
  async queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /**
   * Execute a query within a transaction
   */
  async transaction<T>(callback: (query: (sql: string, params?: unknown[]) => Promise<unknown[]>) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const queryFn = async (sql: string, params?: unknown[]) => {
        const result = await client.query(sql, params);
        return result.rows;
      };
      const result = await callback(queryFn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if a migration has already been executed
   */
  async hasMigrationRun(name: string): Promise<boolean> {
    const result = await this.queryOne<{ name: string }>(
      `SELECT name FROM _migrations WHERE name = $1`,
      [name],
    );
    return result !== null;
  }

  /**
   * Record a migration as executed
   */
  async recordMigration(name: string): Promise<void> {
    await this.query(
      `INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name],
    );
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<void> {
    // Create migrations tracking table first (always runs)
    await this.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Define all migrations
    const migrations: Migration[] = [
      {
        name: '001_better_auth_core_tables',
        up: async () => {
          // User table (Better Auth core)
          await this.query(`
            CREATE TABLE IF NOT EXISTS "user" (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              email TEXT NOT NULL UNIQUE,
              "emailVerified" BOOLEAN NOT NULL DEFAULT false,
              image TEXT,
              "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
              role TEXT DEFAULT NULL,
              banned BOOLEAN DEFAULT false,
              "banReason" TEXT,
              "banExpires" TIMESTAMP WITH TIME ZONE
            )
          `);

          // Session table (Better Auth core)
          await this.query(`
            CREATE TABLE IF NOT EXISTS session (
              id TEXT PRIMARY KEY,
              "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
              token TEXT NOT NULL UNIQUE,
              "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "ipAddress" TEXT,
              "userAgent" TEXT,
              "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
              "impersonatedBy" TEXT,
              "activeOrganizationId" TEXT
            )
          `);

          // Account table (Better Auth - OAuth providers)
          await this.query(`
            CREATE TABLE IF NOT EXISTS account (
              id TEXT PRIMARY KEY,
              "accountId" TEXT NOT NULL,
              "providerId" TEXT NOT NULL,
              "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
              "accessToken" TEXT,
              "refreshToken" TEXT,
              "idToken" TEXT,
              "accessTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
              "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
              scope TEXT,
              password TEXT,
              "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);

          // Verification table (Better Auth - email verification, password reset)
          await this.query(`
            CREATE TABLE IF NOT EXISTS verification (
              id TEXT PRIMARY KEY,
              identifier TEXT NOT NULL,
              value TEXT NOT NULL,
              "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
              "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
              "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
          `);

          // JWKS table (Better Auth - JWT key storage)
          await this.query(`
            CREATE TABLE IF NOT EXISTS jwks (
              id TEXT PRIMARY KEY,
              "publicKey" TEXT NOT NULL,
              "privateKey" TEXT NOT NULL,
              "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "expiresAt" TIMESTAMP WITH TIME ZONE
            )
          `);
        },
      },
      {
        name: '002_better_auth_organization_tables',
        up: async () => {
          // Organization table (Better Auth Organization plugin)
          await this.query(`
            CREATE TABLE IF NOT EXISTS organization (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              slug TEXT NOT NULL UNIQUE,
              logo TEXT,
              "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
              metadata TEXT
            )
          `);

          // Member table (Better Auth - organization membership)
          await this.query(`
            CREATE TABLE IF NOT EXISTS member (
              id TEXT PRIMARY KEY,
              "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
              "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
              role TEXT NOT NULL DEFAULT 'member',
              "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);

          // Invitation table (Better Auth Organization plugin)
          await this.query(`
            CREATE TABLE IF NOT EXISTS invitation (
              id TEXT PRIMARY KEY,
              "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
              email TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'member',
              status TEXT NOT NULL DEFAULT 'pending',
              "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
              "inviterId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
              "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);
        },
      },
      {
        name: '003_core_indexes',
        up: async () => {
          await this.query(`CREATE INDEX IF NOT EXISTS "user_email_idx" ON "user"(email)`);
          await this.query(`CREATE INDEX IF NOT EXISTS "session_userId_idx" ON session("userId")`);
          await this.query(`CREATE INDEX IF NOT EXISTS "session_token_idx" ON session(token)`);
          await this.query(`CREATE INDEX IF NOT EXISTS "account_userId_idx" ON account("userId")`);
          await this.query(`CREATE INDEX IF NOT EXISTS "member_userId_idx" ON member("userId")`);
          await this.query(`CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON member("organizationId")`);
          await this.query(`CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON invitation("organizationId")`);
          await this.query(`CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON invitation(email)`);
        },
      },
      {
        name: '004_jwks_expires_at_column',
        up: async () => {
          // Add expiresAt column if it doesn't exist (for existing tables)
          await this.query(`
            DO $$ BEGIN
              ALTER TABLE jwks ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP WITH TIME ZONE;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
          `);
        },
      },
      {
        name: '005_enforce_unified_org_member_roles',
        up: async () => {
          // Normalize legacy Better Auth owner role residue.
          await this.query(`UPDATE member SET role = 'admin' WHERE role = 'owner'`);
          await this.query(`UPDATE invitation SET role = 'admin' WHERE role = 'owner'`);

          // Add constraints as NOT VALID so new writes are protected immediately
          // without blocking startup on pre-existing unexpected rows.
          await this.query(`
            DO $$ BEGIN
              ALTER TABLE member
                ADD CONSTRAINT member_role_allowed_values_chk
                CHECK (role IN ('admin', 'manager', 'member')) NOT VALID;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
          `);

          await this.query(`
            DO $$ BEGIN
              ALTER TABLE invitation
                ADD CONSTRAINT invitation_role_allowed_values_chk
                CHECK (role IN ('admin', 'manager', 'member')) NOT VALID;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
          `);
        },
      },
      {
        name: '006_drop_role_check_constraints',
        up: async () => {
          // Remove the hardcoded admin|manager|member check constraints so that
          // dynamic org-role names can be stored.
          await this.query(`
            ALTER TABLE member
              DROP CONSTRAINT IF EXISTS member_role_allowed_values_chk
          `);
          await this.query(`
            ALTER TABLE invitation
              DROP CONSTRAINT IF EXISTS invitation_role_allowed_values_chk
          `);
          // Change user.role default from 'member' to NULL — org roles no longer
          // live in user.role; only 'superadmin' will be written there.
          await this.query(`
            ALTER TABLE "user" ALTER COLUMN role SET DEFAULT NULL
          `);
        },
      },
      {
        name: '007_restrict_user_role_to_platform',
        up: async () => {
          // Backfill: clear org-role values from user.role so only superadmins
          // have a non-null value.
          await this.query(`
            UPDATE "user"
            SET role = NULL, "updatedAt" = NOW()
            WHERE role IS NOT NULL
              AND role NOT IN ('superadmin')
          `);
          // Add a check constraint that enforces user.role to be superadmin or null.
          await this.query(`
            DO $$ BEGIN
              ALTER TABLE "user"
                ADD CONSTRAINT user_role_platform_only_chk
                CHECK (role IS NULL OR role = 'superadmin') NOT VALID;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
          `);
        },
      },
      {
        name: '009_drop_user_role_check_constraint',
        up: async () => {
          // Replace the legacy user_role_platform_only_chk constraint from 007 with
          // a new CHECK that matches the intended allowed platform roles.
          // This keeps Better Auth free to write valid platform roles while the DB
          // still enforces that only known platform roles (or NULL) are stored.
          await this.query(`
            ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_role_platform_only_chk
          `);
          await this.query(`
            DO $$ BEGIN
              ALTER TABLE "user"
                ADD CONSTRAINT user_role_platform_only_chk
                CHECK (role IS NULL OR role IN ('admin', 'manager', 'member', 'superadmin')) NOT VALID;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
          `);
        },
      },
      {
        name: '008_rename_is_system_to_is_default',
        up: async () => {
          // Rename the is_system column to is_default on the roles table.
          // is_default = true means "seeded as a starter default"; purely informational.
          await this.query(`
            DO $$ BEGIN
              ALTER TABLE roles RENAME COLUMN is_system TO is_default;
            EXCEPTION WHEN undefined_column THEN NULL;
                      WHEN undefined_table THEN NULL;
            END $$;
          `);
        },
      },
    ];

    // Run pending migrations
    let pendingCount = 0;
    for (const migration of migrations) {
      const hasRun = await this.hasMigrationRun(migration.name);
      if (!hasRun) {
        await migration.up();
        await this.recordMigration(migration.name);
        pendingCount++;
        console.log(`  ↳ Migration ${migration.name} applied`);
      }
    }

    if (pendingCount > 0) {
      console.log(`✅ Core schema migrations completed (${pendingCount} new)`);
    } else {
      console.log('✅ Core schema migrations up to date');
    }
  }
}

/**
 * Database module for managing PostgreSQL connections
 */
@Global()
@Module({
  providers: [
    {
      provide: 'DATABASE_POOL',
      /* istanbul ignore next */
      useFactory: async (configService: ConfigService) => {
        const pool = new Pool({
          connectionString: configService.getDatabaseUrl(),
        });
        // Test connection
        try {
          await pool.query('SELECT NOW()');
          console.log('✅ Database connected');
        } catch (error) {
          console.error('❌ Database connection failed:', error);
          throw error;
        }
        return pool;
      },
      inject: [ConfigService],
    },
    DatabaseService,
  ],
  exports: ['DATABASE_POOL', DatabaseService],
})
export class DatabaseModule {}
