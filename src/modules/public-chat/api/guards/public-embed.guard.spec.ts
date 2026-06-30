import { describe, expect, it, jest } from '@jest/globals';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { EmbedSite } from '../../../embed-sites/domain/entities/embed-site';
import type { EmbedSiteRepositoryPort } from '../../../embed-sites/domain/repositories/embed-site.repository.interface';
import type { RequestWithEmbedScope } from '../../application/embed-scope';
import { PublicEmbedGuard } from './public-embed.guard';

function makeSite(overrides: Partial<EmbedSite> = {}): EmbedSite {
  return {
    id: 'site-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    name: 'Site',
    publicKey: 'wgt_pub_abc',
    allowedOrigins: ['https://customer.com'],
    enabled: true,
    theme: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: Request & RequestWithEmbedScope;
  responseHeaders: Record<string, string>;
} {
  const request = {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request & RequestWithEmbedScope;
  const responseHeaders: Record<string, string> = {};
  const response = {
    setHeader: (key: string, value: string) => {
      responseHeaders[key] = value;
    },
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, request, responseHeaders };
}

function makeGuard(site: EmbedSite | null): {
  guard: PublicEmbedGuard;
  findByPublicKey: jest.Mock;
} {
  const findByPublicKey = jest.fn(async () => site);
  const repo = {
    findByPublicKey,
    incrementMonthlyUsage: jest.fn(),
  } as unknown as EmbedSiteRepositoryPort;
  return { guard: new PublicEmbedGuard(repo), findByPublicKey };
}

describe('PublicEmbedGuard', () => {
  it('throws 401 when the embed key header is missing (without a DB lookup)', async () => {
    const { guard, findByPublicKey } = makeGuard(makeSite());
    const { context } = buildContext({ origin: 'https://customer.com' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findByPublicKey).not.toHaveBeenCalled();
  });

  it('throws 401 for an unknown key', async () => {
    const { guard } = makeGuard(null);
    const { context } = buildContext({
      'x-velocity-embed-key': 'wgt_pub_nope',
      origin: 'https://customer.com',
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws 401 for a disabled key', async () => {
    const { guard } = makeGuard(makeSite({ enabled: false }));
    const { context } = buildContext({
      'x-velocity-embed-key': 'wgt_pub_abc',
      origin: 'https://customer.com',
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns an identical 401 message for missing, unknown, and disabled keys (no enumeration oracle)', async () => {
    const cases: Array<{ site: EmbedSite | null; key?: string }> = [
      { site: makeSite() }, // missing key header
      { site: null, key: 'wgt_pub_nope' }, // unknown key
      { site: makeSite({ enabled: false }), key: 'wgt_pub_abc' }, // disabled
    ];
    const messages: string[] = [];
    for (const { site, key } of cases) {
      const { guard } = makeGuard(site);
      const { context } = buildContext({
        ...(key ? { 'x-velocity-embed-key': key } : {}),
        origin: 'https://customer.com',
      });
      const error = await guard
        .canActivate(context)
        .then(() => null)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      messages.push((error as Error).message);
    }
    // The actual thrown messages — all three must be byte-identical.
    expect(new Set(messages)).toEqual(new Set(['Invalid embed key']));
  });

  it('throws 403 when the origin is not allowlisted', async () => {
    const { guard } = makeGuard(makeSite());
    const { context } = buildContext({
      'x-velocity-embed-key': 'wgt_pub_abc',
      origin: 'https://evil.com',
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws 403 when the origin header is missing', async () => {
    const { guard } = makeGuard(makeSite());
    const { context } = buildContext({ 'x-velocity-embed-key': 'wgt_pub_abc' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows and attaches the resolved scope on a valid key + allowlisted origin', async () => {
    const { guard } = makeGuard(makeSite());
    const { context, request } = buildContext({
      'x-velocity-embed-key': 'wgt_pub_abc',
      origin: 'https://customer.com',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.embedScope).toEqual({
      organizationId: 'org-1',
      projectId: 'proj-1',
      embedSiteId: 'site-1',
    });
  });

  it('emits allowlist-gated CORS headers only after the origin matches (echoing the raw origin, credentials false)', async () => {
    const { guard } = makeGuard(makeSite());
    const { context, responseHeaders } = buildContext({
      'x-velocity-embed-key': 'wgt_pub_abc',
      origin: 'https://customer.com',
    });

    await guard.canActivate(context);
    expect(responseHeaders['Access-Control-Allow-Origin']).toBe(
      'https://customer.com',
    );
    expect(responseHeaders['Access-Control-Allow-Credentials']).toBe('false');
    expect(responseHeaders['Vary']).toBe('Origin');
  });

  it('emits NO CORS header when the origin is rejected (403)', async () => {
    const { guard } = makeGuard(makeSite());
    const { context, responseHeaders } = buildContext({
      'x-velocity-embed-key': 'wgt_pub_abc',
      origin: 'https://evil.com',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(responseHeaders['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('matches the origin after normalization (case/port/trailing slash)', async () => {
    const { guard } = makeGuard(
      makeSite({ allowedOrigins: ['https://customer.com'] }),
    );
    const { context } = buildContext({
      'x-velocity-embed-key': 'wgt_pub_abc',
      origin: 'https://Customer.com:443/',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  // §7.4b anti-bypass half: matching is EXACT on the normalized origin — a
  // bare-suffix / substring / subdomain origin must NEVER match the allowlisted
  // host. This is the classic CORS footgun the SPEC calls out; a substring impl
  // (e.g. `allowedOrigins.some(o => origin.includes(o))`) would let every one of
  // these through, so each case is red-on-revert.
  it.each([
    ['suffix-attached host', 'https://customer.com.evil.com'],
    ['substring/prefix host', 'https://evilcustomer.com'],
    ['unlisted subdomain', 'https://app.customer.com'],
    ['scheme downgrade', 'http://customer.com'],
  ])(
    'throws 403 for a %s that is not an exact allowlist match',
    async (_label, origin) => {
      const { guard } = makeGuard(
        makeSite({ allowedOrigins: ['https://customer.com'] }),
      );
      const { context, responseHeaders } = buildContext({
        'x-velocity-embed-key': 'wgt_pub_abc',
        origin,
      });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // And no permissive CORS grant leaks to the rejected origin.
      expect(responseHeaders['Access-Control-Allow-Origin']).toBeUndefined();
    },
  );
});
