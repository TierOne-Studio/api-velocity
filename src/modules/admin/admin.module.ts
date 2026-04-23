import { Module } from '@nestjs/common';
import { EmailModule } from '../../shared/email/email.module';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { SqlConnectionsModule } from '../sql-connections/sql-connections.module';

// Users sub-domain
import { AdminUsersController } from './users/api/controllers/admin-users.controller';
import { AdminService } from './users/application/services/admin.service';
import { ADMIN_USER_REPOSITORY } from './users/domain/repositories/admin-user.repository.interface';
import { AdminUserDatabaseRepository } from './users/infrastructure/persistence/repositories/admin-user.database-repository';

// Sessions sub-domain
import { SessionsController } from './sessions/api/controllers/sessions.controller';
import { SessionsService } from './sessions/application/services/sessions.service';
import { SESSION_REPOSITORY } from './sessions/domain/repositories/session.repository.interface';
import { SessionDatabaseRepository } from './sessions/infrastructure/persistence/repositories/session.database-repository';

// Organizations sub-domain
import { AdminOrganizationsController } from './organizations/api/controllers/admin-organizations.controller';
import { OrgImpersonationController } from './organizations/api/controllers/org-impersonation.controller';
import { AdminOrganizationsService } from './organizations/application/services/admin-organizations.service';
import { OrgImpersonationService } from './organizations/application/services/org-impersonation.service';
import { ADMIN_ORG_REPOSITORY } from './organizations/domain/repositories/admin-org.repository.interface';
import { AdminOrgDatabaseRepository } from './organizations/infrastructure/persistence/repositories/admin-org.database-repository';

// RBAC sub-domain (re-exported as separate @Global module)
export { RbacModule } from './rbac/rbac.module';

// Dashboard sub-domain
import { DashboardModule } from './dashboard/dashboard.module';

/**
 * Admin Module for platform-level administration.
 * Sub-domains:
 * - users: CRUD, role assignment, banning, password management.
 * - sessions: list, revoke, revoke-all.
 * - organizations: CRUD, members, invitations, impersonation.
 * - rbac: role & permission management (separate @Global module).
 * Requires admin or manager platform role.
 */
@Module({
  imports: [EmailModule, DatabaseModule, DashboardModule, SqlConnectionsModule],
  controllers: [
    AdminUsersController,
    SessionsController,
    AdminOrganizationsController,
    OrgImpersonationController,
  ],
  providers: [
    AdminService,
    SessionsService,
    AdminOrganizationsService,
    OrgImpersonationService,
    { provide: ADMIN_USER_REPOSITORY, useClass: AdminUserDatabaseRepository },
    { provide: SESSION_REPOSITORY, useClass: SessionDatabaseRepository },
    { provide: ADMIN_ORG_REPOSITORY, useClass: AdminOrgDatabaseRepository },
  ],
  exports: [
    AdminService,
    SessionsService,
    AdminOrganizationsService,
    OrgImpersonationService,
  ],
})
export class AdminModule {}
