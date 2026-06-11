export const VECTOR_DB_FILE_UPLOADER = 'VECTOR_DB_FILE_UPLOADER';

export interface VectorDbFileObject {
  body: Buffer;
  contentType: string;
}

export interface IVectorDbFileUploader {
  put(s3Key: string, body: Buffer, contentType: string, originalFilename?: string): Promise<void>;
  delete(s3Key: string): Promise<void>;
  /** Read a previously stored object back (used by the ingestion worker). */
  get(s3Key: string): Promise<VectorDbFileObject>;
}
