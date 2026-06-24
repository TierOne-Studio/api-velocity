/**
 * Standalone test server for the public-widget Playwright e2e (SPEC-003 Slice
 * 3). Boots the REAL public-chat HTTP surface — real `PublicEmbedGuard`, real
 * `PublicRateLimitGuard`, real `PublicCorsMiddleware`, real controllers, and
 * the REAL built widget bundle — against an in-memory embed-site repo and a
 * deterministic faked agent (no Postgres, no LLM). Slice 1 already proved
 * data/RBAC isolation vs real Postgres; this slice owns the browser surface,
 * so the origin allow/deny is enforced by the real guard here (non-vacuous),
 * not by a mock.
 *
 * Two static host pages are served on distinct origins: one allowlisted, one
 * not — so the e2e exercises the real cross-origin CORS + guard decision.
 */
import { Module, type MiddlewareConsumer, type NestModule, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer } from 'http';
import { resolve } from 'path';
import { ConfigService } from '../../src/shared/config';
import { AdminOrganizationsService } from '../../src/modules/admin/organizations/application/services/admin-organizations.service';
import { ChatAgentService } from '../../src/modules/chat/application/services/chat-agent.service';
import { ProjectsService } from '../../src/modules/projects/application/services/projects.service';
import { EMBED_SITE_REPOSITORY } from '../../src/modules/embed-sites/domain/repositories/embed-site.repository.interface';
import { PublicChatController } from '../../src/modules/public-chat/api/controllers/public-chat.controller';
import { PublicWidgetController } from '../../src/modules/public-chat/api/controllers/public-widget.controller';
import { PublicCorsMiddleware } from '../../src/modules/public-chat/api/middleware/public-cors.middleware';
import { PublicEmbedGuard } from '../../src/modules/public-chat/api/guards/public-embed.guard';
import { PublicRateLimitGuard } from '../../src/modules/public-chat/api/guards/public-rate-limit.guard';
import { PublicChatService } from '../../src/modules/public-chat/application/public-chat.service';

const API_PORT = 3199;
const ALLOWED_PORT = 4173;
const BLOCKED_PORT = 4199;
const ALLOWED_ORIGIN = `http://localhost:${ALLOWED_PORT}`;

const SITE = {
  id: 'site-e2e',
  organizationId: 'org-e2e',
  projectId: 'proj-e2e',
  name: 'E2E',
  publicKey: 'wgt_pub_ok',
  allowedOrigins: [ALLOWED_ORIGIN],
  enabled: true,
  theme: { primaryColor: 'rgb(10, 125, 85)', title: 'E2E Assistant' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const repo = {
  findByPublicKey: async (key: string) => (key === SITE.publicKey ? SITE : null),
  findById: async (id: string, org: string) =>
    id === SITE.id && org === SITE.organizationId ? SITE : null,
  incrementMonthlyUsage: async () => 1,
};

const agent = {
  generateReplyStreaming: async function* (params: { question?: string }) {
    yield { type: 'searching', query: 'pricing' };
    if (params?.question?.includes('MARKDOWN')) {
      const md =
        '## Quarterly results\n\n- **Revenue:** up 12%\n- **Churn:** down 3%\n\n' +
        'See [report](https://example.com/r) and [evil](javascript:alert(1)).';
      yield { type: 'chunk', content: md };
      yield { type: 'done', reply: { content: md, metadata: { sources: [] } } };
      return;
    }
    yield { type: 'chunk', content: 'The answer is 42.' };
    if (params?.question?.includes('DROP')) {
      // Simulate a transport drop: end the stream WITHOUT a terminal `done`
      // event so the widget surfaces its connection-closed error path.
      return;
    }
    yield {
      type: 'done',
      reply: {
        content: 'The answer is 42.',
        metadata: {
          sources: [
            {
              name: 'Pricing Guide',
              webUrl: 'https://example.com/pricing',
              sourceName: 'Confluence',
              entityType: 'page',
            },
          ],
        },
      },
    };
  },
};

const configStub = {
  getEmbedPublicRateLimitTtlSeconds: () => 60,
  getEmbedPublicRateLimitPerIp: () => 1000,
  getEmbedPublicRateLimitPerKey: () => 1000,
  getEmbedPublicMonthlyCap: () => 10000,
  getEmbedPublicMaxQuestionLength: () => 2000,
  getWidgetBundlePath: () =>
    resolve(__dirname, '../../dist/public-widget/widget.js'),
};

@Module({
  controllers: [PublicChatController, PublicWidgetController],
  providers: [
    PublicChatService,
    PublicEmbedGuard,
    PublicRateLimitGuard,
    { provide: ConfigService, useValue: configStub },
    {
      provide: ProjectsService,
      useValue: {
        resolveProjectSources: async () => ({
          project: { name: 'Proj' },
          sources: [{ kind: 'vector_db', status: 'ready', id: 'v' }],
        }),
      },
    },
    { provide: AdminOrganizationsService, useValue: { findById: async () => ({ name: 'Org' }) } },
    { provide: ChatAgentService, useValue: agent },
    { provide: EMBED_SITE_REPOSITORY, useValue: repo },
  ],
})
class WidgetE2EHarnessModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PublicCorsMiddleware)
      .forRoutes({ path: 'api/public/*', method: RequestMethod.ALL });
  }
}

function hostPage(): string {
  // The <script> is intentionally placed in <head> (where document.body is null
  // at execution time) so the e2e exercises the DOMContentLoaded-deferred mount
  // — the widget must still render. Customer snippets are commonly in <head>.
  return `<!doctype html><html><head><meta charset="utf-8"><title>host</title>
<script src="http://localhost:${API_PORT}/api/public/widget/v1/widget.js"
        data-embed-key="wgt_pub_ok"
        data-api-base="http://localhost:${API_PORT}"
        data-launcher-label="Ask"
        data-theme="obsidian"></script>
</head>
<body><h1>Host page</h1></body></html>`;
}

function startStatic(port: number): Promise<void> {
  return new Promise((res) => {
    createServer((_req, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(hostPage());
    }).listen(port, res);
  });
}

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [WidgetE2EHarnessModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(API_PORT);
  await startStatic(ALLOWED_PORT);
  await startStatic(BLOCKED_PORT);
  // Sentinel line Playwright's webServer waits on.
  console.log(`[widget-e2e] ready: api=${API_PORT} allowed=${ALLOWED_PORT} blocked=${BLOCKED_PORT}`);
}

void main();
