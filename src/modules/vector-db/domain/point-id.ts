import { createHash } from 'node:crypto';

/**
 * Deterministic, idempotent Qdrant point ID for a single chunk.
 *
 * The same `(vectorDbId, s3Key, chunkIndex)` always maps to the same UUID, so a
 * retried or re-run ingestion job upserts (overwrites) the same points rather
 * than duplicating vectors — the core idempotency guarantee in ADR-014 §3.
 *
 * Qdrant requires a point ID to be either an unsigned integer or a valid UUID
 * (a raw hex string is rejected). We therefore derive a SHA-256 digest of the
 * composite key and format it into an RFC-4122 v5-shaped UUID (version nibble
 * `5`, variant bits `10xx`), which Qdrant accepts.
 */
export function deterministicPointId(
  vectorDbId: string,
  s3Key: string,
  chunkIndex: number,
): string {
  const hex = createHash('sha256')
    .update(`${vectorDbId}:${s3Key}:${chunkIndex}`)
    .digest('hex')
    .slice(0, 32)
    .split('');

  // Force a valid RFC-4122 UUID: version 5 and the 10xx variant.
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);

  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * Deterministic, idempotent Qdrant point ID for a single image chunk.
 *
 * Distinct from `deterministicPointId` by the "img:" prefix in the digest
 * input — same (vectorDbId, s3Key, index) triple can never collide between
 * a text chunk and an image chunk, preserving idempotency for both on retry.
 */
export function deterministicImagePointId(
  vectorDbId: string,
  s3Key: string,
  imageIndex: number,
): string {
  const hex = createHash('sha256')
    .update(`img:${vectorDbId}:${s3Key}:${imageIndex}`)
    .digest('hex')
    .slice(0, 32)
    .split('');

  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);

  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
