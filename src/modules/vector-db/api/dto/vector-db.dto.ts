import type {
  VectorDbStatus,
  IngestionJobStatus,
} from '../../domain/vector-db.repository';
export type { VectorDbStatus, IngestionJobStatus };

export type IngestionJob = {
  id: string;
  vectorDbId: string;
  s3Key: string;
  originalFilename: string;
  fileSizeBytes: string;
  contentType: string;
  status: IngestionJobStatus;
  createdAt: string;
  updatedAt: string;
};

export type VectorDb = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  vectorStoreKind: string;
  vectorStoreRef: string;
  status: VectorDbStatus;
  statusError: { message: string } | null;
  documentCount: number;
  version: number;
  processingStartedAt: string | null;
  lastIngestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VectorDbRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  vector_store_kind: string;
  vector_store_ref: string;
  status: VectorDbStatus;
  status_error: { message: string } | null;
  document_count: number;
  deleted_at: string | null;
  version: number;
  processing_started_at: string | null;
  last_ingested_at: string | null;
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
