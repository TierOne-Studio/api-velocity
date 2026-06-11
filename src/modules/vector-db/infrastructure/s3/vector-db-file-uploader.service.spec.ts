import { jest } from '@jest/globals';

// This repo runs Jest in ESM mode (`useESM: true` + `--experimental-vm-modules`).
// The legacy `jest.mock(factory)` + static import does NOT hoist here (the real
// module resolves first). We MUST use `jest.unstable_mockModule` + dynamic
// import of the SUT — see src/shared/test-utils/agent-transcript-mock.ts.

const mockSend = jest.fn<(command: unknown) => Promise<unknown>>();

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input: unknown) => ({ __type: 'put', input })),
  DeleteObjectCommand: jest.fn((input: unknown) => ({
    __type: 'delete',
    input,
  })),
  GetObjectCommand: jest.fn((input: unknown) => ({ __type: 'get', input })),
}));

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } =
  await import('@aws-sdk/client-s3');
const { VectorDbFileUploaderService } = await import(
  './vector-db-file-uploader.service'
);

function makeConfig(bucket = 'test-bucket', region = 'us-east-1') {
  return {
    getS3Bucket: () => bucket,
    getS3Region: () => region,
  };
}

describe('VectorDbFileUploaderService', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue(undefined);
    (S3Client as unknown as jest.Mock).mockClear();
    (PutObjectCommand as unknown as jest.Mock).mockClear();
    (DeleteObjectCommand as unknown as jest.Mock).mockClear();
    (GetObjectCommand as unknown as jest.Mock).mockClear();
  });

  describe('put', () => {
    it('calls PutObjectCommand with correct Bucket, Key, Body, and ContentType', async () => {
      const service = new VectorDbFileUploaderService(makeConfig() as never);
      const buffer = Buffer.from('hello world');
      await service.put('my/key.txt', buffer, 'text/plain', 'orig.txt');

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'my/key.txt',
        Body: buffer,
        ContentType: 'text/plain',
        ContentLength: buffer.length,
        Metadata: {
          'original-filename': 'orig.txt',
          'content-type': 'text/plain',
        },
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('propagates S3Client errors', async () => {
      mockSend.mockRejectedValue(new Error('s3 down'));
      const service = new VectorDbFileUploaderService(makeConfig() as never);
      await expect(
        service.put('k', Buffer.from('x'), 'text/plain'),
      ).rejects.toThrow('s3 down');
    });
  });

  describe('delete', () => {
    it('calls DeleteObjectCommand with correct Bucket and Key', async () => {
      const service = new VectorDbFileUploaderService(makeConfig() as never);
      await service.delete('my/key.txt');

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'my/key.txt',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('propagates S3Client errors on delete', async () => {
      mockSend.mockRejectedValue(new Error('delete failed'));
      const service = new VectorDbFileUploaderService(makeConfig() as never);
      await expect(service.delete('k')).rejects.toThrow('delete failed');
    });
  });

  describe('get', () => {
    it('reads the object body and content type', async () => {
      mockSend.mockResolvedValue({
        Body: { transformToByteArray: async () => new Uint8Array([104, 105]) },
        ContentType: 'text/markdown',
      });
      const service = new VectorDbFileUploaderService(makeConfig() as never);

      const result = await service.get('my/key.md');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'my/key.md',
      });
      expect(result.body).toEqual(Buffer.from('hi'));
      expect(result.contentType).toBe('text/markdown');
    });

    it('defaults the content type when S3 omits it', async () => {
      mockSend.mockResolvedValue({
        Body: { transformToByteArray: async () => new Uint8Array([1]) },
      });
      const service = new VectorDbFileUploaderService(makeConfig() as never);

      const result = await service.get('k');
      expect(result.contentType).toBe('application/octet-stream');
    });

    it('throws a contextual error when the object has no body', async () => {
      mockSend.mockResolvedValue({ Body: undefined });
      const service = new VectorDbFileUploaderService(makeConfig() as never);

      await expect(service.get('missing/key')).rejects.toThrow(
        'S3 object missing/key has no body',
      );
    });

    it('propagates S3Client errors on get', async () => {
      mockSend.mockRejectedValue(new Error('no such key'));
      const service = new VectorDbFileUploaderService(makeConfig() as never);
      await expect(service.get('k')).rejects.toThrow('no such key');
    });
  });
});
