import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { IRoleRepository } from '../../../domain/repositories/role.repository.interface';
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
    isSystem: e.isSystem,
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

  async findAll(activeOrganizationId: string): Promise<Role[]> {
    const entities = await this.roleRepo.find({
      where: [{ isSystem: true }, { organizationId: activeOrganizationId }],
      order: { isSystem: 'DESC', name: 'ASC' },
    });
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

  async findByNameInOrganization(name: string, activeOrganizationId: string): Promise<Role | null> {
    const entity = await this.roleRepo.findOne({
      where: { name, organizationId: activeOrganizationId },
    });
    return entity ? mapRole(entity) : null;
  }

  async create(dto: CreateRoleDto, activeOrganizationId: string): Promise<Role> {
    const entity = this.roleRepo.create({
      name: dto.name,
      displayName: dto.displayName,
      description: dto.description ?? null,
      color: dto.color ?? 'gray',
      isSystem: false,
      organizationId: activeOrganizationId,
    });
    const saved = await this.roleRepo.save(entity);
    return mapRole(saved);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role | null> {
    const partial: Partial<RoleTypeOrmEntity> = {};
    if (dto.displayName !== undefined) partial.displayName = dto.displayName;
    if (dto.description !== undefined) partial.description = dto.description;
    if (dto.color !== undefined) partial.color = dto.color;

    await this.roleRepo.update(id, partial);
    const updated = await this.roleRepo.findOne({ where: { id } });
    return updated ? mapRole(updated) : null;
  }

  async remove(id: string): Promise<void> {
    await this.roleRepo.delete(id);
  }

  async getPermissions(roleId: string): Promise<Permission[]> {
    const role = await this.roleRepo.findOne({
      where: { id: roleId },
      relations: ['permissions'],
    });
    if (!role) return [];
    const sorted = [...(role.permissions ?? [])].sort((a, b) => {
      if (a.resource !== b.resource) return a.resource.localeCompare(b.resource);
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
          ? await manager.findBy(PermissionTypeOrmEntity, { id: In(permissionIds) })
          : [];
      role.permissions = permissions;
      await manager.save(RoleTypeOrmEntity, role);
    });
  }

  async hasPermission(roleName: string, resource: string, action: string): Promise<boolean> {
    const result = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) as count FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE r.name = $1 AND p.resource = $2 AND p.action = $3`,
      [roleName, resource, action],
    );
    return result[0] ? parseInt(result[0].count, 10) > 0 : false;
  }
}
