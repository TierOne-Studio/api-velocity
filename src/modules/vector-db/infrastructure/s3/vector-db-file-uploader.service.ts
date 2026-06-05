import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '../../../../shared/config/config.service';
import type { VectorDbFileObject } from '../../domain/vector-db-file-uploader.port';

@Injectable()
export class VectorDbFileUploaderService {
  private readonly client: S3Client;

  constructor(private readonly config: ConfigService) {
    this.client = new S3Client({ region: config.getS3Region() });
  }

  async put(
    s3Key: string,
    body: Buffer,
    contentType: string,
    originalFilename?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.getS3Bucket(),
        Key: s3Key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
        Metadata: {
          'original-filename': (originalFilename ?? '').slice(0, 512),
          'content-type': contentType,
        },
      }),
    );
  }

  async delete(s3Key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.getS3Bucket(),
        Key: s3Key,
      }),
    );
  }

  async get(s3Key: string): Promise<VectorDbFileObject> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.getS3Bucket(),
        Key: s3Key,
      }),
    );
    if (!response.Body) {
      throw new Error(`S3 object ${s3Key} has no body`);
    }
    const bytes = await response.Body.transformToByteArray();
    return {
      body: Buffer.from(bytes),
      contentType: response.ContentType ?? 'application/octet-stream',
    };
  }
}
