import { rowToRole, rowToPermission } from './role.entity';

describe('role.entity utilities', () => {
  const baseRow = {
    id: 'r-1',
    name: 'admin',
    display_name: 'Admin',
    description: 'Platform administrator',
    color: 'red',
    is_default: true,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-02'),
  };

  describe('rowToRole', () => {
    it('maps an org-scoped role row with isSystem=false', () => {
      const row = { ...baseRow, organization_id: 'org-1' };
      const role = rowToRole(row);

      expect(role.id).toBe('r-1');
      expect(role.name).toBe('admin');
      expect(role.displayName).toBe('Admin');
      expect(role.description).toBe('Platform administrator');
      expect(role.color).toBe('red');
      expect(role.isDefault).toBe(true);
      expect(role.isSystem).toBe(false);
      expect(role.organizationId).toBe('org-1');
      expect(role.createdAt).toEqual(new Date('2024-01-01'));
      expect(role.updatedAt).toEqual(new Date('2024-01-02'));
    });

    it('maps a system role row (no organizationId) with isSystem=true', () => {
      const row = { ...baseRow, organization_id: null };
      const role = rowToRole(row);

      expect(role.isSystem).toBe(true);
      expect(role.organizationId).toBeNull();
    });

    it('maps a role row with null description', () => {
      const row = { ...baseRow, organization_id: null, description: null };
      const role = rowToRole(row);

      expect(role.description).toBeNull();
    });
  });

  describe('rowToPermission', () => {
    it('maps a permission row to a Permission domain object', () => {
      const row = {
        id: 'p-1',
        resource: 'user',
        action: 'read',
        description: 'View user details',
      };
      const perm = rowToPermission(row);

      expect(perm.id).toBe('p-1');
      expect(perm.resource).toBe('user');
      expect(perm.action).toBe('read');
      expect(perm.description).toBe('View user details');
    });

    it('maps a permission row with null description', () => {
      const row = {
        id: 'p-2',
        resource: 'session',
        action: 'revoke',
        description: null,
      };
      const perm = rowToPermission(row);

      expect(perm.description).toBeNull();
    });
  });
});
