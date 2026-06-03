export const VECTOR_DB_FILE_UPLOADER = 'VECTOR_DB_FILE_UPLOADER';

export interface IVectorDbFileUploader {
  put(s3Key: string, body: Buffer, contentType: string, originalFilename?: string): Promise<void>;
  delete(s3Key: string): Promise<void>;
}
