import type {
  VectorDbStatus,
  IngestionJobStatus,
  VectorDbRow,
} from '../../domain/vector-db.repository';
// VectorDbRow is the DB-facing persistence shape owned by the domain layer;
// re-exported here for the api/infra consumers that already import it from this
// module. The API's own public surface is the camelCase DTOs below.
export type { VectorDbStatus, IngestionJobStatus, VectorDbRow };

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

export type CreateKnowledgeBaseInput = {
  name: string;
  description?: string | null;
};

export type UpdateKnowledgeBaseInput = {
  name?: string;
  description?: string | null;
};
