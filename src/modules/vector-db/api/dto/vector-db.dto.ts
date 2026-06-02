import type { VectorDbStatus } from '../../domain/vector-db.repository';
export type { VectorDbStatus };

export type VectorDb = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  qdrantCollection: string;
  status: VectorDbStatus;
  statusError: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type VectorDbRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  qdrant_collection: string;
  status: VectorDbStatus;
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
