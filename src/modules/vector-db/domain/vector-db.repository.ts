import type { VectorDbRow } from '../api/dto/vector-db.dto';

export type VectorDbStatus = 'empty' | 'processing' | 'ready' | 'error';

export const VECTOR_DB_REPOSITORY = 'VECTOR_DB_REPOSITORY';

export type CreateVectorDbRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  qdrantCollection: string;
};

export type UpdateVectorDbRow = {
  name?: string;
  description?: string | null;
};

export interface IVectorDbRepository {
  create(row: CreateVectorDbRow): Promise<VectorDbRow>;
  update(id: string, row: UpdateVectorDbRow): Promise<VectorDbRow>;
  updateStatus(
    id: string,
    status: VectorDbStatus,
    statusError: string | null,
  ): Promise<void>;
  incrementDocumentCount(id: string, delta: number): Promise<void>;
  findById(id: string): Promise<VectorDbRow | null>;
  findByIdInOrg(
    id: string,
    organizationId: string,
  ): Promise<VectorDbRow | null>;
  findManyByIdsForOrg(
    ids: string[],
    organizationId: string,
  ): Promise<VectorDbRow[]>;
  listForOrganization(organizationId: string): Promise<VectorDbRow[]>;
  findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<VectorDbRow | null>;
  delete(id: string, organizationId: string): Promise<boolean>;
  countProjectReferences(knowledgeBaseId: string): Promise<number>;
}
