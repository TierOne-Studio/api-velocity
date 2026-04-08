import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to specify required permissions for a route handler.
 * Used with PermissionsGuard to enforce permission-based access control.
 *
 * @example
 * @RequirePermissions('user:read', 'user:update')
 * @Get('users')
 * getUsers() { ... }
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
