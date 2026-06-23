import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { ConfigService } from '../../../../shared/config';
import { PublicWidgetController } from './public-widget.controller';

const BUNDLE_BODY = '/* widget */(()=>{console.log("vw")})();';

async function makeApp(bundlePath: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [PublicWidgetController],
    providers: [
      {
        provide: ConfigService,
        useValue: { getWidgetBundlePath: () => bundlePath },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('PublicWidgetController — GET /api/public/widget/v1/widget.js', () => {
  let dir: string;
  let bundlePath: string;
  let app: INestApplication;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vw-bundle-'));
    bundlePath = join(dir, 'widget.js');
    writeFileSync(bundlePath, BUNDLE_BODY, 'utf8');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(async () => {
    if (app) await app.close();
  });

  it('serves the bundle as JavaScript with no key required', async () => {
    app = await makeApp(bundlePath);
    const res = await request(app.getHttpServer()).get(
      '/api/public/widget/v1/widget.js',
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.text).toBe(BUNDLE_BODY);
  });

  it('serves a public, uncredentialed, cacheable response', async () => {
    app = await makeApp(bundlePath);
    const res = await request(app.getHttpServer()).get(
      '/api/public/widget/v1/widget.js',
    );
    expect(res.headers['cache-control']).toMatch(/public/);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('returns 503 with a generic message (no server path leaked) when the bundle is missing', async () => {
    const missing = join(dir, 'does-not-exist.js');
    app = await makeApp(missing);
    const res = await request(app.getHttpServer()).get(
      '/api/public/widget/v1/widget.js',
    );
    expect(res.status).toBe(503);
    // The public body must NOT disclose the resolved filesystem path (it goes to
    // the internal log only).
    expect(JSON.stringify(res.body)).not.toContain(missing);
    expect(res.body.message).toBe('Widget bundle unavailable');
  });
});
