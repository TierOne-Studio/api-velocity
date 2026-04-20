import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { RequirePermissions, PermissionsGuard } from '../../../../shared';
import {
  getActiveOrganizationId,
  getPlatformRole,
  type PlatformRole,
} from '../../../admin/users/utils/admin.utils';
import { ProjectsService } from '../../application/services/projects.service';
import type {
  CreateDataSourceInput,
  CreateProjectInput,
  UpdateProjectInput,
} from '../dto/project.dto';

type CreateProjectBody = Partial<CreateProjectInput>;

type UpdateProjectBody = Partial<UpdateProjectInput>;

@Controller('api/projects')
@UseGuards(PermissionsGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  private getScope(
    session: UserSession,
    organizationId?: string,
  ): {
    userId: string;
    platformRole: PlatformRole;
    activeOrganizationId: string | null;
    organizationId?: string;
  } {
    const platformRole = getPlatformRole(session);
    const activeOrganizationId = getActiveOrganizationId(session);

    if (platformRole !== 'superadmin' && !activeOrganizationId) {
      throw new HttpException(
        'Active organization required',
        HttpStatus.FORBIDDEN,
      );
    }

    return {
      userId: session.user.id,
      platformRole,
      activeOrganizationId,
      organizationId,
    };
  }

  @Get()
  @RequirePermissions('project:read')
  async list(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
  ) {
    return {
      data: await this.projectsService.listForScope(
        this.getScope(session, organizationId),
      ),
    };
  }

  @Get(':id')
  @RequirePermissions('project:read')
  async get(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return {
      data: await this.projectsService.getById(
        id,
        this.getScope(session, organizationId),
      ),
    };
  }

  @Post()
  @RequirePermissions('project:create')
  async create(
    @Session() session: UserSession,
    @Body() body: CreateProjectBody,
  ) {
    if (!body.organizationId || !body.name) {
      throw new HttpException(
        'organizationId and name are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      data: await this.projectsService.create(body as CreateProjectInput, {
        ...this.getScope(session, body.organizationId),
      }),
    };
  }

  @Patch(':id')
  @RequirePermissions('project:update')
  async update(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: UpdateProjectBody,
    @Query('organizationId') organizationId?: string,
  ) {
    return {
      data: await this.projectsService.update(
        id,
        body,
        this.getScope(session, organizationId),
      ),
    };
  }

  @Delete(':id')
  @RequirePermissions('project:delete')
  async delete(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.projectsService.delete(
      id,
      this.getScope(session, organizationId),
    );
  }

  @Post(':id/sources')
  @RequirePermissions('project:update')
  async addSource(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: CreateDataSourceInput,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!body?.kind) {
      throw new HttpException('kind is required', HttpStatus.BAD_REQUEST);
    }
    return {
      data: await this.projectsService.addSource(
        id,
        body,
        this.getScope(session, organizationId),
      ),
    };
  }

  @Delete(':id/sources/:sourceId')
  @RequirePermissions('project:update')
  async removeSource(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.projectsService.removeSource(
      id,
      sourceId,
      this.getScope(session, organizationId),
    );
  }
}
