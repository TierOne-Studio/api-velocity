import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request CORS for the `api/public/*` prefix (ADR-019), separate from the
 * global enableCors in main.ts and always `credentials: false` (no cookies on
 * this channel).
 *
 * This middleware handles ONLY the preflight OPTIONS, which does not carry the
 * embed key (custom headers aren't sent on preflight) and therefore can't be
 * allowlist-checked here. Preflight grants nothing on its own — it only
 * advertises the allowed method/headers; the browser still needs an
 * `Access-Control-Allow-Origin` on the ACTUAL response to read it.
 *
 * The actual-request `Access-Control-Allow-Origin` is emitted by
 * PublicEmbedGuard, and ONLY after the origin is confirmed against the matched
 * site's allowlist (ADR-019). So a non-allowlisted origin never receives a
 * usable CORS grant, even though the preflight reflects its origin. For actual
 * requests this middleware sets no CORS header (preventing reflected-origin on
 * any non-guarded public route).
 */
@Injectable()
export class PublicCorsMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    if (request.method !== 'OPTIONS') {
      next();
      return;
    }

    const origin = request.header('origin');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Velocity-Embed-Key',
    );
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'false');
    response.setHeader('Access-Control-Max-Age', '600');
    response.setHeader('Vary', 'Origin');
    response.status(204).end();
  }
}
