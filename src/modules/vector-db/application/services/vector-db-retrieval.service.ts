import { Inject, Injectable } from '@nestjs/common';
import {
  VECTOR_DB_REPOSITORY,
  type IVectorDbRepository,
} from '../../domain/vector-db.repository';
import { EMBEDDER, type IEmbedder } from '../../domain/embedder.port';
import {
  VECTOR_STORE,
  type IVectorStore,
} from '../../domain/vector-store.port';

/** A single retrieved chunk from a vector database (read side of ingestion). */
export type VectorDbSearchResult = {
  text: string;
  score: number;
  chunkIndex: number;
};

/**
 * Read-side counterpart to `VectorDbIngestionService`: embeds a query and runs
 * a top-k similarity search against the vector store. Kept separate from
 * `VectorDbService` (CRUD/upload orchestration) so each stays cohesive — this
 * one's collaborators are the embedder + vector store, not the file uploader.
 */
@Injectable()
export class VectorDbRetrievalService {
  constructor(
    @Inject(VECTOR_DB_REPOSITORY)
    private readonly repository: IVectorDbRepository,
    @Inject(EMBEDDER) private readonly embedder: IEmbedder,
    @Inject(VECTOR_STORE) private readonly vectorStore: IVectorStore,
  ) {}

  /**
   * Top-`limit` chunks most similar to `query` from the given vector database.
   *
   * Org-scoped (`findByIdInOrg`) for defense-in-depth even though the source
   * was org-validated at attach. Returns `[]` (never throws) when the vector
   * database is not found, belongs to another org, or is not `ready` — a
   * not-yet-ingested collection has nothing to search and must not poison the
   * chat turn. Embedder/vector-store failures propagate; the chat retrieval
   * lane isolates them per-source via `Promise.allSettled`.
   */
  async search(
    vectorDbId: string,
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<VectorDbSearchResult[]> {
    const vdb = await this.repository.findByIdInOrg(vectorDbId, organizationId);
    if (!vdb || vdb.status !== 'ready') return [];

    const [vector] = await this.embedder.embed([query]);
    const hits = await this.vectorStore.search(
      vdb.vector_store_ref,
      vector,
      limit,
    );

    return hits.map((hit) => ({
      text: typeof hit.payload.text === 'string' ? hit.payload.text : '',
      score: hit.score,
      chunkIndex:
        typeof hit.payload.chunkIndex === 'number' ? hit.payload.chunkIndex : 0,
    }));
  }
}
