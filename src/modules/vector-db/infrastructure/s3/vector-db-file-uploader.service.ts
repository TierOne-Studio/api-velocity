import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '../../../../shared/config/config.service';

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
}
