import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { RequirePermissions, PermissionsGuard } from '../../../../shared';
import { getActiveOrganizationId } from '../../../admin/users/utils/admin.utils';
import {
  RequireAirweaveOwnership,
  RequireAirweaveOwnershipFromBody,
} from '../decorators/require-airweave-ownership.decorator';
import { AirweaveOwnershipGuard } from '../guards/airweave-ownership.guard';
import { AirweaveAuthorizationService } from '../../application/services/airweave-authorization.service';
import {
  AirweaveService,
  type AirweaveSearchRetrievalStrategy,
  type AirweaveSearchTier,
} from '../../application/services/airweave.service';
import type {
  CreateCollectionBody,
  CreateSourceConnectionBody,
} from '../dto/airweave.dto';

type SearchCollectionBody = {
  query?: string;
  tier?: string;
  limit?: number | string;
  offset?: number | string;
  retrievalStrategy?: string;
};

type CreateConnectSessionBody = {
  collectionId?: string;
};

const SEARCH_TIERS: AirweaveSearchTier[] = ['classic', 'instant'];
const RETRIEVAL_STRATEGIES: AirweaveSearchRetrievalStrategy[] = [
  'semantic',
  'keyword',
  'hybrid',
];

@Controller('api/airweave')
@UseGuards(PermissionsGuard, AirweaveOwnershipGuard)
export class AirweaveController {
  constructor(
    private readonly airweaveService: AirweaveService,
    private readonly authzService: AirweaveAuthorizationService,
  ) {}

