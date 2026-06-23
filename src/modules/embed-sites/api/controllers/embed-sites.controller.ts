import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import {
  EmbedSitesService,
  type EmbedSitesCallerScope,
} from '../../application/embed-sites.service';
import type {
  CreateEmbedSiteInput,
  UpdateEmbedSiteInput,
} from '../dto/embed-site.dto';

/**
 * Admin CRUD for embed sites (SPEC-003 Slice 2). Every route is RBAC-gated by an
 * `embed-site:*` scope and org-scoped in the service. This is the FIRST-PARTY
 * channel — distinct from the anonymous public `api/public/chat/*` surface.
 */
@Controller('api/embed-sites')
@UseGuards(PermissionsGuard)
export class EmbedSitesController {
  constructor(private readonly service: EmbedSitesService) {}

  @Get()
  @RequirePermissions('embed-site:read')
  async list(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
  ) {
    const data = await this.service.list(this.buildScope(session, organizationId));
    return { data };
  }

  @Get(':id')
  @RequirePermissions('embed-site:read')
  async getById(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const data = await this.service.getById(
      this.buildScope(session, organizationId),
      id,
    );
    return { data };
  }

  @Post()
  @RequirePermissions('embed-site:create')
  async create(
    @Session() session: UserSession,
    @Body() body: CreateEmbedSiteInput & { organizationId?: string },
  ) {
    this.assertObject(body, 'body');
    const { organizationId, ...input } = body;
    const data = await this.service.create(
      this.buildScope(session, organizationId),
      input,
    );
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('embed-site:update')
  async update(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: UpdateEmbedSiteInput & { organizationId?: string },
  ) {
    this.assertObject(body, 'body');
    const { organizationId, ...input } = body;
    const data = await this.service.update(
      this.buildScope(session, organizationId),
      id,
      input,
    );
    return { data };
  }

  // Rotation mutates a site attribute (the publishable key), so it is gated on
  // embed-site:update — not a separate action. It invalidates the old key on the
  // public channel from the next request (the guard reads the live row, no cache).
  @Post(':id/rotate-key')
  @RequirePermissions('embed-site:update')
  async rotateKey(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const data = await this.service.rotateKey(
      this.buildScope(session, organizationId),
      id,
    );
    return { data };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('embed-site:delete')
  async remove(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ): Promise<void> {
    await this.service.delete(this.buildScope(session, organizationId), id);
  }

  private buildScope(
    session: UserSession,
    organizationId?: string,
  ): EmbedSitesCallerScope {
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
