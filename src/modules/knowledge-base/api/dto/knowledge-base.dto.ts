import type { KnowledgeBaseStatus } from '../../domain/knowledge-base.repository';
export type { KnowledgeBaseStatus };

export type KnowledgeBase = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  qdrantCollection: string;
  status: KnowledgeBaseStatus;
  statusError: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBaseRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  qdrant_collection: string;
  status: KnowledgeBaseStatus;
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
