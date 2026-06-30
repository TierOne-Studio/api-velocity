import type { INestApplication } from '@nestjs/common';
import type { Express, NextFunction, Request, Response } from 'express';
import { ConfigService } from './shared/config';
import { PublicCorsMiddleware } from './modules/public-chat/api/middleware/public-cors.middleware';

/**
 * Applies the global HTTP setup shared by production bootstrap (`main.ts`) and
 * the e2e harness. Extracted so the middleware ORDERING — which is load-bearing
 * for the public channel's CORS — is testable, not buried in `main.ts`.
 */
export function configureApp(
  app: INestApplication,
  config: ConfigService,
): void {
  const expressInstance = app.getHttpAdapter().getInstance() as Express;

  // Trust proxy controls request.ip derivation behind a load balancer — required
  // for the public-chat per-IP rate limiter to identify real clients (SPEC-003).
  expressInstance.set('trust proxy', config.getTrustProxy());

  // The public web-chat channel (api/public/*) uses per-request, allowlist-driven
  // CORS with credentials:false (ADR-019) for customer origins that are NOT in
  // trustedOrigins. It MUST be registered BEFORE the global credentialed
  // enableCors below: otherwise the global CORS answers the public preflight
  // OPTIONS without an Access-Control-Allow-Origin (the customer origin isn't
  // trusted) and the browser rejects it before the real request is sent. The
  // PublicEmbedGuard still gates the actual request's ACAO by the site allowlist.
  const publicCors = new PublicCorsMiddleware();
  expressInstance.use(
    '/api/public',
    (req: Request, res: Response, next: NextFunction) =>
      publicCors.use(req, res, next),
  );

  app.enableCors({
    origin: config.getTrustedOrigins(),
    credentials: true,
  });
}
