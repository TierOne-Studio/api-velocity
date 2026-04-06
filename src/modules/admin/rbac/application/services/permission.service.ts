import { Injectable, Inject } from '@nestjs/common';
import { Permission } from '../../domain/entities/role.entity';
import { PERMISSION_REPOSITORY } from '../../domain/repositories/permission.repository.interface';
import type { IPermissionRepository } from '../../domain/repositories/permission.repository.interface';

/**
 * Service for managing permissions in the RBAC system
 */
@Injectable()
export class PermissionService {
  constructor(
    @Inject(PERMISSION_REPOSITORY)
    private readonly permissionRepo: IPermissionRepository,
  ) {}

  /**
   * Get all permissions
   */
  async findAll(): Promise<Permission[]> {
    return this.permissionRepo.findAll();
  }

  /**
   * Find permission by ID
   */
  async findById(id: string): Promise<Permission | null> {
    return this.permissionRepo.findById(id);
  }

  /**
   * Find permission by resource and action
   */
  async findByResourceAction(
    resource: string,
    action: string,
  ): Promise<Permission | null> {
    return this.permissionRepo.findByResourceAction(resource, action);
  }

  /**
   * Get permissions grouped by resource
   */
  async findGroupedByResource(): Promise<Record<string, Permission[]>> {
    return this.permissionRepo.findGroupedByResource();
  }

  /**
   * Create a new permission (for extensibility)
   */
  async create(
    resource: string,
    action: string,
    description?: string,
  ): Promise<Permission> {
    return this.permissionRepo.create(resource, action, description);
  }
}
