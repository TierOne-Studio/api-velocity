import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { getActiveOrganizationId } from '../../../admin/users/utils/admin.utils';
import { AirweaveAuthorizationService } from '../../application/services/airweave-authorization.service';
import {
  AirweaveService,
  type AirweaveSearchRetrievalStrategy,
  type AirweaveSearchTier,
} from '../../application/services/airweave.service';
import type { CreateCollectionBody } from '../dto/airweave.dto';

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

    const organizationId = getActiveOrganizationId(session);
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
      }),
    };
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
