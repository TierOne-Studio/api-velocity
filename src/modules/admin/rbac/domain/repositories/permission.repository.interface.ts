import { Permission } from '../entities/role.entity';

export const PERMISSION_REPOSITORY = Symbol('PERMISSION_REPOSITORY');

export interface IPermissionRepository {
  findAll(): Promise<Permission[]>;
  findById(id: string): Promise<Permission | null>;
  findByResourceAction(
    resource: string,
    action: string,
  ): Promise<Permission | null>;
  findGroupedByResource(): Promise<Record<string, Permission[]>>;
  create(
    resource: string,
    action: string,
    description?: string,
  ): Promise<Permission>;
}
