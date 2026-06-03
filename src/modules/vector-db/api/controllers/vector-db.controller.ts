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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PermissionsGuard, RequirePermissions } from '../../../../shared';
import {
  getActiveOrganizationId,
  getPlatformRole,
} from '../../../admin/utils/admin.utils';
import { VectorDbService } from '../../application/services/vector-db.service';
import { VECTOR_DB_MAX_UPLOAD_SIZE } from '../../vector-db.constants';
import type {
  CreateKnowledgeBaseInput,
  UpdateKnowledgeBaseInput,
} from '../dto/vector-db.dto';

@Controller('api/vector-dbs')
@UseGuards(PermissionsGuard)
export class VectorDbController {
  constructor(private readonly service: VectorDbService) {}

  @Get()
  @RequirePermissions('vector-db:read')
  async list(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
  ) {
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.list(scope);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('vector-db:read')
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
  @RequirePermissions('vector-db:create')
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
  @RequirePermissions('vector-db:update')
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

  @Post(':id/upload')
  @HttpCode(201)
  @RequirePermissions('vector-db:upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: VECTOR_DB_MAX_UPLOAD_SIZE } }),
  )
  async upload(
    @Session() session: UserSession,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('organizationId') organizationId?: string,
  ) {
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.uploadFile(scope, id, file);
    return { data };
  }

  @Get(':id/files')
  @RequirePermissions('vector-db:read')
  async listFiles(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const scope = this.buildScope(session, organizationId);
    const data = await this.service.listFiles(scope, id);
    return { data };
  }

  @Delete(':id/files/:jobId')
  @HttpCode(204)
  @RequirePermissions('vector-db:upload')
  async deleteFile(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @Query('organizationId') organizationId?: string,
  ): Promise<void> {
    const scope = this.buildScope(session, organizationId);
    await this.service.deleteFile(scope, id, jobId);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('vector-db:delete')
  async remove(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('organizationId') organizationId?: string,
  ): Promise<void> {
    const scope = this.buildScope(session, organizationId);
    await this.service.delete(scope, id);
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
