import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import {
  AIRWEAVE_OWNERSHIP_KEY,
  type AirweaveOwnershipSource,
} from '../decorators/require-airweave-ownership.decorator';
import { AirweaveAuthorizationService } from '../../application/services/airweave-authorization.service';

type GuardedRequest = {
  session?: UserSession;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
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
  constructor(
    private readonly reflector: Reflector,
    private readonly authzService: AirweaveAuthorizationService,
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

    await this.authzService.assertOwnership(request.session, rawValue.trim());

    return true;
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
