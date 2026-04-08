import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { closeAuthDatabasePool } from '../src/auth';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

export default async function globalTeardown() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('DATABASE_URL not set, skipping database cleanup');
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('🧹 Cleaning up test database...');

    // Clean up test data in reverse dependency order
    await pool.query('DELETE FROM session');
    await pool.query('DELETE FROM verification');
    await pool.query('DELETE FROM account');
    await pool.query('DELETE FROM invitation');
    await pool.query('DELETE FROM member');
    await pool.query('DELETE FROM organization');
    await pool.query('DELETE FROM "user"');

    // Reset role_permissions to defaults (keep RBAC structure)
    await pool.query('DELETE FROM role_permissions');

    console.log('✅ Test database cleaned up');
  } catch (error) {
    console.error('❌ Error cleaning up test database:', error);
  } finally {
    await closeAuthDatabasePool();
    await pool.end();
  }
}
