import { Role, Permission } from '../entities/role.entity';
import { CreateRoleDto } from '../../api/dto/create-role.dto';
import { UpdateRoleDto } from '../../api/dto/update-role.dto';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

export interface IRoleRepository {
  findAll(activeOrganizationId?: string | null): Promise<Role[]>;
  findById(id: string): Promise<Role | null>;
  findByName(name: string): Promise<Role | null>;
  findByNameInOrganization(name: string, activeOrganizationId: string): Promise<Role | null>;
  create(dto: CreateRoleDto, activeOrganizationId: string): Promise<Role>;
  update(id: string, dto: UpdateRoleDto): Promise<Role | null>;
  remove(id: string): Promise<void>;
  getPermissions(roleId: string): Promise<Permission[]>;
  setPermissions(roleId: string, permissionIds: string[]): Promise<void>;
  hasPermission(roleName: string, resource: string, action: string): Promise<boolean>;
}
