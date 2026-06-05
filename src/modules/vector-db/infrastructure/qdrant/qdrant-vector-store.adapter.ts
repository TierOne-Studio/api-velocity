import { Injectable, Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { ConfigService } from '../../../../shared/config/config.service';
import type {
  IVectorStore,
  VectorPoint,
} from '../../domain/vector-store.port';

/**
 * Qdrant adapter for {@link IVectorStore}. The only place the Qdrant SDK is
 * imported (ADR-009). One collection per knowledge base (ADR-014 §6), keyed by
 * `org_vector_db.vector_store_ref`.
 */
@Injectable()
export class QdrantVectorStoreAdapter implements IVectorStore {
  private readonly logger = new Logger(QdrantVectorStoreAdapter.name);
  private readonly client: QdrantClient;

  constructor(config: ConfigService) {
    this.client = new QdrantClient({
      url: config.getQdrantUrl(),
      apiKey: config.getQdrantApiKey(),
    });
  }

  async ensureCollection(ref: string, dimensions: number): Promise<void> {
    const { exists } = await this.client.collectionExists(ref);
    if (exists) return;

    await this.client.createCollection(ref, {
      vectors: { size: dimensions, distance: 'Cosine' },
    });
    this.logger.log('created qdrant collection', { ref, dimensions });
  }

  async upsert(ref: string, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;

    // wait: true flushes synchronously so a read-after-write (and the
    // idempotency assertion in tests) observes the upsert immediately.
    await this.client.upsert(ref, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
  }
}
