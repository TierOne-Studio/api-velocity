import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  IRoleRepository,
  RoleUsageSummary,
} from '../../../domain/repositories/role.repository.interface';
import { Role, Permission } from '../../../domain/entities/role.entity';
import { CreateRoleDto } from '../../../api/dto/create-role.dto';
import { UpdateRoleDto } from '../../../api/dto/update-role.dto';
import { RoleTypeOrmEntity } from '../entities/role.typeorm-entity';
import { PermissionTypeOrmEntity } from '../entities/permission.typeorm-entity';

function mapRole(e: RoleTypeOrmEntity): Role {
  return {
    id: e.id,
    name: e.name,
    displayName: e.displayName,
    description: e.description,
    color: e.color,
    isDefault: e.isDefault,
    isSystem: !e.organizationId,
    organizationId: e.organizationId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function mapPermission(e: PermissionTypeOrmEntity): Permission {
  return {
    id: e.id,
    resource: e.resource,
    action: e.action,
    description: e.description,
  };
}

@Injectable()
export class TypeOrmRoleRepository implements IRoleRepository {
  constructor(
    @InjectRepository(RoleTypeOrmEntity)
    private readonly roleRepo: Repository<RoleTypeOrmEntity>,
    @InjectRepository(PermissionTypeOrmEntity)
    private readonly permissionRepo: Repository<PermissionTypeOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(activeOrganizationId?: string | null): Promise<Role[]> {
    const entities = await this.roleRepo.find(
      activeOrganizationId
        ? {
            where: { organizationId: activeOrganizationId },
            order: { isDefault: 'DESC', name: 'ASC' },
          }
        : {
            order: { organizationId: 'ASC', isDefault: 'DESC', name: 'ASC' },
          },
    );
    return entities.map(mapRole);
  }

  async findById(id: string): Promise<Role | null> {
    const entity = await this.roleRepo.findOne({ where: { id } });
    return entity ? mapRole(entity) : null;
  }

  async findByName(name: string): Promise<Role | null> {
    const entity = await this.roleRepo.findOne({ where: { name } });
    return entity ? mapRole(entity) : null;
  }

  async findByNameInOrganization(
    name: string,
    activeOrganizationId: string,
  ): Promise<Role | null> {
    const entity = await this.roleRepo.findOne({
      where: { name, organizationId: activeOrganizationId },
    });
    return entity ? mapRole(entity) : null;
  }

  async create(
    dto: CreateRoleDto,
    activeOrganizationId: string,
  ): Promise<Role> {
    const entity = this.roleRepo.create({
      name: dto.name,
      displayName: dto.displayName,
      description: dto.description ?? null,
      color: dto.color ?? 'gray',
      isDefault: false,
      organizationId: activeOrganizationId,
    });
    const saved = await this.roleRepo.save(entity);
    return mapRole(saved);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role | null> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(RoleTypeOrmEntity, {
        where: { id },
      });
      if (!existing) {
        return null;
      }

      const partial: Partial<RoleTypeOrmEntity> = {};
      if (dto.name !== undefined) partial.name = dto.name;
      if (dto.displayName !== undefined) partial.displayName = dto.displayName;
      if (dto.description !== undefined) partial.description = dto.description;
      if (dto.color !== undefined) partial.color = dto.color;

      await manager.update(RoleTypeOrmEntity, id, partial);

      if (dto.name && dto.name !== existing.name && existing.organizationId) {
        // Cascade the rename to member and invitation rows within this org.
        // user.role is platform-only (superadmin | null) and must NOT be updated.
        await manager.query(
          'UPDATE member SET role = $1 WHERE "organizationId" = $2 AND role = $3',
          [dto.name, existing.organizationId, existing.name],
        );
        await manager.query(
          'UPDATE invitation SET role = $1 WHERE "organizationId" = $2 AND role = $3',
          [dto.name, existing.organizationId, existing.name],
        );
      }

      const updated = await manager.findOne(RoleTypeOrmEntity, {
        where: { id },
      });
      return updated ? mapRole(updated) : null;
    });
  }

  async remove(id: string): Promise<void> {
    // Use a transaction with a row lock to eliminate the race condition between
    // the usage check in RoleService.delete() and the actual deletion.
    await this.dataSource.transaction(async (manager) => {
      const role = await manager
        .createQueryBuilder(RoleTypeOrmEntity, 'r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id })
        .getOne();
      if (!role) return;
      await manager.delete(RoleTypeOrmEntity, id);
    });
  }

  async getUsageSummary(roleId: string): Promise<RoleUsageSummary> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      return { users: 0, members: 0, invitations: 0 };
    }

    if (!role.organizationId) {
      const result = await this.dataSource.query<{ count: string }[]>(
        'SELECT COUNT(*)::text as count FROM "user" WHERE role = $1',
        [role.name],
      );
      return {
        users: result[0] ? parseInt(result[0].count, 10) : 0,
        members: 0,
        invitations: 0,
      };
    }

    const result = await this.dataSource.query<
      Array<{ users: string; members: string; invitations: string }>
    >(
      `SELECT
         (
           SELECT COUNT(*)::text
           FROM "user" u
           WHERE u.role = $2
             AND EXISTS (
               SELECT 1
               FROM member m
               WHERE m."userId" = u.id
                 AND m."organizationId" = $1
                 AND m.role = $2
             )
         ) as users,
         (
           SELECT COUNT(*)::text
           FROM member
           WHERE "organizationId" = $1 AND role = $2
         ) as members,
         (
           SELECT COUNT(*)::text
           FROM invitation
           WHERE "organizationId" = $1 AND role = $2
         ) as invitations`,
      [role.organizationId, role.name],
    );

    return {
      users: result[0] ? parseInt(result[0].users, 10) : 0,
      members: result[0] ? parseInt(result[0].members, 10) : 0,
      invitations: result[0] ? parseInt(result[0].invitations, 10) : 0,
    };
  }

  async getPermissions(roleId: string): Promise<Permission[]> {
    const role = await this.roleRepo.findOne({
      where: { id: roleId },
      relations: ['permissions'],
    });
    if (!role) return [];
    const sorted = [...(role.permissions ?? [])].sort((a, b) => {
      if (a.resource !== b.resource)
        return a.resource.localeCompare(b.resource);
      return a.action.localeCompare(b.action);
    });
    return sorted.map(mapPermission);
  }

  async setPermissions(roleId: string, permissionIds: string[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const role = await manager.findOne(RoleTypeOrmEntity, {
        where: { id: roleId },
        relations: ['permissions'],
      });
      if (!role) throw new NotFoundException(`Role ${roleId} not found`);
      const permissions =
        permissionIds.length > 0
          ? await manager.findBy(PermissionTypeOrmEntity, {
              id: In(permissionIds),
            })
          : [];
      role.permissions = permissions;
      await manager.save(RoleTypeOrmEntity, role);
    });
  }

  async hasPermission(
    roleName: string,
    resource: string,
    action: string,
    organizationId?: string | null,
  ): Promise<boolean> {
    // When an organizationId is provided, scope the look-up to that org's role row
    // to avoid matching a same-named role in a different organization.
    if (organizationId) {
      const result = await this.dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) as count FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE r.name = $1
           AND r.organization_id = $2
           AND p.resource = $3
           AND p.action = $4`,
        [roleName, organizationId, resource, action],
      );
      return result[0] ? parseInt(result[0].count, 10) > 0 : false;
    }

    // Global / platform role lookup (e.g. superadmin which has no org scope).
    const result = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) as count FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE r.name = $1 AND r.organization_id IS NULL
         AND p.resource = $2 AND p.action = $3`,
      [roleName, resource, action],
    );
    return result[0] ? parseInt(result[0].count, 10) > 0 : false;
  }

  async getMemberRoleInOrg(
    userId: string,
    organizationId: string,
  ): Promise<string | null> {
    const result = await this.dataSource.query<{ role: string }[]>(
      `SELECT m.role FROM member m WHERE m."userId" = $1 AND m."organizationId" = $2 LIMIT 1`,
      [userId, organizationId],
    );
    return result[0]?.role ?? null;
  }
}
