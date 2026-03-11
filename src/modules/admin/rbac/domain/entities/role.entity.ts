/**
 * Role entity representing a role in the RBAC system
 */
export interface Role {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  color: string;
  isSystem: boolean;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Role with its associated permissions
 */
export interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

/**
 * Permission entity representing an action on a resource
 */
export interface Permission {
  id: string;
  resource: string;
  action: string;
  description: string | null;
}

/**
 * Role-Permission junction
 */
export interface RolePermission {
  roleId: string;
  permissionId: string;
}

/**
 * Database row types (snake_case from PostgreSQL)
 */
export interface RoleRow {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  color: string;
  is_system: boolean;
  organization_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PermissionRow {
  id: string;
  resource: string;
  action: string;
  description: string | null;
}

/**
 * Convert database row to Role entity
 */
export function rowToRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    color: row.color,
    isSystem: row.is_system,
    organizationId: row.organization_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert database row to Permission entity
 */
export function rowToPermission(row: PermissionRow): Permission {
  return {
    id: row.id,
    resource: row.resource,
    action: row.action,
    description: row.description,
  };
}
