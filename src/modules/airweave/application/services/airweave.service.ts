import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AirweaveSDK } from '@airweave/sdk';
import { ConfigService } from '../../../../shared/config';
import {
  AIRWEAVE_SDK_CLIENT,
  type AirweaveSdkClient,
} from '../../infrastructure/airweave-sdk.provider';

export type ListAirweaveCollectionsParams = {
  search?: string;
  limit?: number;
  skip?: number;
};

export type AirweaveCollectionSummary = {
  id: string;
  name: string;
  readableId: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  status: string | null;
  sourceConnectionCount: number;
};

export type AirweaveCollectionDetail = AirweaveCollectionSummary & {
  vectorSize: number;
  embeddingModelName: string;
};

export type AirweaveSourceConnectionSummary = {
  id: string;
  name: string;
  shortName: string;
  collectionReadableId: string;
  createdAt: string;
  updatedAt: string;
  isAuthenticated: boolean;
  entityCount: number;
  authMethod: string;
  status: string;
};

export type AirweaveSearchTier = 'classic' | 'instant';

export type AirweaveSearchRetrievalStrategy = 'semantic' | 'keyword' | 'hybrid';

export type SearchAirweaveCollectionParams = {
  query: string;
  tier: AirweaveSearchTier;
  limit?: number;
  offset?: number;
  retrievalStrategy?: AirweaveSearchRetrievalStrategy;
};

export type AirweaveSearchResultSummary = {
  entityId: string;
  name: string;
  relevanceScore: number;
  breadcrumbs: Array<{
    entityId: string;
    name: string;
    entityType: string;
  }>;
  createdAt: string | null;
  updatedAt: string | null;
  text: string;
  sourceName: string;
  entityType: string;
  webUrl: string;
};

export type AirweaveSearchResponse = {
  results: AirweaveSearchResultSummary[];
};

type AirweaveSourceConnectionLike = Pick<
  AirweaveSDK.SourceConnection,
  | 'id'
  | 'name'
  | 'short_name'
  | 'readable_collection_id'
  | 'created_at'
  | 'modified_at'
  | 'status'
> & {
  is_authenticated?: boolean | null;
  entity_count?: number | null;
  auth_method?: string | null;
};

export type AirweaveConnectSessionParams = {
  readableCollectionId: string;
  endUserId: string;
};

export type AirweaveConnectSession = {
  sessionToken: string;
};

@Injectable()
export class AirweaveService {
  constructor(
    @Inject(AIRWEAVE_SDK_CLIENT)
    private readonly airweaveClient: AirweaveSdkClient,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  async listCollections(
    params: ListAirweaveCollectionsParams = {},
  ): Promise<AirweaveCollectionSummary[]> {
    const client = this.requireClient();

    try {
      const collections = await client.collections.list({
        search: params.search,
        limit: params.limit,
        skip: params.skip,
      });

      return collections.map((collection) => this.mapCollection(collection));
    } catch (error) {
      this.handleUpstreamError('list collections', error);
    }
  }

  async getCollection(
    collectionReadableId: string,
  ): Promise<AirweaveCollectionDetail> {
    const client = this.requireClient();

    try {
      const collection = await client.collections.get(collectionReadableId);
      return this.mapCollectionDetail(collection);
    } catch (error) {
      this.handleUpstreamError('get collection', error, 'Collection not found');
    }
  }

  async listSourceConnections(
    collectionReadableId: string,
  ): Promise<AirweaveSourceConnectionSummary[]> {
    const client = this.requireClient();

    try {
      const sourceConnections = await client.sourceConnections.list({
        collection: collectionReadableId,
        limit: 100,
        skip: 0,
      });

      return sourceConnections.map((sourceConnection) =>
        this.mapSourceConnection(sourceConnection),
      );
    } catch (error) {
      this.handleUpstreamError('list source connections', error);
    }
  }

  async getSourceConnection(
    sourceConnectionId: string,
  ): Promise<AirweaveSourceConnectionSummary> {
    const client = this.requireClient();

    try {
      const sourceConnection =
        await client.sourceConnections.get(sourceConnectionId);
      return this.mapSourceConnection(sourceConnection);
    } catch (error) {
      this.handleUpstreamError(
        'get source connection',
        error,
        'Source connection not found',
      );
    }
  }

  async createConnectSession(
    params: AirweaveConnectSessionParams,
  ): Promise<AirweaveConnectSession> {
    const configService = this.requireConfig();
    const apiKey = configService.getAirweaveApiKey();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Airweave integration is not configured',
      );
    }

    const baseUrl = configService.getAirweaveBaseUrl().replace(/\/$/, '');

