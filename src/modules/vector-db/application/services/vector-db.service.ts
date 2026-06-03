import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateKnowledgeBaseInput,
  IngestionJob,
  VectorDb,
  VectorDbRow,
  UpdateKnowledgeBaseInput,
} from '../../api/dto/vector-db.dto';
import {
  VECTOR_DB_REPOSITORY,
  type IngestionJobRow,
  type IVectorDbRepository,
} from '../../domain/vector-db.repository';
import {
  VECTOR_DB_FILE_UPLOADER,
  type IVectorDbFileUploader,
} from '../../domain/vector-db-file-uploader.port';
import {
  VECTOR_DB_ALLOWED_MIME_TYPES,
  VECTOR_DB_MAX_UPLOAD_SIZE,
} from '../../vector-db.constants';
import type { PlatformRole } from '../../../admin/utils/admin.utils';

type CallerScope = {
  userId: string;
  platformRole: PlatformRole;
  activeOrganizationId: string | null;
  organizationId?: string;
};

@Injectable()
export class VectorDbService {
  private readonly logger = new Logger(VectorDbService.name);

  constructor(
    @Inject(VECTOR_DB_REPOSITORY)
    private readonly repository: IVectorDbRepository,
    @Inject(VECTOR_DB_FILE_UPLOADER)
    private readonly fileUploader: IVectorDbFileUploader,
  ) {}

  async list(scope: CallerScope): Promise<VectorDb[]> {
    const orgId = await this.requireOrg(scope);
    const rows = await this.repository.listForOrganization(orgId);
    return rows.map(toPublic);
  }

  async getById(scope: CallerScope, id: string): Promise<VectorDb> {
    const orgId = await this.requireOrg(scope);
    const row = await this.repository.findByIdInOrg(id, orgId);
    if (!row) throw new NotFoundException('Vector database not found');
    return toPublic(row);
  }

  async create(
    scope: CallerScope,
    input: CreateKnowledgeBaseInput,
  ): Promise<VectorDb> {
    const orgId = await this.requireOrg(scope);
    this.validateCreateInput(input);

    const existing = await this.repository.findByOrganizationAndName(
      orgId,
      input.name,
    );
    if (existing) {
      throw new ConflictException(
        `A vector database named "${input.name}" already exists in this organization`,
      );
    }

    const id = randomUUID();
    const row = await this.repository.create({
      id,
      organizationId: orgId,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      vectorStoreKind: 'qdrant',
      vectorStoreRef: `vdb_${id.replace(/-/g, '')}`,
    });

    return toPublic(row);
  }

  async update(
    scope: CallerScope,
    id: string,
    input: UpdateKnowledgeBaseInput,
  ): Promise<VectorDb> {
    const orgId = await this.requireOrg(scope);
    this.validateUpdateInput(input);

    const existing = await this.repository.findByIdInOrg(id, orgId);
    if (!existing) throw new NotFoundException('Vector database not found');

    if (input.name && input.name !== existing.name) {
      const dup = await this.repository.findByOrganizationAndName(
        orgId,
        input.name,
      );
      if (dup && dup.id !== id) {
        throw new ConflictException(
          `A vector database named "${input.name}" already exists in this organization`,
        );
      }
    }

    const updated = await this.repository.update(id, {
      name: input.name?.trim(),
      description:
        input.description !== undefined
          ? (input.description?.trim() ?? null)
          : undefined,
    });

    return toPublic(updated);
  }

  async delete(scope: CallerScope, id: string): Promise<void> {
    const orgId = await this.requireOrg(scope);

    const existing = await this.repository.findByIdInOrg(id, orgId);
    if (!existing) throw new NotFoundException('Vector database not found');

    const referenceCount = await this.repository.countProjectReferences(id);
    if (referenceCount > 0) {
      throw new ConflictException(
        `Cannot delete vector database: ${referenceCount} project data source(s) still reference it. Detach them first.`,
      );
    }

    const deleted = await this.repository.delete(id, orgId);
    if (!deleted) throw new NotFoundException('Vector database not found');
  }

