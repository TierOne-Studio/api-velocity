import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ConfigService } from '../src/shared/config';
import { configureApp } from '../src/bootstrap';

/**
 * Boots the FULL app exactly as production (`AppModule` + `configureApp`), so
 * the global better-auth guard AND the global credentialed `enableCors` are
 * both live — the conditions the bare controller specs omit, which let three
 * production-blocking bugs ship (public routes 401'd by the global guard; the
 * public preflight intercepted by the global CORS). Requires a test DB
 * (`.env.test`), so this runs in CI, not in a bare unit environment.
 */
describe('Public web-chat channel (full-app e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('serves widget.js WITHOUT a session — not blocked by the global auth guard', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/public/widget/v1/widget.js',
    );
    // @AllowAnonymous bypasses the global better-auth guard. Without the bundle
    // built it is 503 (our ServiceUnavailable); with it 200 — but never 401.
    expect(res.status).not.toBe(401);
    expect([200, 503]).toContain(res.status);
  });

  it('reaches the embed guard (not the global auth guard) on /config with no key', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/public/chat/config')
      .set('Origin', 'http://customer.example');
    // Our PublicEmbedGuard, not better-auth's `{"code":"UNAUTHORIZED"}`.
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid embed key');
  });

  it('answers the public preflight from a customer origin with an allowlisted-CORS grant', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/public/chat/ask/stream')
      .set('Origin', 'http://customer.example')
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        'content-type,x-velocity-embed-key',
      );

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://customer.example',
    );
    expect(res.headers['access-control-allow-credentials']).toBe('false');
  });
});
