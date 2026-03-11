import fs from 'node:fs';
import path from 'node:path';

/**
 * Unit tests for auth configuration (PR#7 - token expiry increase to 24 hours)
 *
 * These tests verify that the auth configuration exports the correct token expiry values.
 * Since `auth` is created via `betterAuth()` which requires a real DB connection,
 * we test the configuration values by reading the source file directly.
 */
describe('Auth Configuration - Token Expiry (PR#7)', () => {
  let authSource: string;

  beforeAll(() => {
    authSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src', 'auth.ts'),
      'utf-8',
    );
  });

  it('should configure resetPasswordTokenExpiresIn to 86400 (24 hours)', () => {
    expect(authSource).toContain('resetPasswordTokenExpiresIn: 86400');
  });

  it('should configure emailVerification expiresIn to 86400 (24 hours)', () => {
    // Verify the expiresIn is set in emailVerification block
    const emailVerifBlock = authSource.slice(
      authSource.indexOf('emailVerification:'),
    );
    expect(emailVerifBlock).toContain('expiresIn: 86400');
  });

  it('should include bearer plugin for cross-origin auth', () => {
    expect(authSource).toContain('bearer()');
  });

  it('should include organization plugin', () => {
    expect(authSource).toContain('organization(');
  });

  it('should include admin plugin with access control', () => {
    expect(authSource).toContain('admin(');
    expect(authSource).toContain('ac,');
    expect(authSource).toContain('roles,');
  });

  it('should configure Better Auth admin plugin to default new users to member', () => {
    expect(authSource).toContain("defaultRole: 'member'");
  });
});
