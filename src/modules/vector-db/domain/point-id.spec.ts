import { deterministicImagePointId, deterministicPointId } from './point-id';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deterministicPointId', () => {
  it('returns a valid RFC-4122 v5-shaped UUID Qdrant will accept', () => {
    const id = deterministicPointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    expect(id).toMatch(UUID_RE);
  });

  it('is deterministic — same inputs produce the same id (idempotent retries)', () => {
    const a = deterministicPointId('vdb-1', 'vector-dbs/o/k/abc', 3);
    const b = deterministicPointId('vdb-1', 'vector-dbs/o/k/abc', 3);
    expect(a).toBe(b);
  });

  it('varies by chunk index', () => {
    const a = deterministicPointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    const b = deterministicPointId('vdb-1', 'vector-dbs/o/k/abc', 1);
    expect(a).not.toBe(b);
  });

  it('varies by s3 key', () => {
    const a = deterministicPointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    const b = deterministicPointId('vdb-1', 'vector-dbs/o/k/xyz', 0);
    expect(a).not.toBe(b);
  });

  it('varies by vector db id (isolates collections)', () => {
    const a = deterministicPointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    const b = deterministicPointId('vdb-2', 'vector-dbs/o/k/abc', 0);
    expect(a).not.toBe(b);
  });
});

describe('deterministicImagePointId', () => {
  it('returns a valid RFC-4122 v5-shaped UUID', () => {
    const id = deterministicImagePointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    expect(id).toMatch(UUID_RE);
  });

  it('is deterministic — same inputs produce the same id', () => {
    const a = deterministicImagePointId('vdb-1', 'vector-dbs/o/k/abc', 2);
    const b = deterministicImagePointId('vdb-1', 'vector-dbs/o/k/abc', 2);
    expect(a).toBe(b);
  });

  it('varies by image index', () => {
    const a = deterministicImagePointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    const b = deterministicImagePointId('vdb-1', 'vector-dbs/o/k/abc', 1);
    expect(a).not.toBe(b);
  });

  it('varies by s3 key', () => {
    const a = deterministicImagePointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    const b = deterministicImagePointId('vdb-1', 'vector-dbs/o/k/xyz', 0);
    expect(a).not.toBe(b);
  });

  it('varies by vector db id', () => {
    const a = deterministicImagePointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    const b = deterministicImagePointId('vdb-2', 'vector-dbs/o/k/abc', 0);
    expect(a).not.toBe(b);
  });

  it('never collides with deterministicPointId for the same inputs (image and text chunks are distinct)', () => {
    const textId = deterministicPointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    const imageId = deterministicImagePointId('vdb-1', 'vector-dbs/o/k/abc', 0);
    expect(imageId).not.toBe(textId);
  });
});
