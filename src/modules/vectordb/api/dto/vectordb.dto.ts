import type { VectordbStatus } from '../../domain/vectordb.repository';
export type { VectordbStatus };

export type Vectordb = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  qdrantCollection: string;
  status: VectordbStatus;
  statusError: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type VectordbRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  qdrant_collection: string;
  status: VectordbStatus;
  status_error: string | null;
  document_count: number;
  created_at: string;
  updated_at: string;
};

export type CreateKnowledgeBaseInput = {
  name: string;
  description?: string | null;
};

export type UpdateKnowledgeBaseInput = {
  name?: string;
  description?: string | null;
};
