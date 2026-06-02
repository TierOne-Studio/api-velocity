import type { KnowledgeBaseRow } from '../api/dto/knowledge-base.dto';

export type KnowledgeBaseStatus = 'empty' | 'processing' | 'ready' | 'error';

export const KNOWLEDGE_BASE_REPOSITORY = 'KNOWLEDGE_BASE_REPOSITORY';

export type CreateKnowledgeBaseRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  qdrantCollection: string;
};

export type UpdateKnowledgeBaseRow = {
  name?: string;
  description?: string | null;
};

export interface IKnowledgeBaseRepository {
  create(row: CreateKnowledgeBaseRow): Promise<KnowledgeBaseRow>;
  update(id: string, row: UpdateKnowledgeBaseRow): Promise<KnowledgeBaseRow>;
  updateStatus(
    id: string,
    status: KnowledgeBaseStatus,
    statusError: string | null,
  ): Promise<void>;
  incrementDocumentCount(id: string, delta: number): Promise<void>;
  findById(id: string): Promise<KnowledgeBaseRow | null>;
  findByIdInOrg(
    id: string,
    organizationId: string,
  ): Promise<KnowledgeBaseRow | null>;
  findManyByIdsForOrg(
    ids: string[],
    organizationId: string,
  ): Promise<KnowledgeBaseRow[]>;
  listForOrganization(organizationId: string): Promise<KnowledgeBaseRow[]>;
  findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<KnowledgeBaseRow | null>;
  delete(id: string, organizationId: string): Promise<boolean>;
  countProjectReferences(knowledgeBaseId: string): Promise<number>;
}
