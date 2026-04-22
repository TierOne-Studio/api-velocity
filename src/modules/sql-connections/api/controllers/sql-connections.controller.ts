import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PermissionsGuard, RequirePermissions } from '../../../../shared';
import {
  getActiveOrganizationId,
  getPlatformRole,
} from '../../../admin/utils/admin.utils';
import { SqlConnectionsService } from '../../application/services/sql-connections.service';
import type {
  CreateSqlConnectionInput,
  UpdateSqlConnectionInput,
} from '../dto/sql-connection.dto';

@Controller('api/sql-connections')
@UseGuards(PermissionsGuard)
export class SqlConnectionsController {
  constructor(private readonly service: SqlConnectionsService) {}

  @Get()
  @RequirePermissions('organization:read')
  async list(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
  ) {
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.list(scope);
    return { data };
  }

  @Post()
  @RequirePermissions('organization:update')
  async create(
    @Session() session: UserSession,
    @Body() body: CreateSqlConnectionInput & { organizationId?: string },
  ) {
    this.assertObject(body, 'body');
    const { organizationId, ...input } = body;
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.create(scope, input);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('organization:update')
  async update(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: UpdateSqlConnectionInput & { organizationId?: string },
  ) {
    this.assertObject(body, 'body');
    const { organizationId, ...input } = body;
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.update(scope, id, input);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('organization:update')
  async remove(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const scope = this.buildScope(session, organizationId);
    return this.service.delete(scope, id);
  }

  @Post(':id/test')
  @RequirePermissions('organization:update')
  async test(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.testById(scope, id);
    return { data };
  }

  private buildScope(session: UserSession, organizationId?: string) {
    return {
      userId: session.user.id,
      platformRole: getPlatformRole(session),
      activeOrganizationId: getActiveOrganizationId(session),
      organizationId: organizationId?.trim() || undefined,
    };
  }

  private assertObject(value: unknown, label: string): void {
    if (!value || typeof value !== 'object') {
      throw new BadRequestException(`${label} must be an object`);
    }
  }
}
