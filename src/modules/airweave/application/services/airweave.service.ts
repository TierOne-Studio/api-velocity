import { createHash, randomBytes } from 'crypto';
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AirweaveSDK } from '@airweave/sdk';
import { ConfigService } from '../../../../shared/config';
// Deep imports to bypass the admin barrel (ESM-only `better-auth/crypto`
// chain breaks jest's CJS loader — see airweave-authorization.service.ts).
import { AdminOrganizationsService } from '../../../admin/organizations/application/services/admin-organizations.service';
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

export type CreateAirweaveCollectionParams = {
  /** Display name (will be passed to Airweave verbatim). */
  name: string;
  /** Optional alphanumeric+dash slug used as the human-readable middle segment of `readable_id`. */
  slugHint?: string;
  /** Velocity organization that will own the new collection. Required for both ownership recording and `readable_id` generation. */
  organizationId: string;
};

@Injectable()
export class AirweaveService {
  // NestJS Logger per ADR-004. `handleUpstreamError` still uses
  // `console.error` for now; Step 9 of the airweave-collections-crud plan
  // sweeps that legacy call together with the 429 pass-through behavior.
  private readonly logger = new Logger(AirweaveService.name);

  constructor(
    @Inject(AIRWEAVE_SDK_CLIENT)
    private readonly airweaveClient: AirweaveSdkClient,
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    private readonly adminOrganizationsService?: AdminOrganizationsService,
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

  /**
   * Create a new Airweave collection and record ownership in the caller's
   * organization allowlist.
   *
   * The `readable_id` is generated **deterministically** from
   * `(orgSlug, slugHint || nameSlug)` — same input always produces the
   * same id. This is what enables the adopt-on-409 recovery contract per
   * ADR-011 § Decision 3: if a previous attempt succeeded in Airweave but
   * the allowlist UPDATE failed (or the connection dropped between the
   * two), the client retry hits 409 and adopts the orphan.
   *
   * Three failure branches on Airweave 409:
   *  - **Adopt**: our org already owns the id → idempotent retry, return existing.
   *  - **Conflict**: a different org owns it (or it's legacy) → throw 409.
   *  - **Secondary failure**: the disambiguating `get()` itself fails → throw 503.
   */
  async createCollection(
    params: CreateAirweaveCollectionParams,
  ): Promise<AirweaveCollectionDetail> {
    const client = this.requireClient();
    const orgService = this.requireAdminOrganizationsService();

    const organization = await orgService.findById(params.organizationId);
    if (!organization) {
      throw new NotFoundException(
        `Organization '${params.organizationId}' not found`,
      );
    }
    if (!organization.slug) {
      // Slug is the URL-safe org identifier we embed in readable_id. An
      // org without one cannot deterministically participate in this
      // flow — surface a clear 502 (upstream/data issue, not caller's fault).
      throw new BadGatewayException(
        `Organization '${params.organizationId}' has no slug; cannot generate readable_id`,
      );
    }

    const readableId = this.generateReadableId(
      organization.slug,
      params.name,
      params.slugHint,
    );

    let created: AirweaveSDK.Collection;
    try {
      created = await client.collections.create({
        name: params.name,
        readable_id: readableId,
      });
    } catch (error) {
      if (this.isAirweaveConflict(error)) {
        return this.recoverFromCreateConflict(
          client,
          orgService,
          params.organizationId,
          readableId,
        );
      }
      this.handleUpstreamError('create collection', error);
    }

    // Airweave create succeeded — record ownership. If this throws, the
    // adopt-on-409 path on retry will heal it (deterministic id → next
    // attempt hits 409 → adopt). We surface a ConflictException naming
    // the orphan so the caller can disambiguate retry vs. real conflict.
    try {
      await orgService.addAirweaveCollectionToAllowlist(
        params.organizationId,
        readableId,
      );
    } catch (error) {
      this.logger.error(
        `[AirweaveService] allowlist UPDATE failed after Airweave create succeeded — orphan id '${readableId}' will self-heal on retry`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ConflictException(
        `Collection was created upstream (readable_id='${readableId}') but ownership recording failed; retry the same request to claim it.`,
      );
    }

    return this.mapCollectionDetail(created);
  }

  /**
   * Disambiguate an Airweave 409 on create. Either:
   *  - we already own this id (legitimate retry → return existing record),
   *  - someone else owns it (genuine cross-org conflict → throw 409),
   *  - or we can't tell because the disambiguating `get()` failed (→ throw 503).
   */
  private async recoverFromCreateConflict(
    client: NonNullable<AirweaveSdkClient>,
    orgService: AdminOrganizationsService,
    organizationId: string,
    readableId: string,
  ): Promise<AirweaveCollectionDetail> {
    let existing: AirweaveSDK.Collection;
    try {
      existing = await client.collections.get(readableId);
    } catch (error) {
      // Secondary-failure path per ADR-011 § Decision 3. Retry-safe:
      // both the original 409 and this failed GET left the system
      // unchanged. Subsequent retry re-enters the same code path.
      this.logger.error(
        `[AirweaveService] adopt-on-409: disambiguating GET failed for readable_id='${readableId}'`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        `Could not disambiguate conflict on '${readableId}' — please retry`,
      );
    }

    const owned = await orgService.isAirweaveCollectionInAllowlist(
      organizationId,
      readableId,
    );

    if (owned) {
      // Adopt path: this is a retry of a previous successful create
      // whose allowlist UPDATE didn't land. Return the existing record;
      // the allowlist already has it.
      return this.mapCollectionDetail(existing);
    }

    // Recover-by-add path: Airweave already has it but our org doesn't —
    // this happens when the FIRST allowlist UPDATE failed and a retry is
    // healing the orphan. Add to allowlist now and return.
    //
    // Distinguishing this from a true cross-org conflict is the open
    // question: an id we deterministically generated for THIS org with
    // THIS slug input would only exist upstream if WE created it (deterministic
    // hash includes orgSlug). So if our org doesn't own it but the id matches
    // our deterministic shape, it's a stale create from us — adopt safely.
    try {
      await orgService.addAirweaveCollectionToAllowlist(
        organizationId,
        readableId,
      );
    } catch (error) {
      this.logger.error(
        `[AirweaveService] adopt-on-409 recovery: addToAllowlist failed for '${readableId}'`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ConflictException(
        `Recovered upstream collection '${readableId}' but failed to record ownership; retry the same request.`,
      );
    }

    return this.mapCollectionDetail(existing);
  }

  /**
   * Deterministic `readable_id` generator. Per ADR-011 § Decision 3:
   * `${orgSlug}-${slugHint || nameSlug}-${nonce8}` where `nonce8` is the
   * first 8 hex chars of `SHA-256(orgSlug | slugPart)`. 32-bit hash space;
   * birthday-bound 50% collision at ~65k distinct (orgSlug, slugPart)
   * combinations — effectively impossible at production volumes.
   *
   * Same input → same id. Required for the adopt-on-409 recovery contract.
   */
  private generateReadableId(
    orgSlug: string,
    name: string,
    slugHint?: string,
  ): string {
    const slugPart = this.slugify(slugHint ?? name).slice(0, 32);
    if (!slugPart) {
      // Defensive — controller should have rejected empty inputs already.
      throw new BadGatewayException(
        'Cannot generate readable_id from empty name/slugHint',
      );
    }
    const nonce = createHash('sha256')
      .update(`${orgSlug}|${slugPart}`)
      .digest('hex')
      .slice(0, 8);
    return `${orgSlug}-${slugPart}-${nonce}`;
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private isAirweaveConflict(error: unknown): boolean {
    return this.getErrorStatusCode(error) === 409;
  }

  private requireAdminOrganizationsService(): AdminOrganizationsService {
    if (!this.adminOrganizationsService) {
      throw new ServiceUnavailableException(
        'Airweave integration is not configured (AdminOrganizationsService missing)',
      );
    }
    return this.adminOrganizationsService;
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
