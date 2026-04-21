import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PermissionsGuard, RequirePermissions } from '../../../../../shared';
import { SessionsService } from '../../application/services/sessions.service';
import {
  getPlatformRole,
  requireActiveOrganizationIdForManager,
  type PlatformRole,
} from '../../../users/utils/admin.utils';

@Controller('api/admin/users')
@UseGuards(PermissionsGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  private validateRevokeSessionPayload(body: { sessionToken: string }): void {
    if (!body?.sessionToken?.trim()) {
      throw new HttpException(
        'sessionToken is required',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Resolve the scoped organization for a sessions request.
   *
   * Rules (additive — preserves pre-existing behavior when no query is given):
   *  - superadmin + no `?organizationId`  → null (cross-org, current behavior)
   *  - superadmin + `?organizationId=X`   → X (enforce check against that org)
   *  - non-superadmin + no query          → active org (current behavior)
   *  - non-superadmin + mismatching query → 403 Forbidden
   */
  private resolveScope(
    session: UserSession,
    organizationId?: string,
  ): { platformRole: PlatformRole; scopedOrganizationId: string | null } {
    const platformRole = getPlatformRole(session);
    const explicit = organizationId?.trim() || null;

    if (platformRole === 'superadmin') {
      return { platformRole, scopedOrganizationId: explicit };
    }

    const activeOrgId = requireActiveOrganizationIdForManager(
      platformRole,
      session,
    );
    if (explicit && explicit !== activeOrgId) {
      throw new ForbiddenException(
        'You can only manage sessions in your active organization',
      );
    }
    return { platformRole, scopedOrganizationId: activeOrgId };
  }

  @Get(':userId/sessions')
  @RequirePermissions('session:read')
  async listSessions(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const { platformRole, scopedOrganizationId } = this.resolveScope(
      session,
      organizationId,
    );
    return this.sessionsService.listUserSessions({
      userId,
      platformRole,
      activeOrganizationId: scopedOrganizationId,
    });
  }

  @Post('sessions/revoke')
  @RequirePermissions('session:revoke')
  async revokeSession(
    @Session() session: UserSession,
    @Body() body: { sessionToken: string },
    @Query('organizationId') organizationId?: string,
  ) {
    this.validateRevokeSessionPayload(body);

    const { platformRole, scopedOrganizationId } = this.resolveScope(
      session,
      organizationId,
    );
    return this.sessionsService.revokeSession(
      { sessionToken: body.sessionToken },
      platformRole,
      scopedOrganizationId,
    );
  }

  @Post(':userId/sessions/revoke-all')
  @RequirePermissions('session:revoke')
  async revokeAll(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const { platformRole, scopedOrganizationId } = this.resolveScope(
      session,
      organizationId,
    );
    return this.sessionsService.revokeAllSessions(
      { userId },
      platformRole,
      scopedOrganizationId,
    );
  }
}
