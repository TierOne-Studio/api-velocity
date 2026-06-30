import { describe, expect, it, jest } from '@jest/globals';
import { HttpException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '../../../shared/config';
import type { AdminOrganizationsService } from '../../admin/organizations/application/services/admin-organizations.service';
import type { ChatAgentService } from '../../chat/application/services/chat-agent.service';
import type { ProjectsService } from '../../projects/application/services/projects.service';
import type { EmbedSiteRepositoryPort } from '../../embed-sites/domain/repositories/embed-site.repository.interface';
import type { EmbedScope } from './embed-scope';
import { PublicChatService } from './public-chat.service';

const scope: EmbedScope = {
  organizationId: 'org-1',
  projectId: 'proj-1',
  embedSiteId: 'site-1',
};

type Deps = {
  sources?: Array<{ kind: string; status: string; id: string }>;
  organization?: { name: string } | null;
  usageCount?: number;
  monthlyCap?: number;
};

function build(deps: Deps = {}) {
  const generateReplyStreaming = jest.fn(() => (async function* () {})());
  const resolveProjectSources = jest.fn(async () => ({
    project: { name: 'Proj' },
    sources: deps.sources ?? [],
  }));
  const findById = jest.fn(async () =>
    deps.organization === undefined ? { name: 'Org' } : deps.organization,
  );
  const incrementMonthlyUsage = jest.fn(async () => deps.usageCount ?? 1);

  const service = new PublicChatService(
    { resolveProjectSources } as unknown as ProjectsService,
    { findById } as unknown as AdminOrganizationsService,
    { generateReplyStreaming } as unknown as ChatAgentService,
    { incrementMonthlyUsage } as unknown as EmbedSiteRepositoryPort,
    {
      getEmbedPublicMonthlyCap: () => deps.monthlyCap ?? 10000,
    } as unknown as ConfigService,
  );

  return { service, generateReplyStreaming, incrementMonthlyUsage };
}

describe('PublicChatService.prepareStream', () => {
  it('passes only allowlisted, ready sources to the agent (database/external/non-ready stripped)', async () => {
    const { service, generateReplyStreaming } = build({
      sources: [
        { kind: 'airweave_collection', status: 'ready', id: 'a' },
        { kind: 'vector_db', status: 'ready', id: 'v' },
        { kind: 'database', status: 'ready', id: 'd' },
        { kind: 'external', status: 'ready', id: 'e' },
        { kind: 'vector_db', status: 'connecting', id: 'v2' },
      ],
    });

    await service.prepareStream({ scope, question: 'hi' });

    const passed = (generateReplyStreaming.mock.calls[0] as unknown[])[0] as {
      sources: Array<{ kind: string; id: string }>;
    };
    expect(passed.sources.map((s) => s.id)).toEqual(['a', 'v']);
    expect(passed.sources.every((s) => s.kind !== 'database')).toBe(true);
    expect(passed.sources.every((s) => s.kind !== 'external')).toBe(true);
  });

  it('forwards an anonymous userId and a null conversationId', async () => {
    const { service, generateReplyStreaming } = build();
    await service.prepareStream({ scope, question: 'hi' });
    const passed = (generateReplyStreaming.mock.calls[0] as unknown[])[0] as {
      userId: string;
      conversationId: string | null;
      orgId: string;
      projectId: string;
    };
    expect(passed).toMatchObject({
      userId: 'anonymous',
      conversationId: null,
      orgId: 'org-1',
      projectId: 'proj-1',
    });
  });

  it('throws 429 when the org monthly cap is exceeded — without calling the agent', async () => {
    const { service, generateReplyStreaming } = build({
      usageCount: 6,
      monthlyCap: 5,
    });
    await expect(
      service.prepareStream({ scope, question: 'hi' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(generateReplyStreaming).not.toHaveBeenCalled();
  });

  it('allows the request at exactly the cap boundary', async () => {
    const { service, generateReplyStreaming } = build({
      usageCount: 5,
      monthlyCap: 5,
    });
    await service.prepareStream({ scope, question: 'hi' });
    expect(generateReplyStreaming).toHaveBeenCalledTimes(1);
  });

  it('throws 404 when the organization is not found', async () => {
    const { service } = build({ organization: null });
    await expect(
      service.prepareStream({ scope, question: 'hi' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('surfaces cap exhaustion as an HttpException', async () => {
    const { service } = build({ usageCount: 11, monthlyCap: 10 });
    await expect(
      service.prepareStream({ scope, question: 'hi' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
