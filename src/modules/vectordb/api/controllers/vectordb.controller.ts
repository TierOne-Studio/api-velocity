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
import { VectordbService } from '../../application/services/vectordb.service';
import type {
  CreateKnowledgeBaseInput,
  UpdateKnowledgeBaseInput,
} from '../dto/vectordb.dto';

@Controller('api/vectordbs')
@UseGuards(PermissionsGuard)
export class VectordbController {
  constructor(private readonly service: VectordbService) {}

  @Get()
  @RequirePermissions('vectordb:read')
  async list(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
  ) {
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.list(scope);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('vectordb:read')
  async getById(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.getById(scope, id);
    return { data };
  }

  @Post()
  @RequirePermissions('vectordb:create')
  async create(
    @Session() session: UserSession,
    @Body() body: CreateKnowledgeBaseInput & { organizationId?: string },
  ) {
    this.assertObject(body, 'body');
    const { organizationId, ...input } = body;
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.create(scope, input);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('vectordb:update')
  async update(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: UpdateKnowledgeBaseInput & { organizationId?: string },
  ) {
    this.assertObject(body, 'body');
    const { organizationId, ...input } = body;
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.update(scope, id, input);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('vectordb:delete')
  async remove(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const scope = this.buildScope(session, organizationId);
    return this.service.delete(scope, id);
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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${label} must be an object`);
    }
  }
}