    try {
      const response = await fetch(`${baseUrl}/connect/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          readable_collection_id: params.readableCollectionId,
          mode: 'all',
          end_user_id: params.endUserId,
        }),
      });

      if (!response.ok) {
        this.handleUpstreamError('create connect session', {
          status: response.status,
          message: response.statusText,
        });
      }

      const payload = (await response.json()) as { session_token?: string };

      if (!payload.session_token) {
        throw new BadGatewayException('Failed to create connect session');
      }

      return {
        sessionToken: payload.session_token,
      };
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      this.handleUpstreamError('create connect session', error);
    }
  }

  async searchCollection(
    collectionReadableId: string,
    params: SearchAirweaveCollectionParams,
  ): Promise<AirweaveSearchResponse> {
    const client = this.requireClient();

    try {
      const response =
        params.tier === 'instant'
          ? await client.collections.search.instant(collectionReadableId, {
              query: params.query,
              retrieval_strategy: params.retrievalStrategy,
              limit: params.limit,
              offset: params.offset,
            })
          : await client.collections.search.classic(collectionReadableId, {
              query: params.query,
              limit: params.limit,
              offset: params.offset,
            });

      return {
        results: (response.results ?? []).map((result) =>
          this.mapSearchResult(result),
        ),
      };
    } catch (error) {
      this.handleUpstreamError(
        'search collection',
        error,
        'Collection not found',
      );
    }
  }

  private requireClient(): NonNullable<AirweaveSdkClient> {
    if (!this.airweaveClient) {
      throw new ServiceUnavailableException(
        'Airweave integration is not configured',
      );
    }

    return this.airweaveClient;
  }

  private requireConfig(): ConfigService {
    if (!this.configService) {
      throw new ServiceUnavailableException(
        'Airweave integration is not configured',
      );
    }

    return this.configService;
  }

  private mapCollection(
    collection: AirweaveSDK.Collection,
  ): AirweaveCollectionSummary {
    return {
      id: collection.id,
      name: collection.name,
      readableId: collection.readable_id,
      organizationId: collection.organization_id,
      createdAt: collection.created_at,
      updatedAt: collection.modified_at,
      status: collection.status ?? null,
      sourceConnectionCount:
        collection.source_connection_summaries?.length ?? 0,
    };
  }

  private mapCollectionDetail(
    collection: AirweaveSDK.Collection,
  ): AirweaveCollectionDetail {
    return {
      ...this.mapCollection(collection),
      vectorSize: collection.vector_size,
      embeddingModelName: collection.embedding_model_name,
    };
  }

  private mapSourceConnection(
    sourceConnection: AirweaveSourceConnectionLike,
  ): AirweaveSourceConnectionSummary {
    return {
      id: sourceConnection.id,
      name: sourceConnection.name,
      shortName: sourceConnection.short_name,
      collectionReadableId: sourceConnection.readable_collection_id,
      createdAt: sourceConnection.created_at,
      updatedAt: sourceConnection.modified_at,
      isAuthenticated: sourceConnection.is_authenticated ?? false,
      entityCount: sourceConnection.entity_count ?? 0,
      authMethod: sourceConnection.auth_method ?? 'unknown',
      status: sourceConnection.status,
    };
  }

  private mapSearchResult(
    result: AirweaveSDK.SearchResult,
  ): AirweaveSearchResultSummary {
    return {
      entityId: result.entity_id,
      name: result.name,
      relevanceScore: result.relevance_score,
      breadcrumbs: result.breadcrumbs.map((breadcrumb) => ({
        entityId: breadcrumb.entity_id,
        name: breadcrumb.name,
        entityType: breadcrumb.entity_type,
      })),
      createdAt: result.created_at ?? null,
      updatedAt: result.updated_at ?? null,
      text: result.textual_representation,
      sourceName: result.airweave_system_metadata.source_name,
      entityType: result.airweave_system_metadata.entity_type,
      webUrl: result.web_url,
    };
  }

  private handleUpstreamError(
    action: string,
    error: unknown,
    notFoundMessage?: string,
  ): never {
    const formattedError =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);

    console.error('[AirweaveService] Airweave request failed', {
      action,
      error: formattedError,
    });

    if (notFoundMessage && this.getErrorStatusCode(error) === 404) {
      throw new NotFoundException(notFoundMessage);
    }

    throw new BadGatewayException(`Failed to ${action}`);
  }

  private getErrorStatusCode(error: unknown): number | null {
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
    ) {
      return error.statusCode;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
    ) {
      return error.status;
    }

    return null;
  }
}
