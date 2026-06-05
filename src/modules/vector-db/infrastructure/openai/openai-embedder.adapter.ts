import { Injectable } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import { ConfigService } from '../../../../shared/config/config.service';
import { batchEmbed } from '../../application/services/batch-embed';
import type { IEmbedder } from '../../domain/embedder.port';

/**
 * Known output dimensions per OpenAI embedding model. Used to create the Qdrant
 * collection with the matching vector size (ADR-014 §6). A model not listed
 * here falls back to the `text-embedding-3-small` dimension; the live embedder
 * integration test asserts the map matches the model's actual output.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

const DEFAULT_DIMENSIONS = 1536;

/**
 * OpenAI adapter for {@link IEmbedder}. The only place the embeddings SDK is
 * imported (ADR-009). The bounded-batch / bounded-concurrency logic lives in
 * the pure `batchEmbed` helper; this is a thin boundary wrapper.
 */
@Injectable()
export class OpenAiEmbedderAdapter implements IEmbedder {
  private readonly client: OpenAIEmbeddings;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly dims: number;

  constructor(config: ConfigService) {
    const model = config.getEmbeddingModel();
    const apiKey = config.getOpenAiApiKey();
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is required for vector-db ingestion (server-side embeddings)',
      );
    }
    this.client = new OpenAIEmbeddings({ model, apiKey });
    this.batchSize = config.getEmbeddingBatchSize();
    this.concurrency = config.getEmbeddingConcurrency();
    this.dims = MODEL_DIMENSIONS[model] ?? DEFAULT_DIMENSIONS;
  }

  embed(texts: string[]): Promise<number[][]> {
    return batchEmbed(
      texts,
      { batchSize: this.batchSize, concurrency: this.concurrency },
      (batch) => this.client.embedDocuments(batch),
    );
  }

  dimensions(): number {
    return this.dims;
  }
}
