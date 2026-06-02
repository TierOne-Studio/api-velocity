import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';

/**
 * RBAC Permission Statements
 *
 * Defines all resources and their available actions.
 * Uses Better Auth's access control system.
 */
export const statement = {
  ...defaultStatements,
  organization: ['create', 'list', 'get', 'update', 'invite'],
  role: ['list', 'get'],
  chat: ['read', 'create', 'stream', 'delete'],
  dashboard: ['view'],
  project: ['create', 'read', 'update', 'delete', 'manage-sources'],
  airweave: ['create', 'read', 'update', 'delete', 'manage-sources'],
  // sql-connection:* per ADR-012. No manage-sources action — SQL connections
  // do not have nested resources. Test endpoints map to :update grade.
  'sql-connection': ['read', 'create', 'update', 'delete'],
  // vectordb:upload gates the file-upload endpoint (Slice 3).
  // delete is admin-only (mirrors airweave asymmetry — consequential action).
  'vector-db': ['read', 'create', 'update', 'delete', 'upload'],
} as const;

/**
 * Access Controller instance
 */
export const ac = createAccessControl(statement);

/**
 * Role Definitions
 *
 * Each role defines what permissions it has for each resource.
 */

// Superadmin role - full access to all resources
export const superadminRole = ac.newRole({
  ...adminAc.statements,
});

// Admin role - full access within an organization
export const adminRole = ac.newRole({
  user: [
    'create',
    'list',
    'get',
    'update',
    'delete',
    'ban',
    'impersonate',
    'set-role',
    'set-password',
  ],
  session: ['list', 'revoke'],
  organization: ['create', 'list', 'get', 'update', 'invite'],
  role: ['list', 'get'],
  chat: ['read', 'create', 'stream', 'delete'],
  dashboard: ['view'],
  project: ['create', 'read', 'update', 'delete', 'manage-sources'],
  airweave: ['create', 'read', 'update', 'delete', 'manage-sources'],
  'sql-connection': ['read', 'create', 'update', 'delete'],
  'vector-db': ['read', 'create', 'update', 'delete', 'upload'],
});

// Manager role - can manage users/sessions within their organization
export const managerRole = ac.newRole({
  user: ['create', 'list', 'get', 'update', 'ban', 'set-role', 'set-password'],
  session: ['list', 'revoke'],
  organization: ['create', 'list', 'get', 'update', 'invite'],
  role: ['list', 'get'],
  chat: ['read', 'create', 'stream', 'delete'],
  dashboard: ['view'],
  project: ['create', 'read', 'update', 'manage-sources'],
  // Manager has manage-sources (day-to-day data integration) but not delete
  // (collection disposal is an admin-only consequential action).
  // Asymmetry is intentional — see ADR-011 "Consequences > Negative".
  airweave: ['create', 'read', 'update', 'manage-sources'],
  // SQL connections have no nested resources, so no manage-sources/delete
  // asymmetry — manager gets the same full CRUD set as admin per ADR-012.
  'sql-connection': ['read', 'create', 'update', 'delete'],
  // Manager cannot delete vector-dbs (consequential action — mirrors airweave).
  'vector-db': ['read', 'create', 'update', 'upload'],
});

// Member role - basic org member
export const memberRole = ac.newRole({
  organization: ['list', 'get'],
  role: ['list', 'get'],
  chat: ['read', 'create', 'stream'],
  project: ['read'],
  airweave: ['read'],
  'sql-connection': ['read'],
  'vector-db': ['read'],
});

/**
 * All available roles
 */
export const roles = {
  superadmin: superadminRole,
  admin: adminRole,
  manager: managerRole,
  member: memberRole,
} as const;

/**
 * Role metadata for UI display
 */
export const roleMetadata = {
  superadmin: {
    name: 'Superadmin',
    description: 'Unrestricted global access across the entire platform',
    color: 'red',
  },
  admin: {
    name: 'Admin',
    description: 'Full access within an organization',
    color: 'red',
  },
  manager: {
    name: 'Manager',
    description: 'Can manage everything within their organization',
    color: 'blue',
  },
  member: {
    name: 'Member',
    description: 'Basic access within an organization',
    color: 'gray',
  },
} as const;

export type RoleName = keyof typeof roles;
export type Statement = typeof statement;
