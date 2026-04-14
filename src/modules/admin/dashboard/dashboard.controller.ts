import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard, RequirePermissions } from '../../../shared';
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

  @Get('overview')
  @RequirePermissions('dashboard:view')
  getOverview(): Promise<OverviewStatsDto> {
    return this.dashboardService.getOverview();
  }

  @Get('users')
  @RequirePermissions('dashboard:view')
  getUserStats(@Query('range') range: Range = '30d'): Promise<UserStatsDto> {
    return this.dashboardService.getUserStats(range);
  }

  @Get('chat')
  @RequirePermissions('dashboard:view')
  getChatStats(@Query('range') range: Range = '30d'): Promise<ChatStatsDto> {
    return this.dashboardService.getChatStats(range);
  }

  @Get('organizations')
  @RequirePermissions('dashboard:view')
  getOrgStats(): Promise<OrgStatsDto> {
    return this.dashboardService.getOrgStats();
  }
}

