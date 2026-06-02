import type { VectordbRow } from '../api/dto/vectordb.dto';

export type VectordbStatus = 'empty' | 'processing' | 'ready' | 'error';

export const VECTORDB_REPOSITORY = 'VECTORDB_REPOSITORY';

export type CreateVectordbRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  qdrantCollection: string;
};

export type UpdateVectordbRow = {
  name?: string;
  description?: string | null;
};

export interface IVectordbRepository {
  create(row: CreateVectordbRow): Promise<VectordbRow>;
  update(id: string, row: UpdateVectordbRow): Promise<VectordbRow>;
  updateStatus(
    id: string,
    status: VectordbStatus,
    statusError: string | null,
  ): Promise<void>;
  incrementDocumentCount(id: string, delta: number): Promise<void>;
  findById(id: string): Promise<VectordbRow | null>;
  findByIdInOrg(
    id: string,
    organizationId: string,
  ): Promise<VectordbRow | null>;
  findManyByIdsForOrg(
    ids: string[],
    organizationId: string,
  ): Promise<VectordbRow[]>;
  listForOrganization(organizationId: string): Promise<VectordbRow[]>;
  findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<VectordbRow | null>;
  delete(id: string, organizationId: string): Promise<boolean>;
  countProjectReferences(knowledgeBaseId: string): Promise<number>;
}