  async uploadFile(
    scope: CallerScope,
    id: string,
    file: Express.Multer.File,
  ): Promise<IngestionJob> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    if (!VECTOR_DB_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `File type '${file.mimetype}' is not allowed. Accepted types: pdf, txt, md, csv, json, docx`,
      );
    }
    if (file.size > VECTOR_DB_MAX_UPLOAD_SIZE) {
      throw new BadRequestException('File exceeds the maximum size of 50 MB');
    }

    const orgId = await this.requireOrg(scope);
    const existing = await this.repository.findByIdInOrg(id, orgId);
    if (!existing) throw new NotFoundException('Vector database not found');

    const s3Key = `vector-dbs/${orgId}/${id}/${randomUUID()}`;

    // Log s3Key before the put so operators can correlate an orphan on DB failure.
    this.logger.log('Uploading file to S3', { s3Key, vectorDbId: id, organizationId: orgId });

    await this.fileUploader.put(s3Key, file.buffer, file.mimetype, file.originalname);

    // If this throws, the S3 object at s3Key is orphaned. The log line above
    // gives operators the key for manual cleanup until the Slice 4 janitor ships.
    const jobRow = await this.repository.createIngestionJob({
      vectorDbId: id,
      s3Key,
      originalFilename: file.originalname,
      fileSizeBytes: file.size,
      contentType: file.mimetype,
    });
    await this.repository.incrementDocumentCount(id, 1);

    this.logger.log('File upload queued', {
      jobId: jobRow.id,
      vectorDbId: id,
      organizationId: orgId,
      s3Key,
    });

    return toPublicJob(jobRow);
  }

  async listFiles(scope: CallerScope, id: string): Promise<IngestionJob[]> {
    const orgId = await this.requireOrg(scope);
    const existing = await this.repository.findByIdInOrg(id, orgId);
    if (!existing) throw new NotFoundException('Vector database not found');
    const rows = await this.repository.listJobsForVectorDb(id);
    return rows.map(toPublicJob);
  }

  async deleteFile(
    scope: CallerScope,
    id: string,
    jobId: string,
  ): Promise<void> {
    const orgId = await this.requireOrg(scope);
    const existing = await this.repository.findByIdInOrg(id, orgId);
    if (!existing) throw new NotFoundException('Vector database not found');

    const job = await this.repository.findIngestionJobById(jobId, id);
    if (!job) throw new NotFoundException('File not found');

    await this.repository.deleteIngestionJob(jobId, id);
    await this.repository.decrementDocumentCount(id, 1);

    try {
      await this.fileUploader.delete(job.s3_key);
    } catch (err) {
      this.logger.warn('Failed to delete S3 object — orphaned blob', {
        jobId,
        vectorDbId: id,
        s3Key: job.s3_key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async findByIdForAttach(
    organizationId: string,
    id: string,
  ): Promise<VectorDb | null> {
    const row = await this.repository.findByIdInOrg(id, organizationId);
    return row ? toPublic(row) : null;
  }

  async findManyByIdsForOrg(
    organizationId: string,
    ids: string[],
  ): Promise<VectorDb[]> {
    const rows = await this.repository.findManyByIdsForOrg(ids, organizationId);
    return rows.map(toPublic);
  }

  private async requireOrg(scope: CallerScope): Promise<string> {
    if (scope.platformRole === 'superadmin') {
      const orgId = scope.organizationId ?? scope.activeOrganizationId;
      if (!orgId) {
        throw new BadRequestException(
          'organizationId is required for superadmin vector database calls',
        );
      }
      await this.repository.assertOrganizationExists(orgId);
      return orgId;
    }
    const activeOrg = scope.activeOrganizationId;
    if (!activeOrg) {
      throw new ForbiddenException('Active organization required');
    }
    if (scope.organizationId && scope.organizationId !== activeOrg) {
      throw new ForbiddenException(
        'You can only manage vector databases in your active organization',
      );
    }
    return activeOrg;
  }

  private validateCreateInput(input: CreateKnowledgeBaseInput): void {
    if (!input.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (input.name.trim().length > 255) {
      throw new BadRequestException('name must be 255 characters or fewer');
    }
  }

  private validateUpdateInput(input: UpdateKnowledgeBaseInput): void {
    if (input.name !== undefined && !input.name?.trim()) {
      throw new BadRequestException('name cannot be blank');
    }
    if (input.name !== undefined && input.name.trim().length > 255) {
      throw new BadRequestException('name must be 255 characters or fewer');
    }
  }
}

function toPublicJob(row: IngestionJobRow): IngestionJob {
  return {
    id: row.id,
    vectorDbId: row.vector_db_id,
    s3Key: row.s3_key,
    originalFilename: row.original_filename,
    fileSizeBytes: row.file_size_bytes,
    contentType: row.content_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPublic(row: VectorDbRow): VectorDb {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    vectorStoreKind: row.vector_store_kind,
    vectorStoreRef: row.vector_store_ref,
    status: row.status,
    statusError: row.status_error,
    documentCount: row.document_count,
    version: row.version,
    processingStartedAt: row.processing_started_at,
    lastIngestedAt: row.last_ingested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
