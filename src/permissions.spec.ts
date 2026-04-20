import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for permissions.ts
 *
 * Since better-auth uses ESM-only .mjs exports that cannot be directly imported
 * in the Jest/CJS test environment, we verify the permissions module by reading
 * the source file directly (same approach as auth.spec.ts).
 */
describe('permissions module (source verification)', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(
      path.resolve(process.cwd(), 'src', 'permissions.ts'),
      'utf-8',
    );
  });

  describe('statement', () => {
    it('should define organization resource with create action', () => {
      expect(source).toContain("'create'");
      expect(source).toContain('organization:');
    });

    it('should define organization resource with invite action', () => {
      expect(source).toContain("'invite'");
    });

    it('should define role resource with list and get actions', () => {
      expect(source).toContain('role:');
      expect(source).toContain("'list'");
      expect(source).toContain("'get'");
    });

    it('should define project resource with create/read/update/delete actions', () => {
      expect(source).toContain(
        "project: ['create', 'read', 'update', 'delete']",
      );
    });

    it('should spread defaultStatements from better-auth', () => {
      expect(source).toContain('...defaultStatements');
    });
  });

  describe('roles', () => {
    it('should define superadminRole using ac.newRole', () => {
      expect(source).toContain('superadminRole');
      expect(source).toContain('...adminAc.statements');
    });

    it('should define adminRole using ac.newRole', () => {
      expect(source).toContain('adminRole');
      expect(source).toContain('ac.newRole');
    });

    it('should define managerRole with user permissions', () => {
      expect(source).toContain('managerRole');
      expect(source).toContain("'set-role'");
      expect(source).toContain("'set-password'");
    });

    it('should define organization permissions for admin and manager roles', () => {
      expect(source).toContain(
        "organization: ['create', 'list', 'get', 'update', 'invite']",
      );
    });

    it('should define memberRole', () => {
      expect(source).toContain('memberRole');
    });

    it('should grant read-only organization access to memberRole', () => {
      expect(source).toContain("organization: ['list', 'get']");
    });

    it('should export roles object with superadmin, admin, manager, member keys', () => {
      expect(source).toContain('superadmin: superadminRole');
      expect(source).toContain('admin: adminRole');
      expect(source).toContain('manager: managerRole');
      expect(source).toContain('member: memberRole');
    });

    it('managerRole should include session permissions', () => {
      expect(source).toContain("'revoke'");
      expect(source).toContain('session:');
    });

    it('adminRole should grant full project permissions', () => {
      const adminBlock = source
        .split('export const adminRole = ac.newRole({')[1]
        ?.split('});')[0];
      expect(adminBlock).toBeDefined();
      expect(adminBlock).toContain(
        "project: ['create', 'read', 'update', 'delete']",
      );
    });

    it('managerRole should grant create/read/update project permissions (no delete)', () => {
      const managerBlock = source
        .split('managerRole = ac.newRole({')[1]
        ?.split('});')[0];
      expect(managerBlock).toBeDefined();
      expect(managerBlock).toContain("project: ['create', 'read', 'update']");
    });

    it('memberRole should grant read-only project access', () => {
      const memberBlock = source
        .split('memberRole = ac.newRole({')[1]
        ?.split('});')[0];
      expect(memberBlock).toBeDefined();
      expect(memberBlock).toContain("project: ['read']");
    });
  });

  describe('roleMetadata', () => {
    it('should define superadmin metadata', () => {
      expect(source).toContain('superadmin:');
      expect(source).toContain("name: 'Superadmin'");
    });

    it('should define admin metadata with red color', () => {
      expect(source).toContain("color: 'red'");
    });

    it('should define manager metadata with blue color', () => {
      expect(source).toContain("color: 'blue'");
    });

    it('should define member metadata with gray color', () => {
      expect(source).toContain("color: 'gray'");
    });

    it('should include name fields for each role', () => {
      expect(source).toContain("name: 'Superadmin'");
      expect(source).toContain("name: 'Admin'");
      expect(source).toContain("name: 'Manager'");
      expect(source).toContain("name: 'Member'");
    });

    it('should include description fields', () => {
      expect(source).toContain('description:');
    });
  });

  describe('ac (AccessControl)', () => {
    it('should create access control from statement', () => {
      expect(source).toContain('createAccessControl(statement)');
    });

    it('should export ac', () => {
      expect(source).toContain('export const ac');
    });

    it('should export RoleName type', () => {
      expect(source).toContain('export type RoleName');
    });

    it('should export Statement type', () => {
      expect(source).toContain('export type Statement');
    });
  });
});
