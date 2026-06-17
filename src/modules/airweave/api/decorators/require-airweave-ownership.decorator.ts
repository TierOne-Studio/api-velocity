import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key read by `AirweaveOwnershipGuard` to discover where the
 * Airweave collection's `readable_id` lives on the incoming request.
 *
 * Two variants exist because endpoints carry the id in different places:
 *   - Route param  →  `RequireAirweaveOwnership('collectionId')`
 *   - Request body →  `RequireAirweaveOwnershipFromBody('airweaveCollectionId')`
 *
 * Source-connection endpoints (where the parent collection id is only
 * discoverable via an Airweave SDK lookup) deliberately do NOT use a
 * decorator — they call `AirweaveAuthorizationService.assertOwnership(...)`
 * inline at the start of the service method to keep the Guard layer free
 * of upstream I/O. See Decision §7 of ADR-011 + plan §Step 3.
 */
export const AIRWEAVE_OWNERSHIP_KEY = 'airweave_ownership_source';

export type AirweaveOwnershipSource = {
  /** Where to read the collection's `readable_id` from on the request. */
  source: 'param' | 'body';
  /** Name of the route param or top-level body field. */
  name: string;
};

/**
 * Gate a controller method by ownership of an Airweave collection whose
 * `readable_id` is supplied via a route parameter.
 *
 * @example
 *   @Patch('collections/:collectionId')
 *   @RequirePermissions('airweave:update')
 *   @RequireAirweaveOwnership('collectionId')
 *   async updateCollection(@Param('collectionId') id: string, ...) { ... }
 */
export const RequireAirweaveOwnership = (routeParam: string) =>
  SetMetadata(AIRWEAVE_OWNERSHIP_KEY, {
    source: 'param',
    name: routeParam,
  } satisfies AirweaveOwnershipSource);

/**
 * Gate a controller method by ownership of an Airweave collection whose
 * `readable_id` is supplied via a top-level field on the request body.
 *
 * @example
 *   @Post('connect/session')
 *   @RequirePermissions('airweave:read')
 *   @RequireAirweaveOwnershipFromBody('airweaveCollectionId')
 *   async createConnectSession(@Body() body: { airweaveCollectionId: string }) { ... }
 */
export const RequireAirweaveOwnershipFromBody = (bodyField: string) =>
  SetMetadata(AIRWEAVE_OWNERSHIP_KEY, {
    source: 'body',
    name: bodyField,
  } satisfies AirweaveOwnershipSource);
