import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PermissionsGuard, RequirePermissions } from '../../../../../shared';
import { SessionsService } from '../../application/services/sessions.service';
import {
  getPlatformRole,
  requireActiveOrganizationIdForManager,
} from '../../../users/utils/admin.utils';

@Controller('api/admin/users')
@UseGuards(PermissionsGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  private validateRevokeSessionPayload(body: { sessionToken: string }): void {
    if (!body?.sessionToken?.trim()) {
      throw new HttpException('sessionToken is required', HttpStatus.BAD_REQUEST);
    }
  }

  @Get(':userId/sessions')
  @RequirePermissions('session:read')
  async listSessions(@Session() session: UserSession, @Param('userId') userId: string) {
    const platformRole = getPlatformRole(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.sessionsService.listUserSessions({
      userId,
      platformRole,
      activeOrganizationId: activeOrgId,
    });
  }

  @Post('sessions/revoke')
  @RequirePermissions('session:revoke')
  async revokeSession(@Session() session: UserSession, @Body() body: { sessionToken: string }) {
    this.validateRevokeSessionPayload(body);

    const platformRole = getPlatformRole(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.sessionsService.revokeSession({ sessionToken: body.sessionToken }, platformRole, activeOrgId);
  }

  @Post(':userId/sessions/revoke-all')
  @RequirePermissions('session:revoke')
  async revokeAll(@Session() session: UserSession, @Param('userId') userId: string) {
    const platformRole = getPlatformRole(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.sessionsService.revokeAllSessions({ userId }, platformRole, activeOrgId);
  }
}
