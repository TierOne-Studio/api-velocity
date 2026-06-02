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
  VectorDb,
  VectorDbRow,
  UpdateKnowledgeBaseInput,
} from '../../api/dto/vector-db.dto';
import {
  VECTOR_DB_REPOSITORY,
  type IVectorDbRepository,
} from '../../domain/vector-db.repository';
import type { PlatformRole } from '../../../admin/users/utils/admin.utils';

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
  ) {}

  async list(scope: CallerScope): Promise<VectorDb[]> {
    const orgId = this.requireOrg(scope);
    const rows = await this.repository.listForOrganization(orgId);
    return rows.map(toPublic);
  }

  async getById(scope: CallerScope, id: string): Promise<VectorDb> {
    const orgId = this.requireOrg(scope);
    const row = await this.repository.findByIdInOrg(id, orgId);
    if (!row) throw new NotFoundException('Knowledge base not found');
    return toPublic(row);
  }

  async create(
    scope: CallerScope,
    input: CreateKnowledgeBaseInput,
  ): Promise<VectorDb> {
    const orgId = this.requireOrg(scope);
    this.validateCreateInput(input);

    const existing = await this.repository.findByOrganizationAndName(
      orgId,
      input.name,
    );
    if (existing) {
      throw new ConflictException(
        `A knowledge base named "${input.name}" already exists in this organization`,
      );
    }

    const id = randomUUID();
    const row = await this.repository.create({
      id,
      organizationId: orgId,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      qdrantCollection: `kb_${id.replace(/-/g, '')}`,
    });

    return toPublic(row);
  }

  async update(
    scope: CallerScope,
    id: string,
    input: UpdateKnowledgeBaseInput,
  ): Promise<VectorDb> {
    const orgId = this.requireOrg(scope);
    this.validateUpdateInput(input);

    const existing = await this.repository.findByIdInOrg(id, orgId);
    if (!existing) throw new NotFoundException('Knowledge base not found');

    if (input.name && input.name !== existing.name) {
      const dup = await this.repository.findByOrganizationAndName(
        orgId,
        input.name,
      );
      if (dup && dup.id !== id) {
        throw new ConflictException(
          `A knowledge base named "${input.name}" already exists in this organization`,
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

  async delete(
    scope: CallerScope,
    id: string,
  ): Promise<{ deleted: boolean }> {
    const orgId = this.requireOrg(scope);

    const existing = await this.repository.findByIdInOrg(id, orgId);
    if (!existing) throw new NotFoundException('Knowledge base not found');

    const referenceCount = await this.repository.countProjectReferences(id);
    if (referenceCount > 0) {
      throw new ConflictException(
        `Cannot delete knowledge base: ${referenceCount} project data source(s) still reference it. Detach them first.`,
      );
    }

    const deleted = await this.repository.delete(id, orgId);
    if (!deleted) throw new NotFoundException('Knowledge base not found');
    return { deleted: true };
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

  private requireOrg(scope: CallerScope): string {
    if (scope.platformRole === 'superadmin') {
      const orgId = scope.organizationId ?? scope.activeOrganizationId;
      if (!orgId) {
        throw new BadRequestException(
          'organizationId is required for superadmin knowledge base calls',
        );
      }
      return orgId;
    }
    const activeOrg = scope.activeOrganizationId;
    if (!activeOrg) {
      throw new ForbiddenException('Active organization required');
    }
    if (scope.organizationId && scope.organizationId !== activeOrg) {
      throw new ForbiddenException(
        'You can only manage knowledge bases in your active organization',
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

function toPublic(row: VectorDbRow): VectorDb {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    qdrantCollection: row.qdrant_collection,
    status: row.status,
    statusError: row.status_error,
    documentCount: row.document_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
