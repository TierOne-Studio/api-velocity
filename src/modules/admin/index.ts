// Module exports
export { AdminModule, RbacModule } from './admin.module';

// Users sub-domain
export { AdminService } from './users/application/services';
export type { CreateUserInput } from './users/application/services';
export { AdminUsersController } from './users/api/controllers';
export {
  getPlatformRole,
  getActiveOrganizationId,
  requireActiveOrganizationIdForManager,
  getAllowedRoleNamesForCreator,
} from './users/utils';
export type { PlatformRole } from './users/utils';

// Sessions sub-domain
export { SessionsService } from './sessions/application/services';
export { SessionsController } from './sessions/api/controllers';

// Organizations sub-domain
export {
  AdminOrganizationsService,
  ROLE_HIERARCHY,
  getRoleLevel,
  filterAssignableRoles,
} from './organizations/application/services';
export type { PaginatedResult } from './organizations/application/services';
export { AdminOrganizationsController } from './organizations/api/controllers';
export { OrgImpersonationController } from './organizations/api/controllers';
export { OrgImpersonationService } from './organizations/application/services';
export {
  PaginationQuery,
  UpdateOrganizationDto,
  rowToOrganization,
} from './organizations/api/dto';
export type {
  OrganizationRow,
  Organization,
  MemberRow,
  OrganizationWithMemberCount,
} from './organizations/api/dto';
export { ImpersonateUserDto } from './organizations/api/dto';
export type { OrgMember } from './organizations/api/dto';
