import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacController } from './api/controllers/rbac.controller';
import { RoleService, PermissionService } from './application/services';
import { RbacMigrationService } from './rbac.migration';
import { ROLE_REPOSITORY } from './domain/repositories/role.repository.interface';
import { PERMISSION_REPOSITORY } from './domain/repositories/permission.repository.interface';
import { RoleTypeOrmEntity } from './infrastructure/persistence/entities/role.typeorm-entity';
import { PermissionTypeOrmEntity } from './infrastructure/persistence/entities/permission.typeorm-entity';
import { TypeOrmRoleRepository } from './infrastructure/persistence/repositories/role.typeorm-repository';
import { TypeOrmPermissionRepository } from './infrastructure/persistence/repositories/permission.typeorm-repository';

/**
 * RBAC Module for role-based access control.
 * Marked @Global() so RoleService and PermissionService are available
 * across the app (e.g., PermissionsGuard in SharedModule).
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([RoleTypeOrmEntity, PermissionTypeOrmEntity]),
  ],
  controllers: [RbacController],
  providers: [
    RoleService,
    PermissionService,
    RbacMigrationService,
    { provide: ROLE_REPOSITORY, useClass: TypeOrmRoleRepository },
    { provide: PERMISSION_REPOSITORY, useClass: TypeOrmPermissionRepository },
  ],
  exports: [RoleService, PermissionService],
})
export class RbacModule {}
