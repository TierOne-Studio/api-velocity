import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IPermissionRepository } from '../../../domain/repositories/permission.repository.interface';
import { Permission } from '../../../domain/entities/role.entity';
import { PermissionTypeOrmEntity } from '../entities/permission.typeorm-entity';

function mapPermission(e: PermissionTypeOrmEntity): Permission {
  return {
    id: e.id,
    resource: e.resource,
    action: e.action,
    description: e.description,
  };
}

@Injectable()
export class TypeOrmPermissionRepository implements IPermissionRepository {
  constructor(
    @InjectRepository(PermissionTypeOrmEntity)
    private readonly permissionRepo: Repository<PermissionTypeOrmEntity>,
  ) {}

  async findAll(): Promise<Permission[]> {
    const entities = await this.permissionRepo.find({
      order: { resource: 'ASC', action: 'ASC' },
    });
    return entities.map(mapPermission);
  }

  async findById(id: string): Promise<Permission | null> {
    const entity = await this.permissionRepo.findOne({ where: { id } });
    return entity ? mapPermission(entity) : null;
  }

  async findByResourceAction(
    resource: string,
    action: string,
  ): Promise<Permission | null> {
    const entity = await this.permissionRepo.findOne({
      where: { resource, action },
    });
    return entity ? mapPermission(entity) : null;
  }

  async findGroupedByResource(): Promise<Record<string, Permission[]>> {
    const permissions = await this.findAll();
    return permissions.reduce(
      (acc, perm) => {
        if (!acc[perm.resource]) {
          acc[perm.resource] = [];
        }
        acc[perm.resource].push(perm);
        return acc;
      },
      {} as Record<string, Permission[]>,
    );
  }

  async create(
    resource: string,
    action: string,
    description?: string,
  ): Promise<Permission> {
    const entity = this.permissionRepo.create({
      resource,
      action,
      description: description ?? null,
    });
    const saved = await this.permissionRepo.save(entity);
    return mapPermission(saved);
  }
}
