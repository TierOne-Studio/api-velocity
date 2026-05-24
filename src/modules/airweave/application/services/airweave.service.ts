import { createHash, randomBytes } from 'crypto';
import {
  BadGatewayException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AirweaveSDK } from '@airweave/sdk';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ConfigService } from '../../../../shared/config';
// Deep imports to bypass the admin barrel (ESM-only `better-auth/crypto`
// chain breaks jest's CJS loader — see airweave-authorization.service.ts).
import { AdminOrganizationsService } from '../../../admin/organizations/application/services/admin-organizations.service';
import { AirweaveAuthorizationService } from './airweave-authorization.service';
import {
  PROJECTS_REPOSITORY,
  type IProjectsRepository,
} from '../../../projects/domain/repositories/projects.repository.interface';
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

export type CreateAirweaveSourceConnectionParams = {
  /** Parent collection's `readable_id` — caller is expected to have been
   *  gated by `AirweaveOwnershipGuard` already. */
  collectionReadableId: string;
  name: string;
  shortName: string;
  authentication:
    | { kind: 'direct'; credentials: Record<string, unknown> }
    | { kind: 'oauth'; redirectUri?: string; endUserId: string };
};

export type CreateAirweaveSourceConnectionResult = {
  sourceConnection: AirweaveSourceConnectionSummary;
  /** Present only on the OAuth branch (Step 8); the frontend opens the
   *  Airweave portal using this token. */
  sessionToken?: string;
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
    @Optional()
    @Inject(PROJECTS_REPOSITORY)
    private readonly projectsRepository?: IProjectsRepository,
    @Optional()
    private readonly authzService?: AirweaveAuthorizationService,
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
   * Rename an Airweave collection. Pass-through to the SDK; does NOT
   * touch the allowlist (rename doesn't change ownership). Caller is
   * expected to have been gated by `AirweaveOwnershipGuard` already.
   */
  async updateCollection(
    readableId: string,
    update: { name: string },
  ): Promise<AirweaveCollectionDetail> {
    const client = this.requireClient();
    try {
      const updated = await client.collections.update(readableId, {
        name: update.name,
      });
      return this.mapCollectionDetail(updated);
    } catch (error) {
      this.handleUpstreamError(
        'update collection',
        error,
        'Collection not found',
      );
    }
  }

  /**
   * Delete an Airweave collection AND remove it from the org's allowlist.
   *
   * Pre-flight: if any `project_data_source` row with kind='airweave_collection'
   * references this readable_id, refuse with 409 + the list of project IDs +
   * names. The caller (frontend) is expected to surface this so the user
   * can detach the sources first. Per ADR-011 failure mode #4 — no cascade.
   *
   * On Airweave 404: proceed with allowlist cleanup anyway (the upstream is
   * the source-of-truth for "exists"; allowlist may have stale entries).
   * Per failure mode #5.
   */
  async deleteCollection(
    readableId: string,
    organizationId: string,
  ): Promise<void> {
    const client = this.requireClient();
    const orgService = this.requireAdminOrganizationsService();
    const projectsRepo = this.requireProjectsRepository();

    const referencingProjects =
      await projectsRepo.findProjectsReferencingAirweaveCollection(readableId);

    if (referencingProjects.length > 0) {
      throw new ConflictException({
        message:
          'Collection is in use by one or more projects. Detach the data sources before deleting.',
        collectionReadableId: readableId,
        projects: referencingProjects,
      });
    }

    try {
      await client.collections.delete(readableId);
    } catch (error) {
      // Upstream 404 → already gone. Proceed with local cleanup so the
      // allowlist doesn't keep a stale entry forever.
      if (this.getErrorStatusCode(error) !== 404) {
        this.handleUpstreamError('delete collection', error);
      }
      this.logger.warn(
        `[AirweaveService] delete: upstream returned 404 for '${readableId}' — proceeding with allowlist cleanup`,
      );
    }

    await orgService.removeAirweaveCollectionFromAllowlist(
      organizationId,
      readableId,
    );
  }

  /**
   * Create a source connection inside an Airweave collection.
   *
   * Two branches discriminated by `authentication.kind`:
   *  - **direct** (Step 6): credentials passed inline, `sync_immediately: true`
   *    so Airweave kicks off the initial sync immediately. Returns
   *    `{ sourceConnection }` only.
   *  - **oauth** (Step 8): currently throws `NotImplementedException` (501).
   *    Step 8 will wire it to the existing `createConnectSession` and return
   *    `{ sourceConnection, sessionToken }`.
   *
   * Caller is expected to have been gated by `AirweaveOwnershipGuard`
   * (the parent collection's `readable_id` is the route param + the user's
   * active org must own it).
   */
  async createSourceConnection(
    params: CreateAirweaveSourceConnectionParams,
  ): Promise<CreateAirweaveSourceConnectionResult> {
    const client = this.requireClient();

    if (params.authentication.kind === 'direct') {
      try {
        const created = await client.sourceConnections.create({
          name: params.name,
          short_name: params.shortName,
          readable_collection_id: params.collectionReadableId,
          sync_immediately: true,
          authentication: { credentials: params.authentication.credentials },
        });
        return { sourceConnection: this.mapSourceConnection(created) };
      } catch (error) {
        this.handleUpstreamError('create source connection', error);
      }
    }

    // OAuth branch (Step 8): Airweave creates the connection in `pending`
    // state. We then issue a connect-session token via the existing
    // `createConnectSession` flow so the frontend can open the portal and
    // complete the browser OAuth handshake. The initial sync runs after
    // successful auth (SDK default `sync_immediately: false` for oauth).
    const oauth = params.authentication;
    let created: AirweaveSDK.SourceConnection;
    try {
      created = await client.sourceConnections.create({
        name: params.name,
        short_name: params.shortName,
        readable_collection_id: params.collectionReadableId,
        sync_immediately: false,
        ...(oauth.redirectUri ? { redirect_url: oauth.redirectUri } : {}),
      });
    } catch (error) {
      this.handleUpstreamError('create source connection', error);
    }

    let session: AirweaveConnectSession;
    try {
      session = await this.createConnectSession({
        readableCollectionId: params.collectionReadableId,
        endUserId: oauth.endUserId,
      });
    } catch (error) {
      // Source connection is created upstream but we couldn't issue a
      // session token. Fail loudly so the frontend can retry the reauth
      // endpoint instead of leaving the user with no way to authenticate.
      this.logger.error(
        `[AirweaveService] OAuth create succeeded (id=${created.id}) but connect-session failed`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new BadGatewayException(
        `Source connection ${created.id} was created but the OAuth session token could not be issued; call POST /source-connections/${created.id}/reauth to retry.`,
      );
    }

    return {
      sourceConnection: this.mapSourceConnection(created),
      sessionToken: session.sessionToken,
    };
  }

  /**
   * Rename a source connection. Per ADR-011 § Decision 7 (inline lookup-then-
   * gate), the parent-collection ownership check is performed in this method
   * — NOT a Guard variant — to avoid coupling the Guard layer to upstream I/O.
   * One Airweave round-trip on the auth path; the `get(id)` IS the source of
   * the parent's `readable_collection_id`.
   */
  async updateSourceConnection(
    sourceConnectionId: string,
    session: UserSession,
    update: { name: string },
  ): Promise<AirweaveSourceConnectionSummary> {
    const client = this.requireClient();
    const conn = await this.fetchAndAssertOwnership(
      client,
      sourceConnectionId,
      session,
    );
    try {
      const updated = await client.sourceConnections.update(
        sourceConnectionId,
        { name: update.name },
      );
      return this.mapSourceConnection(updated);
    } catch (error) {
      this.handleUpstreamError(
        'update source connection',
        error,
        `Source connection ${conn.id} not found`,
      );
    }
  }

  /**
   * Delete a source connection. Inline ownership check (see updateSourceConnection).
   * Airweave cancels any in-flight sync server-side per Assumption A5 (ADR-011).
   */
  async deleteSourceConnection(
    sourceConnectionId: string,
    session: UserSession,
  ): Promise<void> {
    const client = this.requireClient();
    await this.fetchAndAssertOwnership(client, sourceConnectionId, session);
    try {
      await client.sourceConnections.delete(sourceConnectionId);
    } catch (error) {
      this.handleUpstreamError(
        'delete source connection',
        error,
        'Source connection not found',
      );
    }
  }

  /**
   * Initiate a re-authentication flow for an OAuth source connection.
   * Returns a fresh `sessionToken` the frontend uses to open the Airweave
   * portal and complete the new OAuth handshake.
   *
   * Returns 400 when the connection's `auth_method` is direct — re-auth is
   * meaningless for credential-based connections (the caller should PATCH
   * with new credentials instead).
   */
  async reauthSourceConnection(
    sourceConnectionId: string,
    session: UserSession,
  ): Promise<{ sessionToken: string }> {
    const client = this.requireClient();
    const conn = await this.fetchAndAssertOwnership(
      client,
      sourceConnectionId,
      session,
    );

    // SDK's `SourceConnection.auth.method` is the canonical field (not the
    // mapper's optional `auth_method` widening). OAuth-browser is the only
    // method that needs a re-auth round-trip; direct / oauth_token /
    // auth_provider rotate credentials via PATCH or upstream provider config.
    const method = conn.auth?.method;
    if (method && method !== 'oauth_browser') {
      throw new BadGatewayException(
        `Re-auth is only available for OAuth-browser source connections (this one uses '${method}')`,
      );
    }

    const connectSession = await this.createConnectSession({
      readableCollectionId: conn.readable_collection_id,
      endUserId: session.user.id,
    });
    return { sessionToken: connectSession.sessionToken };
  }

  /**
   * Inline lookup-then-gate helper: fetches the source connection from
   * Airweave to discover its parent collection's `readable_id`, then defers
   * to `AirweaveAuthorizationService.assertOwnership` (which throws 403
   * for non-owning callers, no-ops for superadmin).
   *
   * `getSourceConnection` errors are mapped via `handleUpstreamError`
   * (404 → NotFoundException with a clean message; other → BadGateway).
   */
  private async fetchAndAssertOwnership(
    client: NonNullable<AirweaveSdkClient>,
    sourceConnectionId: string,
    session: UserSession,
  ): Promise<AirweaveSDK.SourceConnection> {
    const authz = this.requireAuthzService();
    let conn: AirweaveSDK.SourceConnection;
    try {
      conn = await client.sourceConnections.get(sourceConnectionId);
    } catch (error) {
      this.handleUpstreamError(
        'lookup source connection',
        error,
        'Source connection not found',
      );
    }
    await authz.assertOwnership(session, conn.readable_collection_id);
    return conn;
  }

  private requireAuthzService(): AirweaveAuthorizationService {
    if (!this.authzService) {
      throw new ServiceUnavailableException(
        'Airweave integration is not configured (authorization service missing)',
      );
    }
    return this.authzService;
  }

  private requireProjectsRepository(): IProjectsRepository {
    if (!this.projectsRepository) {
      throw new ServiceUnavailableException(
        'Airweave integration is not configured (projects repository missing)',
      );
    }
    return this.projectsRepository;
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

    // Per ADR-004: NestJS Logger; embed `action` in the message.
    this.logger.error(
      `Airweave request failed during '${action}': ${formattedError}`,
    );

    const statusCode = this.getErrorStatusCode(error);

    if (notFoundMessage && statusCode === 404) {
      throw new NotFoundException(notFoundMessage);
    }

    if (statusCode === 429) {
      // Per ADR-011 § Decision 12 (failure-mode row 13): pass `429`
      // through to the caller. We CANNOT add the upstream `Retry-After`
      // as a real HTTP header from inside a thrown exception (ADR-003
      // forbids the global filter that would normally do that), so we
      // surface the seconds value in the response BODY. Clients should
      // read `retryAfterSeconds` if present.
      const retryAfter = this.extractRetryAfterSeconds(error);
      throw new HttpException(
        {
          message: `Rate limited by Airweave during '${action}'`,
          ...(retryAfter !== null ? { retryAfterSeconds: retryAfter } : {}),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    throw new BadGatewayException(`Failed to ${action}`);
  }

  /**
   * Best-effort parse of the upstream `Retry-After` header into seconds.
   * Returns null when the header is missing, malformed, or in HTTP-date
   * format (we don't try to compute deltas from absolute dates here —
   * clients can re-issue with exponential backoff).
   */
  private extractRetryAfterSeconds(error: unknown): number | null {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('rawResponse' in error)
    ) {
      return null;
    }
    const rawResponse = (error as { rawResponse?: unknown }).rawResponse;
    if (typeof rawResponse !== 'object' || rawResponse === null) return null;
    const headers = (rawResponse as { headers?: unknown }).headers;
    if (
      !headers ||
      typeof headers !== 'object' ||
      typeof (headers as { get?: unknown }).get !== 'function'
    ) {
      return null;
    }
    const value = (headers as { get: (k: string) => string | null }).get(
      'retry-after',
    );
    if (!value) return null;
    const seconds = Number.parseInt(value, 10);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
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
