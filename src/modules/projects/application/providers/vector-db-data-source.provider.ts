import { Injectable } from '@nestjs/common';
import type { AirweaveSearchResponse } from '../../../airweave/application/services/airweave.service';
import { VectorDbRetrievalService } from '../../../vector-db/application/services/vector-db-retrieval.service';
import type { ProjectDataSource } from '../../api/dto/project.dto';
import type {
  DataSourceProvider,
  DataSourceSearchOptions,
} from './data-source-provider.interface';

const DEFAULT_LIMIT = 5;

/**
 * RAG provider for `vector_db` sources. Mirrors `AirweaveCollectionProvider`:
 * search-only (no agent tools), consumed by the chat retrieval lane. Adapts the
 * vector database's chunk hits to the shared `AirweaveSearchResponse` shape so
 * the chat agent treats it like any other retrieval source (a neutral base
 * type is a future refactor — see ADR/plan).
 */
@Injectable()
export class VectorDbDataSourceProvider implements DataSourceProvider {
  readonly kind = 'vector_db' as const;

  constructor(private readonly retrieval: VectorDbRetrievalService) {}

  async search(
    source: ProjectDataSource,
    query: string,
    options: DataSourceSearchOptions = {},
  ): Promise<AirweaveSearchResponse> {
    if (source.kind !== 'vector_db') {
      throw new Error(
        `VectorDbDataSourceProvider cannot handle source kind "${source.kind}"`,
      );
    }

    // Org context is required to re-scope the vector DB at query time
    // (defense-in-depth). Without it we cannot safely resolve the source, so
    // contribute nothing rather than fall back to an unscoped lookup.
    const organizationId = options.organizationId;
    if (!organizationId) return { results: [] };

    const results = await this.retrieval.search(
      source.config.vectorDbId,
      organizationId,
      query,
      options.limit ?? DEFAULT_LIMIT,
    );

    return {
      // `name` = the source document (mirrors Airweave's entity/source split,
      // so the chat Sources chip reads "<document> · <collection>"); falls back
      // to the collection name when the filename can't be resolved. `entityId`
      // includes `s3Key` so chunk 0 of two different documents doesn't collide
      // and get dropped by the downstream entityId dedupe (SPEC-001 AC12).
      results: results.map((hit) => ({
        entityId: `${source.config.vectorDbId}:${hit.s3Key}:${hit.chunkIndex}`,
        name: hit.documentName ?? source.config.vectorDbName,
        relevanceScore: hit.score,
        breadcrumbs: [],
        createdAt: null,
        updatedAt: null,
        text: hit.text,
        sourceName: source.config.vectorDbName,
        entityType: 'document',
        webUrl: '',
      })),
    };
  }
}
