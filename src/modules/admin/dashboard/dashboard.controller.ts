import {
  Controller,
  Get,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PermissionsGuard, RequirePermissions } from '../../../shared';
import { getPlatformRole } from '../utils/admin.utils';
import { DashboardService } from './dashboard.service';
import { OverviewStatsDto } from './dto/overview-stats.dto';
import { UserStatsDto } from './dto/user-stats.dto';
import { ChatStatsDto } from './dto/chat-stats.dto';
import { OrgStatsDto } from './dto/org-stats.dto';

type Range = '7d' | '30d' | '90d';

@Controller('api/admin/dashboard')
@UseGuards(PermissionsGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  private async resolveOrgAccess(
    session: UserSession,
    organizationId?: string,
  ): Promise<{ isSuperadmin: boolean; scopedOrgId: string | null }> {
    const isSuperadmin = getPlatformRole(session) === 'superadmin';
    if (!organizationId) {
      return { isSuperadmin, scopedOrgId: null };
    }
    if (!isSuperadmin) {
      const hasAccess = await this.dashboardService.validateOrgAccess(
        session.user.id,
        organizationId,
      );
      if (!hasAccess) {
        throw new ForbiddenException(
          'Access to this organization is not permitted',
        );
      }
    }
    return { isSuperadmin, scopedOrgId: organizationId };
  }

  @Get('organizations/list')
  @RequirePermissions('dashboard:view')
  async getAvailableOrganizations(
    @Session() session: UserSession,
  ): Promise<Array<{ id: string; name: string; slug: string }>> {
    const isSuperadmin = getPlatformRole(session) === 'superadmin';
    return this.dashboardService.getAvailableOrganizations(
      session.user.id,
      isSuperadmin,
    );
  }

  @Get('overview')
  @RequirePermissions('dashboard:view')
  async getOverview(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
  ): Promise<OverviewStatsDto> {
    const { scopedOrgId } = await this.resolveOrgAccess(
      session,
      organizationId,
    );
    return this.dashboardService.getOverview(scopedOrgId);
  }

  @Get('users')
  @RequirePermissions('dashboard:view')
  async getUserStats(
    @Session() session: UserSession,
    @Query('range') range: Range = '30d',
    @Query('organizationId') organizationId?: string,
  ): Promise<UserStatsDto> {
    const { scopedOrgId } = await this.resolveOrgAccess(
      session,
      organizationId,
    );
    return this.dashboardService.getUserStats(range, scopedOrgId);
  }

  @Get('chat')
  @RequirePermissions('dashboard:view')
  async getChatStats(
    @Session() session: UserSession,
    @Query('range') range: Range = '30d',
    @Query('organizationId') organizationId?: string,
  ): Promise<ChatStatsDto> {
    const { scopedOrgId } = await this.resolveOrgAccess(
      session,
      organizationId,
    );
    return this.dashboardService.getChatStats(range, scopedOrgId);
  }

  @Get('organizations')
  @RequirePermissions('dashboard:view')
  async getOrgStats(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
  ): Promise<OrgStatsDto> {
    const { scopedOrgId } = await this.resolveOrgAccess(
      session,
      organizationId,
    );
    return this.dashboardService.getOrgStats(scopedOrgId);
  }
}
