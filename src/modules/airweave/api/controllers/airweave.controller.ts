import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { RequirePermissions, PermissionsGuard } from '../../../../shared';
import {
  AdminOrganizationsService,
  getActiveOrganizationId,
  getPlatformRole,
} from '../../../admin';
import {
  AirweaveService,
  type AirweaveCollectionSummary,
  type AirweaveSearchRetrievalStrategy,
  type AirweaveSearchTier,
} from '../../application/services/airweave.service';

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
@UseGuards(PermissionsGuard)
export class AirweaveController {
  constructor(
    private readonly airweaveService: AirweaveService,
    private readonly adminOrganizationsService: AdminOrganizationsService,
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
  @RequirePermissions('organization:read')
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
      data: await this.applyAirweaveAllowlist(collections, session),
    };
  }

  private async applyAirweaveAllowlist(
    collections: AirweaveCollectionSummary[],
    session: UserSession,
  ): Promise<AirweaveCollectionSummary[]> {
    const platformRole = getPlatformRole(session);
    if (platformRole === 'superadmin') return collections;

    const activeOrgId = getActiveOrganizationId(session);
    if (!activeOrgId) return [];

    const organization =
      await this.adminOrganizationsService.findById(activeOrgId);
    if (!organization) return [];

    const allowed = this.readAllowedAirweaveCollectionIds(
      organization.metadata,
    );

    if (allowed.length === 0) return [];
    const allowedSet = new Set(allowed);
    return collections.filter((collection) =>
      allowedSet.has(collection.readableId),
    );
  }

  private readAllowedAirweaveCollectionIds(
    metadata: Record<string, unknown> | null,
  ): string[] {
    if (!metadata) return [];
    const raw = metadata['allowedAirweaveCollectionIds'];
    if (!Array.isArray(raw)) return [];
    return raw.filter((value): value is string => typeof value === 'string');
  }

  @Get('collections/:collectionId')
  @RequirePermissions('organization:read')
  async getCollection(@Param('collectionId') collectionId: string) {
    return {
      data: await this.airweaveService.getCollection(
        this.requireTrimmedString(collectionId, 'collectionId'),
      ),
    };
  }

  @Post('collections/:collectionId/search')
  @RequirePermissions('organization:read')
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
  @RequirePermissions('organization:read')
  async listSourceConnections(@Param('collectionId') collectionId: string) {
    return {
      data: await this.airweaveService.listSourceConnections(
        this.requireTrimmedString(collectionId, 'collectionId'),
      ),
    };
  }

  @Post('connect/session')
  @RequirePermissions('organization:read')
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
