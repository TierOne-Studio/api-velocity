import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { EMBED_SITE_REPOSITORY } from '../../../embed-sites/domain/repositories/embed-site.repository.interface';
import type { EmbedSiteRepositoryPort } from '../../../embed-sites/domain/repositories/embed-site.repository.interface';
import { normalizeOrigin } from '../../../../shared/utils/normalize-origin';
import type { RequestWithEmbedScope } from '../../application/embed-scope';

export const EMBED_KEY_HEADER = 'x-velocity-embed-key';

/**
 * Authenticates an anonymous public request as an EMBED SITE (ADR-018):
 * resolves the site by its publishable key, checks it is enabled, and validates
 * the request Origin against the site's normalized allowlist. On success it
 * attaches `{ organizationId, projectId, embedSiteId }` to the request — the
 * sole source of scope for everything downstream (never client-supplied).
 *
 * Failure modes: missing/unknown/disabled key → 401 (identical message, no
 * enumeration oracle); origin not allowlisted → 403.
 */
@Injectable()
export class PublicEmbedGuard implements CanActivate {
  constructor(
    @Inject(EMBED_SITE_REPOSITORY)
    private readonly embedSites: EmbedSiteRepositoryPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & RequestWithEmbedScope>();
    const response = http.getResponse<Response>();

    const key = (request.header(EMBED_KEY_HEADER) ?? '').trim();
    if (!key) {
      throw new UnauthorizedException('Embed key required');
    }

    const site = await this.embedSites.findByPublicKey(key);
    if (!site || !site.enabled) {
      // Same message for unknown vs disabled — don't leak which keys exist.
      throw new UnauthorizedException('Invalid embed key');
    }

    const rawOrigin = request.header('origin');
    const origin = normalizeOrigin(rawOrigin);
    const allowed = new Set(
      site.allowedOrigins.map((value) => normalizeOrigin(value)),
    );
    if (!origin || !allowed.has(origin)) {
      throw new ForbiddenException('Origin not allowed');
    }

    // Per-request CORS for the ACTUAL request is emitted HERE — only after the
    // origin is confirmed against this site's allowlist (ADR-019: a non-matching
    // origin receives no permissive CORS headers; credentials stay false). The
    // middleware handles only the keyless preflight. Echo the raw Origin so the
    // browser's exact-match check passes.
    response.setHeader('Access-Control-Allow-Origin', rawOrigin as string);
    response.setHeader('Access-Control-Allow-Credentials', 'false');
    response.setHeader('Vary', 'Origin');

    request.embedScope = {
      organizationId: site.organizationId,
      projectId: site.projectId,
      embedSiteId: site.id,
    };
    return true;
  }
}
