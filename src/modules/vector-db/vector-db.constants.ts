export const VECTOR_DB_ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/pdf',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const VECTOR_DB_MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
