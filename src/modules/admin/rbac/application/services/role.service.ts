import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Role, Permission } from '../../domain/entities/role.entity';
import { CreateRoleDto, UpdateRoleDto } from '../../api/dto';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';

/**
 * Service for managing roles in the RBAC system
 */
@Injectable()
export class RoleService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
  ) {}

  /**
   * Get all roles
   */
  async findAll(activeOrganizationId?: string | null): Promise<Role[]> {
    return this.roleRepo.findAll(activeOrganizationId);
  }

  /**
   * Find role by ID
   */
  async findById(id: string): Promise<Role | null> {
    return this.roleRepo.findById(id);
  }

  /**
   * Find role by name
   */
  async findByName(name: string): Promise<Role | null> {
    return this.roleRepo.findByName(name);
  }

  async findByNameInOrganization(
    name: string,
    activeOrganizationId: string,
  ): Promise<Role | null> {
    return this.roleRepo.findByNameInOrganization(name, activeOrganizationId);
  }

  /**
   * Create a new role
   */
  async create(
    dto: CreateRoleDto,
    activeOrganizationId: string,
  ): Promise<Role> {
    return this.roleRepo.create(dto, activeOrganizationId);
  }

  /**
   * Update a role
   */
  async update(id: string, dto: UpdateRoleDto): Promise<Role | null> {
    const existing = await this.roleRepo.findById(id);
    if (!existing) {
      return null;
    }

    const normalizedName = dto.name?.trim().toLowerCase();

    const hasAnyField =
      normalizedName !== undefined ||
      dto.displayName !== undefined ||
      dto.description !== undefined ||
      dto.color !== undefined;

    if (!hasAnyField) {
      return existing;
    }

    if (normalizedName && normalizedName !== existing.name) {
      if (!existing.organizationId) {
        throw new ForbiddenException('Cannot rename global role');
      }

      const duplicate = await this.roleRepo.findByNameInOrganization(
        normalizedName,
        existing.organizationId,
      );
      if (duplicate && duplicate.id !== existing.id) {
        throw new ConflictException('Role name already exists');
      }
    }

    return this.roleRepo.update(id, {
      ...dto,
      name: normalizedName,
    });
  }

  /**
   * Delete an organization-scoped role when it is no longer referenced.
   */
  async delete(id: string): Promise<void> {
    const existing = await this.roleRepo.findById(id);
    if (!existing) {
      throw new NotFoundException('Role not found');
    }

    if (!existing.organizationId) {
      throw new ForbiddenException('Cannot delete global role');
    }

    const usage = await this.roleRepo.getUsageSummary(id);
    if (usage.users > 0 || usage.members > 0 || usage.invitations > 0) {
      throw new ConflictException(
        'Role is still assigned and cannot be deleted',
      );
    }

    await this.roleRepo.remove(id);
  }

  /**
   * Get permissions for a role
   */
  async getPermissions(roleId: string): Promise<Permission[]> {
    return this.roleRepo.getPermissions(roleId);
  }

  /**
   * Assign permissions to a role
   */
  async assignPermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    await this.roleRepo.setPermissions(roleId, permissionIds);
  }

  /**
   * Get user's effective permissions based on their role
   */
  async getUserPermissions(
    roleName: string,
    activeOrganizationId: string | null,
  ): Promise<Permission[]> {
    const role = activeOrganizationId
      ? await this.roleRepo.findByNameInOrganization(
          roleName,
          activeOrganizationId,
        )
      : await this.roleRepo.findByName(roleName);
    if (!role) {
      return [];
    }
    return this.roleRepo.getPermissions(role.id);
  }

  /**
   * Check if a role has a specific permission
   */
  async hasPermission(
    roleName: string,
    resource: string,
    action: string,
    organizationId?: string | null,
  ): Promise<boolean> {
    return this.roleRepo.hasPermission(
      roleName,
      resource,
      action,
      organizationId,
    );
  }

  /**
   * Get the user's membership role in the given organization.
   * Returns null when the user is not a member.
   */
  async getUserActiveMemberRole(
    userId: string,
    organizationId: string,
  ): Promise<string | null> {
    return this.roleRepo.getMemberRoleInOrg(userId, organizationId);
  }
}
