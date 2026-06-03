import { jest } from '@jest/globals';

const mockSend = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input: unknown) => ({ input })),
  DeleteObjectCommand: jest.fn((input: unknown) => ({ input })),
}));

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { VectorDbFileUploaderService } from './vector-db-file-uploader.service';

function makeConfig(bucket = 'test-bucket', region = 'us-east-1') {
  return {
    getS3Bucket: () => bucket,
    getS3Region: () => region,
  };
}

describe('VectorDbFileUploaderService', () => {
  beforeEach(() => {
    mockSend.mockClear();
    (S3Client as unknown as jest.Mock).mockClear();
    (PutObjectCommand as unknown as jest.Mock).mockClear();
    (DeleteObjectCommand as unknown as jest.Mock).mockClear();
  });

  describe('put', () => {
    it('calls PutObjectCommand with correct Bucket, Key, Body, and ContentType', async () => {
      const service = new VectorDbFileUploaderService(makeConfig() as never);
      const buffer = Buffer.from('hello world');
      await service.put('my/key.txt', buffer, 'text/plain');

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'my/key.txt',
        Body: buffer,
        ContentType: 'text/plain',
        ContentLength: buffer.length,
        Metadata: {
          'original-filename': '',
          'content-type': 'text/plain',
        },
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('propagates S3Client errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('S3 unavailable'));
      const service = new VectorDbFileUploaderService(makeConfig() as never);

      await expect(service.put('key', Buffer.from(''), 'text/plain')).rejects.toThrow(
        'S3 unavailable',
      );
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
      mockSend.mockRejectedValueOnce(new Error('Access denied'));
      const service = new VectorDbFileUploaderService(makeConfig() as never);

      await expect(service.delete('key')).rejects.toThrow('Access denied');
    });
  });
});