  private requireTrimmedString(value: string, fieldName: string): string {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      throw new HttpException(
        `${fieldName} is required`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return trimmedValue;
  }

  private parsePositiveInteger(
    value: number | string | undefined,
    fieldName: string,
    options: { allowZero?: boolean } = {},
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    const parsed =
      typeof value === 'number' ? value : Number.parseInt(value, 10);
    const minimum = options.allowZero ? 0 : 1;

    if (!Number.isInteger(parsed) || parsed < minimum) {
      throw new HttpException(
        `${fieldName} must be an integer greater than or equal to ${minimum}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return parsed;
  }

  private parseTier(value: string | undefined): AirweaveSearchTier {
    if (value === undefined) {
      return 'classic';
    }

    if (!SEARCH_TIERS.includes(value as AirweaveSearchTier)) {
      throw new HttpException(
        `tier must be one of: ${SEARCH_TIERS.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return value as AirweaveSearchTier;
  }

  private parseRetrievalStrategy(
    value: string | undefined,
  ): AirweaveSearchRetrievalStrategy | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      !RETRIEVAL_STRATEGIES.includes(value as AirweaveSearchRetrievalStrategy)
    ) {
      throw new HttpException(
        `retrievalStrategy must be one of: ${RETRIEVAL_STRATEGIES.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return value as AirweaveSearchRetrievalStrategy;
  }

  @Get('collections')
  @RequirePermissions('airweave:read')
  async listCollections(
    @Session() session: UserSession,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const collections = await this.airweaveService.listCollections({
      search: search?.trim() || undefined,
      limit: this.parsePositiveInteger(limit, 'limit'),
      skip: this.parsePositiveInteger(skip, 'skip', { allowZero: true }),
    });

    return {
      data: await this.authzService.applyAirweaveAllowlist(
        collections,
        session,
      ),
    };
  }

  @Post('collections')
  @RequirePermissions('airweave:create')
  async createCollection(
    @Session() session: UserSession,
    @Body() body: CreateCollectionBody,
  ) {
    const name = this.requireTrimmedString(body?.name ?? '', 'name');
    const slugHint = body?.slugHint
      ? this.requireValidSlugHint(body.slugHint)
      : undefined;

    // ADR-011 amendment 5: body `organizationId` takes precedence over the
    // session's active org. When present, the caller's membership in the
    // target org MUST be re-validated (the session-state seam that made
    // `getActiveOrganizationId` transitively safe is bypassed).
    //
    // A non-string body.organizationId (null, number, object) is rejected
    // up-front with 400; the JS-null case would otherwise reach
    // `.trim()` on null and throw a 500 TypeError. Undefined/missing falls
    // through to the active-org fallback (existing behavior preserved).
    let organizationId: string | undefined;
    const bodyOrgId = body?.organizationId;
    if (bodyOrgId !== undefined) {
      if (typeof bodyOrgId !== 'string') {
        throw new HttpException(
          'organizationId must be a string',
          HttpStatus.BAD_REQUEST,
        );
      }
      organizationId = this.requireTrimmedString(bodyOrgId, 'organizationId');
      await this.authzService.verifyCallerMembership(
        session.user.id,
        organizationId,
      );
    } else {
      organizationId = getActiveOrganizationId(session);
    }

    if (!organizationId) {
      // Mutating Airweave requires a concrete owning organization. Even
      // superadmin must operate within an active org for create — there
      // is no useful "global" owner for a new collection.
      throw new ForbiddenException(
        'Active organization required to create an Airweave collection',
      );
    }

    return {
      data: await this.airweaveService.createCollection({
        name,
        slugHint,
        organizationId,
        createdByUserId: session.user.id,
      }),
    };
  }

  @Patch('collections/:collectionId')
  @RequirePermissions('airweave:update')
  @RequireAirweaveOwnership('collectionId')
  async updateCollection(
    @Param('collectionId') collectionId: string,
    @Body() body: { name?: string },
  ) {
    const name = this.requireTrimmedString(body?.name ?? '', 'name');
    return {
      data: await this.airweaveService.updateCollection(
        this.requireTrimmedString(collectionId, 'collectionId'),
        { name },
      ),
    };
  }

  @Post('collections/:collectionId/source-connections')
  @RequirePermissions('airweave:manage-sources')
  @RequireAirweaveOwnership('collectionId')
  async createSourceConnection(
    @Session() session: UserSession,
    @Param('collectionId') collectionId: string,
    @Body() body: CreateSourceConnectionBody,
  ) {
    const collectionReadableId = this.requireTrimmedString(
      collectionId,
      'collectionId',
    );
    const name = this.requireTrimmedString(body?.name ?? '', 'name');
    const shortName = this.requireTrimmedString(
      body?.shortName ?? '',
      'shortName',
    );

    // ADR-011 § Amendment 4 (2026-05-26): only the direct branch is
    // supported here. OAuth flows use the catalog widget — see
    // `POST /api/airweave/connect/session` + the SDK on the SPA side.
    // An `auth.kind: 'oauth'` body is rejected with 400 + a clear
    // explanation so old clients fail loudly instead of silently
    // mis-creating source-connections.
    //
    // The DTO type narrows `auth.kind` to `'direct'`, but we widen at
    // runtime to defend against old clients (e.g., a stale SPA build
    // that still ships the OAuth body shape). TypeScript can't see
    // wire-shape mismatches; the runtime check is load-bearing.
    const auth = body?.authentication as
      | CreateSourceConnectionBody['authentication']
      | { kind: 'oauth' }
      | undefined;
    if (auth && auth.kind === 'oauth') {
      throw new BadRequestException(
        "authentication.kind 'oauth' is no longer supported on this endpoint. " +
          'Use POST /api/airweave/connect/session and open the SDK catalog widget; ' +
          'Airweave will create the source-connection after the user authenticates ' +
          '(see ADR-011 Amendment 4).',
      );
    }
    if (!auth || auth.kind !== 'direct') {
      throw new BadRequestException("authentication.kind must be 'direct'");
    }

    if (
      !auth.credentials ||
      typeof auth.credentials !== 'object' ||
      Array.isArray(auth.credentials)
    ) {
      throw new BadRequestException(
        'authentication.credentials must be a non-array object',
      );
    }
    return {
      data: await this.airweaveService.createSourceConnection({
        collectionReadableId,
        name,
        shortName,
        authentication: { kind: 'direct', credentials: auth.credentials },
      }),
    };
  }

  @Delete('collections/:collectionId')
  @RequirePermissions('airweave:delete')
  @RequireAirweaveOwnership('collectionId')
  async deleteCollection(
    @Session() session: UserSession,
    @Param('collectionId') collectionId: string,
  ) {
    const organizationId = getActiveOrganizationId(session);
    if (!organizationId) {
      // The Guard already approved the call (superadmin bypass or org owns
      // the collection), so reaching here without an active org means
      // superadmin without acting-as-org context — refuse mutation, defer
      // to a future "claim flow" for superadmin-side bulk operations.
      throw new ForbiddenException(
        'Active organization required to delete an Airweave collection',
      );
    }
    await this.airweaveService.deleteCollection(
      this.requireTrimmedString(collectionId, 'collectionId'),
      organizationId,
    );
    return { data: { deleted: true, collectionId } };
  }

  @Patch('source-connections/:id')
  @RequirePermissions('airweave:manage-sources')
  async updateSourceConnection(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ) {
    const sourceConnectionId = this.requireTrimmedString(id, 'id');
    const name = this.requireTrimmedString(body?.name ?? '', 'name');
    return {
      data: await this.airweaveService.updateSourceConnection(
        sourceConnectionId,
        session,
        { name },
      ),
    };
  }

  @Post('source-connections/:id/reauth')
  @RequirePermissions('airweave:manage-sources')
  async reauthSourceConnection(
    @Session() session: UserSession,
    @Param('id') id: string,
  ) {
    const sourceConnectionId = this.requireTrimmedString(id, 'id');
    return {
      data: await this.airweaveService.reauthSourceConnection(
        sourceConnectionId,
        session,
      ),
    };
  }

  @Delete('source-connections/:id')
  @RequirePermissions('airweave:manage-sources')
  async deleteSourceConnection(
    @Session() session: UserSession,
    @Param('id') id: string,
  ) {
    const sourceConnectionId = this.requireTrimmedString(id, 'id');
    await this.airweaveService.deleteSourceConnection(
      sourceConnectionId,
      session,
    );
    return { data: { deleted: true, sourceConnectionId } };
  }

  private requireValidSlugHint(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException('slugHint must be a non-empty string');
    }
    if (trimmed.length > 32) {
      throw new BadRequestException(
        'slugHint must be at most 32 characters long',
      );
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
      throw new BadRequestException(
        'slugHint must contain only lowercase letters, digits, and dashes (no leading/trailing/consecutive dashes)',
      );
    }
    return trimmed;
  }

  @Get('collections/:collectionId')
  @RequirePermissions('airweave:read')
  @RequireAirweaveOwnership('collectionId')
  async getCollection(@Param('collectionId') collectionId: string) {
    return {
      data: await this.airweaveService.getCollection(
        this.requireTrimmedString(collectionId, 'collectionId'),
      ),
    };
  }

  @Post('collections/:collectionId/search')
  @RequirePermissions('airweave:read')
  @RequireAirweaveOwnership('collectionId')
  async searchCollection(
    @Param('collectionId') collectionId: string,
    @Body() body: SearchCollectionBody,
  ) {
    const tier = this.parseTier(body?.tier);
    const retrievalStrategy = this.parseRetrievalStrategy(
      body?.retrievalStrategy,
    );

    if (tier === 'instant' && !retrievalStrategy) {
      throw new HttpException(
        'retrievalStrategy is required for instant tier searches',
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      data: await this.airweaveService.searchCollection(
        this.requireTrimmedString(collectionId, 'collectionId'),
        {
          query: this.requireTrimmedString(body?.query ?? '', 'query'),
          tier,
          limit: this.parsePositiveInteger(body?.limit, 'limit'),
          offset: this.parsePositiveInteger(body?.offset, 'offset', {
            allowZero: true,
          }),
          retrievalStrategy,
        },
      ),
    };
  }

  @Get('sources/:collectionId')
  @RequirePermissions('airweave:read')
  @RequireAirweaveOwnership('collectionId')
  async listSourceConnections(@Param('collectionId') collectionId: string) {
    return {
      data: await this.airweaveService.listSourceConnections(
        this.requireTrimmedString(collectionId, 'collectionId'),
      ),
    };
  }

  /**
   * Issue an Airweave Connect session token for a collection. The SPA
   * opens the SDK's catalog widget with this token; the user picks a
   * source, authenticates (OAuth or BYOC), and the widget tells Airweave
   * to create the source-connection under this collection.
   *
   * Per ADR-011 § Amendment 4 (2026-05-26), this is now the primary
   * (and only) entry point for OAuth-driven source-connection creation.
   * Permission tightened from `airweave:read` to `airweave:manage-sources`
   * because the session token grants the holder the ability to create
   * source-connections — that's a manage operation, not a read.
   */
  @Post('connect/session')
  @RequirePermissions('airweave:manage-sources')
  @RequireAirweaveOwnershipFromBody('collectionId')
  async createConnectSession(
    @Session() session: UserSession,
    @Body() body: CreateConnectSessionBody,
  ) {
    return {
      data: await this.airweaveService.createConnectSession({
        readableCollectionId: this.requireTrimmedString(
          body?.collectionId ?? '',
          'collectionId',
        ),
        endUserId: session.user.id,
      }),
    };
  }
}

// ADR-011 § Amendment 4: `trimAndPick` removed alongside the OAuth
// branch's BYOC pass-through. The catalog widget handles BYOC entry
// inside its own form, so no controller-side scrub is needed.
