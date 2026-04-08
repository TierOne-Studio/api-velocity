import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for a route handler.
 * Used with RolesGuard to enforce platform-level role checks.
 *
 * @example
 * @Roles('admin')
 * @Get('users')
 * getUsers() { ... }
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
