import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ConfigService } from '../../../../shared/config';
import {
  getActiveOrganizationId,
  getPlatformRole,
} from '../../../admin/users/utils/admin.utils';
import {
  AIRWEAVE_OWNERSHIP_KEY,
  type AirweaveOwnershipSource,
} from '../decorators/require-airweave-ownership.decorator';
import { AirweaveAuthorizationService } from '../../application/services/airweave-authorization.service';

type GuardedRequest = {
  session?: UserSession;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  url?: string;
  originalUrl?: string;
  method?: string;
};

/**
 * Gate a controller method by ownership of an Airweave collection.
 *
 * Reads `AIRWEAVE_OWNERSHIP_KEY` metadata set by the
 * `@RequireAirweaveOwnership(...)` / `@RequireAirweaveOwnershipFromBody(...)`
 * decorators to discover where the collection's `readable_id` lives on
 * the request. Pulls the id from that location, then defers the
 * authorization decision to `AirweaveAuthorizationService.assertOwnership(...)`.
 *
 * Pairs with `PermissionsGuard` — typically both are applied at the
 * controller class level, with the role gate (`@RequirePermissions(...)`)
 * filtering coarse access and this ownership gate filtering per-collection
 * access. PermissionsGuard runs first by convention (its registration
 * order on the controller).
 *
 * NOT used for source-connection endpoints (Step 7 of the airweave CRUD
 * plan): there, the parent collection id requires an Airweave SDK lookup,
 * so the gate is performed inline at the start of the service method —
 * keeps the Guard layer free of upstream I/O.
 */
@Injectable()
export class AirweaveOwnershipGuard implements CanActivate {
  private readonly logger = new Logger(AirweaveOwnershipGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authzService: AirweaveAuthorizationService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const source = this.reflector.getAllAndOverride<
      AirweaveOwnershipSource | undefined
    >(AIRWEAVE_OWNERSHIP_KEY, [context.getHandler(), context.getClass()]);

    if (!source) {
      // No `@RequireAirweaveOwnership(...)` on this handler — guard is a no-op.
      return true;
    }

    const request = context.switchToHttp().getRequest<GuardedRequest>();

    if (!request.session?.user) {
      throw new ForbiddenException('Authentication required');
    }

    const rawValue = this.extractValue(request, source);

    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
      throw new BadRequestException(
        `${source.source === 'param' ? 'Route parameter' : 'Request body field'} '${source.name}' must be a non-empty string`,
      );
    }

    const collectionReadableId = rawValue.trim();

    try {
      await this.authzService.assertOwnership(
        request.session,
        collectionReadableId,
      );
      return true;
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;

      // Read-lockdown flag (ADR-011 § Decision 4 + Step 10a/10b). When the
      // flag is OFF (default), we log a structured warning so SRE can
      // observe cross-org reads in production before flipping to enforce.
      // When ON, the 403 propagates as normal.
      if (this.configService.getAirweaveReadLockdownEnforce()) {
        throw error;
      }

      this.logger.warn(
        // Structured payload as a single JSON string so downstream log
        // aggregators can parse it without a custom transport.
        `airweave.read_would_403 ${JSON.stringify({
          userId: request.session.user.id,
          userRole: getPlatformRole(request.session),
          orgId: getActiveOrganizationId(request.session),
          collectionReadableId,
          route: request.originalUrl ?? request.url ?? null,
          method: request.method ?? null,
          source: source.source,
        })}`,
      );
      return true;
    }
  }

  private extractValue(
    request: GuardedRequest,
    source: AirweaveOwnershipSource,
  ): unknown {
    if (source.source === 'param') {
      return request.params?.[source.name];
    }
    return request.body?.[source.name];
  }
}
