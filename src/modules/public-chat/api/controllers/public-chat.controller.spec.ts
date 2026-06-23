import { afterEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService } from '../../../../shared/config';
import { AdminOrganizationsService } from '../../../admin/organizations/application/services/admin-organizations.service';
import {
  ChatAgentService,
  type ChatStreamEvent,
} from '../../../chat/application/services/chat-agent.service';
import { ProjectsService } from '../../../projects/application/services/projects.service';
import {
  EMBED_SITE_REPOSITORY,
  type EmbedSiteRepositoryPort,
} from '../../../embed-sites/domain/repositories/embed-site.repository.interface';
import type { EmbedSite } from '../../../embed-sites/domain/entities/embed-site';
import { PublicChatService } from '../../application/public-chat.service';
import { PublicEmbedGuard } from '../guards/public-embed.guard';
import { PublicRateLimitGuard } from '../guards/public-rate-limit.guard';
import { PublicChatController } from './public-chat.controller';

const OK_KEY = 'wgt_pub_ok';
const DISABLED_KEY = 'wgt_pub_disabled';
const ORIGIN = 'https://customer.com';

function site(overrides: Partial<EmbedSite> = {}): EmbedSite {
  return {
    id: 'site-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    name: 'Site',
    publicKey: OK_KEY,
    allowedOrigins: [ORIGIN],
    enabled: true,
    theme: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Default agent: typed against the REAL ChatStreamEvent union, so if the stream
// contract drifts (e.g. `chunk` renames `content`) this test fails to compile —
// pinning §7.6 "same event shapes" to the real type, not a free-form mock.
async function* happyStream(): AsyncGenerator<ChatStreamEvent> {
  yield { type: 'chunk', content: 'Hello' };
  yield { type: 'done', reply: { content: 'Hello', metadata: {} } };
}

async function* throwingStream(): AsyncGenerator<ChatStreamEvent> {
  yield { type: 'chunk', content: 'partial' };
  throw new Error('internal LLM blew up with secret detail');
}

async function makeApp(
  monthlyCap = 10000,
  streamImpl: () => AsyncGenerator<ChatStreamEvent> = happyStream,
  rateLimits: { perIp?: number; perKey?: number } = {},
): Promise<INestApplication> {
  // Only the two public-path methods are exercised here; the admin CRUD methods
  // on the port (Slice 2) are never hit on this channel.
  const repo = {
    async findByPublicKey(key: string) {
      if (key === OK_KEY) return site();
      if (key === DISABLED_KEY) return site({ enabled: false });
      return null;
    },
    async findById(id: string, organizationId: string) {
      if (id === 'site-1' && organizationId === 'org-1') {
        return site({ theme: { primaryColor: '#0a7d55' } });
      }
      return null;
    },
    async incrementMonthlyUsage() {
      return 1;
    },
  } as unknown as EmbedSiteRepositoryPort;

  const agent = {
    generateReplyStreaming: () => streamImpl(),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [PublicChatController],
    providers: [
      PublicChatService,
      PublicEmbedGuard,
      PublicRateLimitGuard,
      {
        provide: ConfigService,
        useValue: {
          getEmbedPublicRateLimitTtlSeconds: () => 60,
          getEmbedPublicRateLimitPerIp: () => rateLimits.perIp ?? 1000,
          getEmbedPublicRateLimitPerKey: () => rateLimits.perKey ?? 1000,
          getEmbedPublicMonthlyCap: () => monthlyCap,
          getEmbedPublicMaxQuestionLength: () => 2000,
        },
      },
      {
        provide: ProjectsService,
        useValue: {
          resolveProjectSources: async () => ({
            project: { name: 'Proj' },
            sources: [{ kind: 'vector_db', status: 'ready', id: 'v' }],
          }),
        },
      },
      {
        provide: AdminOrganizationsService,
        useValue: { findById: async () => ({ name: 'Org' }) },
      },
      { provide: ChatAgentService, useValue: agent },
      { provide: EMBED_SITE_REPOSITORY, useValue: repo },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('PublicChatController (HTTP) — POST /api/public/chat/ask/stream', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  const post = () =>
    request(app.getHttpServer()).post('/api/public/chat/ask/stream');

  it('401 when the embed key header is missing', async () => {
    app = await makeApp();
    await post().set('origin', ORIGIN).send({ question: 'hi' }).expect(401);
  });

  it('401 for an unknown key', async () => {
    app = await makeApp();
    await post()
      .set('x-velocity-embed-key', 'wgt_pub_nope')
      .set('origin', ORIGIN)
      .send({ question: 'hi' })
      .expect(401);
  });

  it('401 for a disabled key', async () => {
    app = await makeApp();
    await post()
      .set('x-velocity-embed-key', DISABLED_KEY)
      .set('origin', ORIGIN)
      .send({ question: 'hi' })
      .expect(401);
  });

  it('403 for a non-allowlisted origin', async () => {
    app = await makeApp();
    await post()
      .set('x-velocity-embed-key', OK_KEY)
      .set('origin', 'https://evil.com')
      .send({ question: 'hi' })
      .expect(403);
  });

  it('400 for an empty question', async () => {
    app = await makeApp();
    await post()
      .set('x-velocity-embed-key', OK_KEY)
      .set('origin', ORIGIN)
      .send({ question: '   ' })
      .expect(400);
  });

  it('400 for an oversized question', async () => {
    app = await makeApp();
    await post()
      .set('x-velocity-embed-key', OK_KEY)
      .set('origin', ORIGIN)
      .send({ question: 'x'.repeat(2001) })
      .expect(400);
  });

  it('429 when the org monthly cap is exceeded', async () => {
    app = await makeApp(0); // cap 0 → any usage (1) exceeds it
    await post()
      .set('x-velocity-embed-key', OK_KEY)
      .set('origin', ORIGIN)
      .send({ question: 'hi' })
      .expect(429);
  });

  // §7.4 rate-limit half, proven at the SURFACE the SPEC names (the wired public
  // endpoint), not only at the guard unit. Drives N+1 requests through the real
  // pipeline; the (N+1)th must 429. Red-on-revert if the rate-limit guard is
  // unwired from the controller.
  it('429 once the per-IP burst limit is exceeded over the wired endpoint', async () => {
    app = await makeApp(10000, happyStream, { perIp: 2 });
    const fire = () =>
      post()
        .set('x-velocity-embed-key', OK_KEY)
        .set('origin', ORIGIN)
        .send({ question: 'hi' });
    await fire().expect(200);
    await fire().expect(200);
    await fire().expect(429); // 3rd from the same IP trips the per-IP bucket
  });

  // The per-KEY tracker is NOT the default IP-keyed behaviour (SPEC §6/§10.1) —
  // prove it fires independently over HTTP with the per-IP ceiling left high.
  it('429 once the per-key burst limit is exceeded over the wired endpoint', async () => {
    app = await makeApp(10000, happyStream, { perKey: 2, perIp: 1000 });
    const fire = () =>
      post()
        .set('x-velocity-embed-key', OK_KEY)
        .set('origin', ORIGIN)
        .send({ question: 'hi' });
    await fire().expect(200);
    await fire().expect(200);
    await fire().expect(429); // 3rd with the same embed key trips the per-key bucket
  });

  it('200 streams an SSE answer (chunk + done) with no session required', async () => {
    app = await makeApp();
    const response = await post()
      .set('x-velocity-embed-key', OK_KEY)
      .set('origin', ORIGIN)
      .send({ question: 'hi' })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: chunk');
    expect(response.text).toContain('event: done');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('emits an SSE error event with a generic message when the stream fails mid-flight (no internal detail leaked)', async () => {
    app = await makeApp(10000, throwingStream);
    const response = await post()
      .set('x-velocity-embed-key', OK_KEY)
      .set('origin', ORIGIN)
      .send({ question: 'hi' })
      .expect(200);

    expect(response.text).toContain('event: chunk'); // the partial chunk made it
    expect(response.text).toContain('event: error');
    expect(response.text).toContain('Failed to stream message');
    // The internal Error detail must NOT reach the anonymous client.
    expect(response.text).not.toContain('secret detail');
  });
});

describe('PublicChatController (HTTP) — GET /api/public/chat/config', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  const get = () => request(app.getHttpServer()).get('/api/public/chat/config');

  it('returns the embed site theme for a valid key from an allowlisted origin', async () => {
    app = await makeApp();
    const response = await get()
      .set('x-velocity-embed-key', OK_KEY)
      .set('origin', ORIGIN)
      .expect(200);

    expect(response.body).toEqual({ theme: { primaryColor: '#0a7d55' } });
  });

  it('401 when the embed key header is missing (no enumeration oracle)', async () => {
    app = await makeApp();
    await get().set('origin', ORIGIN).expect(401);
  });

  it('403 for a valid key from a non-allowlisted origin', async () => {
    app = await makeApp();
    await get()
      .set('x-velocity-embed-key', OK_KEY)
      .set('origin', 'https://evil.com')
      .expect(403);
  });

  it('is subject to the same per-key throttler as ask', async () => {
    app = await makeApp(10000, happyStream, { perKey: 1, perIp: 1000 });
    const fire = () =>
      get().set('x-velocity-embed-key', OK_KEY).set('origin', ORIGIN);
    await fire().expect(200);
    await fire().expect(429);
  });
});
