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
import { ConfigService } from '../../../../shared/config/config.service';

/** A single retrieved chunk from a vector database (read side of ingestion). */
export type VectorDbSearchResult = {
  text: string;
  score: number;
  chunkIndex: number;
  /** Vector-store payload key tying the chunk to its uploaded blob/document. */
  s3Key: string;
  /** Source document's `original_filename`, or null when it cannot be resolved. */
  documentName: string | null;
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
    private readonly config: ConfigService,
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
    const rawHits = await this.vectorStore.search(
      vdb.vector_store_ref,
      vector,
      limit,
    );

    // Drop weakly-similar chunks (SPEC-001 AC13): a top-k search always returns
    // `limit` points regardless of relevance, so without a floor every document
    // surfaces as a "source". Keeping only hits at/above the configured minimum
    // score trims both the LLM context and the citation chips to the documents
    // the answer was actually found in.
    const minScore = this.config.getVectorDbMinScore();
    const hits = rawHits.filter((hit) => hit.score >= minScore);

    // Attribute each chunk to its source document (SPEC-001 AC12). The point
    // payload carries `s3Key`; resolve the distinct keys to `original_filename`
    // in one query, scoped to this (already org-scoped) vector DB. An unresolved
    // key falls back to null — the provider then shows the collection name.
    const s3Keys = [
      ...new Set(
        hits
          .map((hit) =>
            typeof hit.payload.s3Key === 'string' ? hit.payload.s3Key : '',
          )
          .filter((key) => key !== ''),
      ),
    ];
    const nameRows = s3Keys.length
      ? await this.repository.findDocumentNamesByS3Keys(vectorDbId, s3Keys)
      : [];
    const nameByS3Key = new Map(
      nameRows.map((row) => [row.s3_key, row.original_filename]),
    );

    return hits.map((hit) => {
      const s3Key =
        typeof hit.payload.s3Key === 'string' ? hit.payload.s3Key : '';
      return {
        text: typeof hit.payload.text === 'string' ? hit.payload.text : '',
        score: hit.score,
        chunkIndex:
          typeof hit.payload.chunkIndex === 'number'
            ? hit.payload.chunkIndex
            : 0,
        s3Key,
        documentName: nameByS3Key.get(s3Key) ?? null,
      };
    });
  }
}
