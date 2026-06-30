import { afterEach, describe, expect, it } from '@jest/globals';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService } from './shared/config';
import { configureApp } from './bootstrap';

@Controller('api/public/probe')
class PublicProbeController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Controller('api/private/probe')
class PrivateProbeController {
  @Get()
  ping() {
    return { ok: true };
  }
}

const config = {
  getTrustProxy: () => false,
  getTrustedOrigins: () => ['http://trusted.app'],
} as unknown as ConfigService;

describe('configureApp — middleware ordering', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function makeApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicProbeController, PrivateProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, config);
    await app.init();
    return app;
  }

  // Regression for the production CORS bug: the global credentialed enableCors
  // (origin: trustedOrigins) was intercepting the public preflight and replying
  // WITHOUT an Access-Control-Allow-Origin for customer origins — so the browser
  // rejected every public request. The public CORS middleware MUST run first.
  it('grants public CORS on a preflight from a NON-trusted customer origin', async () => {
    await makeApp();
    const res = await request(app.getHttpServer())
      .options('/api/public/probe')
      .set('Origin', 'http://customer.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-velocity-embed-key');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://customer.example');
    expect(res.headers['access-control-allow-credentials']).toBe('false');
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toContain('X-Velocity-Embed-Key');
  });

  it('still applies the global credentialed CORS to a trusted origin on a non-public route', async () => {
    await makeApp();
    const res = await request(app.getHttpServer())
      .options('/api/private/probe')
      .set('Origin', 'http://trusted.app')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBe('http://trusted.app');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
