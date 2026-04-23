import { jest } from '@jest/globals';
import {
  ChatAgentService,
  createStreamingSqlFenceStripper,
  stripSqlFencesFromReply,
} from './chat-agent.service';
import type { ProjectDataSource } from '../../../projects/api/dto/project.dto';
import type { DataSourceRegistry } from '../../../projects/application/providers/data-source.registry';
import type {
  DataSourceProvider,
  DataSourceSearchOptions,
} from '../../../projects/application/providers/data-source-provider.interface';
import type { AirweaveSearchResponse } from '../../../airweave/application/services/airweave.service';

type ChatReply = {
  content: string;
  metadata: Record<string, unknown>;
};

type ChatAgentServiceInternals = ChatAgentService & {
  generateAgentReply: (apiKey: string, params: unknown) => Promise<ChatReply>;
};

function makeAirweaveSource(
  overrides: Partial<
    Extract<ProjectDataSource, { kind: 'airweave_collection' }>
  > = {},
): ProjectDataSource {
  return {
    id: 'src-1',
    projectId: 'proj-1',
    kind: 'airweave_collection',
    name: 'General',
    config: {
      collectionReadableId: 'champion-velocity',
      collectionName: 'General',
    },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ChatAgentService', () => {
  let service: ChatAgentService;
  let searchMock: jest.Mock<
    (
      source: ProjectDataSource,
      query: string,
      opts?: DataSourceSearchOptions,
    ) => Promise<AirweaveSearchResponse>
  >;
  let registry: DataSourceRegistry;
  let configService: {
    getOpenAiApiKey: any;
    getOpenAiModel: any;
    getChatSystemPrompt: any;
    getChatAgentMaxIterations: any;
    getChatAgentToolResultCharCap: any;
    getChatAgentToolResultLimit: any;
    getChatAgentMaxSources: any;
    getChatAgentHistoryWindow: any;
    getChatAgentSearchTier: any;
    getChatAgentRetrievalStrategy: any;
  };
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleInfoSpy: jest.SpiedFunction<typeof console.info>;

  beforeEach(() => {
    searchMock =
      jest.fn<
        (
          source: ProjectDataSource,
          query: string,
          opts?: DataSourceSearchOptions,
        ) => Promise<AirweaveSearchResponse>
      >();
    const provider: DataSourceProvider = {
      kind: 'airweave_collection',
      search: searchMock as unknown as DataSourceProvider['search'],
    };
    registry = {
      get: jest.fn(() => provider),
      kinds: jest.fn(() => ['airweave_collection']),
    } as unknown as DataSourceRegistry;

    configService = {
      getOpenAiApiKey: jest.fn().mockReturnValue(null),
      getOpenAiModel: jest.fn().mockReturnValue('gpt-4o'),
      getChatSystemPrompt: jest.fn().mockReturnValue('expert prompt'),
      getChatAgentMaxIterations: jest.fn().mockReturnValue(5),
      getChatAgentToolResultCharCap: jest.fn().mockReturnValue(3000),
      getChatAgentToolResultLimit: jest.fn().mockReturnValue(12),
      getChatAgentMaxSources: jest.fn().mockReturnValue(15),
      getChatAgentHistoryWindow: jest.fn().mockReturnValue(6),
      getChatAgentSearchTier: jest.fn().mockReturnValue('classic'),
      getChatAgentRetrievalStrategy: jest.fn().mockReturnValue(undefined),
    };
    service = new ChatAgentService(registry, configService as never);
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  function makeSearchResult(overrides: Record<string, unknown> = {}) {
    return {
      entityId: 'entity-1',
      name: 'Deploy Guide',
      relevanceScore: 0.95,
      breadcrumbs: [],
      createdAt: null,
      updatedAt: null,
      text: 'Deployments run through CI and into Elastic Beanstalk.',
      sourceName: 'github',
      entityType: 'file',
      webUrl: 'https://example.com/deploy-guide',
      ...overrides,
    };
  }

  function baseParams(
    overrides: Partial<Parameters<ChatAgentService['generateReply']>[0]> = {},
  ) {
    return {
      organizationName: 'Champion Velocity',
      projectName: 'General',
      projectId: 'proj-1',
      orgId: 'org-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      sources: [makeAirweaveSource()],
      question: 'How do deployments work?',
      previousMessages: [],
      ...overrides,
    };
  }

  describe('two-tier fallback dispatcher', () => {
    it('uses the keyless fallback path when OpenAI is not configured', async () => {
      searchMock.mockResolvedValue({
        results: [makeSearchResult()],
      });

      const result = await service.generateReply(baseParams());

      expect(result.content).toContain('### Key Findings');
      expect(result.content).toContain('### Sources');
      expect(result.metadata).toEqual(
        expect.objectContaining({
          generator: 'fallback-search-summary',
          resultCount: 1,
        }),
      );
    });

    it('returns the no-results fallback when there is no key and the search is empty', async () => {
      searchMock.mockResolvedValue({ results: [] });

      const result = await service.generateReply(baseParams());

      expect(result.content).toContain(
        'I could not find relevant indexed material',
      );
      expect(result.metadata).toEqual(
        expect.objectContaining({
          generator: 'fallback-no-results',
          resultCount: 0,
        }),
      );
    });

    it('returns the no-sources fallback when the project has no configured data sources', async () => {
      const result = await service.generateReply(baseParams({ sources: [] }));

      expect(result.content).toContain(
        'This project has no configured data sources',
      );
      expect(result.metadata).toEqual(
        expect.objectContaining({
          generator: 'fallback-no-sources',
          resultCount: 0,
        }),
      );
    });

    it('routes to the agent path when OpenAI is configured', async () => {
      configService.getOpenAiApiKey.mockReturnValue('sk-openai');
      const agentReply: ChatReply = {
        content: 'Agentic answer',
        metadata: {
          generator: 'langchain-agent',
          sources: [
            {
              name: 'Deploy Guide',
              webUrl: 'https://example.com/deploy-guide',
              sourceName: 'github',
              entityType: 'file',
            },
          ],
          resultCount: 1,
          toolCallCount: 2,
        },
      };
      const agentSpy = jest
        .spyOn(service as ChatAgentServiceInternals, 'generateAgentReply')
        .mockResolvedValue(agentReply);

      const result = await service.generateReply(
        baseParams({
          question: 'How does the invitation flow work?',
          previousMessages: [{ role: 'user', content: 'Previous question' }],
        }),
      );

      expect(agentSpy).toHaveBeenCalledWith(
        'sk-openai',
        expect.objectContaining({ organizationName: 'Champion Velocity' }),
      );
      expect(result.content).toBe('Agentic answer');
      expect(result.metadata).toEqual(
        expect.objectContaining({
          generator: 'langchain-agent',
          resultCount: 1,
          toolCallCount: 2,
        }),
      );
      // Dispatcher must not call the registry directly on the agent happy path.
      expect(searchMock).not.toHaveBeenCalled();
    });

    it('falls back to keyless when the agent path fails', async () => {
      configService.getOpenAiApiKey.mockReturnValue('sk-openai');
      searchMock.mockResolvedValue({
        results: [makeSearchResult()],
      });
      jest
        .spyOn(service as ChatAgentServiceInternals, 'generateAgentReply')
        .mockRejectedValue(new Error('agent exploded'));

      const result = await service.generateReply(baseParams());

      expect(result.metadata).toEqual(
        expect.objectContaining({
          generator: 'fallback-search-summary',
          resultCount: 1,
        }),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[ChatAgentService] Agent path failed, falling back to raw search',
        expect.objectContaining({ error: 'agent exploded' }),
      );
    });
  });

  describe('observability', () => {
    it('logs a reply summary with generator, source count, and toolCallCount', async () => {
      searchMock.mockResolvedValue({
        results: [makeSearchResult()],
      });

      await service.generateReply(baseParams());

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[ChatAgentService] reply generated',
        expect.objectContaining({
          generator: 'fallback-search-summary',
          sourceCount: 1,
          resultCount: 1,
          durationMs: expect.any(Number),
        }),
      );
    });

    it('includes toolCallCount in the log when the agent path succeeds', async () => {
      configService.getOpenAiApiKey.mockReturnValue('sk-openai');
      jest
        .spyOn(service as ChatAgentServiceInternals, 'generateAgentReply')
        .mockResolvedValue({
          content: 'Agentic answer',
          metadata: {
            generator: 'langchain-agent',
            sources: [],
            resultCount: 3,
            toolCallCount: 3,
          },
        });

      await service.generateReply(baseParams());

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[ChatAgentService] reply generated',
        expect.objectContaining({
          generator: 'langchain-agent',
          toolCallCount: 3,
        }),
      );
    });
  });

  describe('agent prompt construction', () => {
    it('returns the raw user question as the agent user message (no Organization prefix)', () => {
      const message = (
        service as unknown as {
          buildAgentUserMessage: (params: { question: string }) => string;
        }
      ).buildAgentUserMessage({
        question: 'what projects do you see?',
      });

      expect(message).toBe('what projects do you see?');
      expect(message).not.toContain('Organization');
      expect(message).not.toContain('Question:');
    });

    it('puts organization and project context in the system prompt, not the user message', () => {
      configService.getChatSystemPrompt.mockReturnValue('expert persona body');

      const systemPrompt = (
        service as unknown as {
          buildAgentSystemPrompt: (params: {
            organizationName: string;
            projectName: string;
            sources: unknown[];
          }) => string;
        }
      ).buildAgentSystemPrompt({
        organizationName: 'TierOne',
        projectName: 'General',
        sources: [],
      });

      expect(systemPrompt).toContain('expert persona body');
      expect(systemPrompt).toContain('TierOne');
      expect(systemPrompt).toContain('General');
      expect(systemPrompt).toContain('Tool usage protocol');
    });

    it('omits the database routing protocol when no database sources are attached', () => {
      configService.getChatSystemPrompt.mockReturnValue('expert persona body');

      const systemPrompt = (
        service as unknown as {
          buildAgentSystemPrompt: (params: {
            organizationName: string;
            projectName: string;
            sources: Array<{ kind: string }>;
          }) => string;
        }
      ).buildAgentSystemPrompt({
        organizationName: 'TierOne',
        projectName: 'General',
        sources: [{ kind: 'airweave_collection' }],
      });

      expect(systemPrompt).not.toContain('query_database');
      expect(systemPrompt).not.toContain('attached database');
    });

    it('appends the database routing protocol when at least one database source is attached', () => {
      configService.getChatSystemPrompt.mockReturnValue('expert persona body');

      const systemPrompt = (
        service as unknown as {
          buildAgentSystemPrompt: (params: {
            organizationName: string;
            projectName: string;
            sources: Array<{ kind: string }>;
          }) => string;
        }
      ).buildAgentSystemPrompt({
        organizationName: 'TierOne',
        projectName: 'General',
        sources: [
          { kind: 'airweave_collection' },
          { kind: 'database' },
        ],
      });

      expect(systemPrompt).toContain('query_database');
      expect(systemPrompt).toContain('attached database');
      // Routing guidance must still land AFTER the base protocol so the
      // "database" branch overrides "always start with search_knowledge_base"
      // rather than preceding it.
      const baseIdx = systemPrompt.indexOf('Tool usage protocol');
      const dbIdx = systemPrompt.indexOf('attached database');
      expect(baseIdx).toBeGreaterThanOrEqual(0);
      expect(dbIdx).toBeGreaterThan(baseIdx);
    });

    it('instructs the agent NOT to emit a SQL code block after query_database', () => {
      // The SPA renders executed SQL from the sql_executed SSE event as a
      // collapsible panel. If the LLM also emits the SQL in its text reply,
      // the rendering regularly breaks (closing fence collides with prose,
      // literal asterisks bleed through). The prompt MUST tell the agent
      // to reply with prose only.
      configService.getChatSystemPrompt.mockReturnValue('expert persona body');

      const systemPrompt = (
        service as unknown as {
          buildAgentSystemPrompt: (p: {
            organizationName: string;
            projectName: string;
            sources: Array<{ kind: string }>;
          }) => string;
        }
      ).buildAgentSystemPrompt({
        organizationName: 'Acme',
        projectName: 'Alpha',
        sources: [{ kind: 'database' }],
      });

      expect(systemPrompt).toMatch(/prose only/i);
      expect(systemPrompt).toMatch(/do not include the sql query/i);
      expect(systemPrompt).not.toMatch(/closing fence/i);
    });
  });

  describe('LLM caching', () => {
    it('reuses the same ChatOpenAI instance for identical config', () => {
      const serviceInstance = service as unknown as {
        getOrCreateLlm: (apiKey: string) => unknown;
      };

      configService.getOpenAiModel.mockReturnValue('gpt-4o');

      const llm1 = serviceInstance.getOrCreateLlm('sk-openai');
      const llm2 = serviceInstance.getOrCreateLlm('sk-openai');

      expect(llm1).toBe(llm2);
    });

    it('creates a new ChatOpenAI instance when config changes', () => {
      const serviceInstance = service as unknown as {
        getOrCreateLlm: (apiKey: string) => unknown;
      };

      configService.getOpenAiModel.mockReturnValue('gpt-4o');
      const llm1 = serviceInstance.getOrCreateLlm('sk-openai');

      configService.getOpenAiModel.mockReturnValue('gpt-4o-mini');
      const llm2 = serviceInstance.getOrCreateLlm('sk-openai');

      expect(llm1).not.toBe(llm2);
    });
  });
});

describe('stripSqlFencesFromReply', () => {
  it('removes a properly closed ```sql block', () => {
    const input =
      '```sql\nSELECT COUNT(*) FROM "user"\n```\n\nThere are 4 users.';
    expect(stripSqlFencesFromReply(input)).toBe('There are 4 users.');
  });

  it('removes a ```sql block whose closing fence is glued to prose (the real-world bug)', () => {
    // Exact shape from the failing screenshot: closing ``` has no newline
    // before "Found", so the markdown parser never closes the code block and
    // the whole rest of the reply renders inside it.
    const input =
      '```sql\nSELECT COUNT(*) AS user_count FROM "user" LIMIT 100\n```Found **4** rows in the `"user"` table.';
    expect(stripSqlFencesFromReply(input)).toBe(
      'Found **4** rows in the `"user"` table.',
    );
  });

  it('is case-insensitive about the SQL language tag', () => {
    expect(stripSqlFencesFromReply('```SQL\nSELECT 1\n```\nDone.')).toBe(
      'Done.',
    );
  });

  it('removes an unclosed ```sql block that runs to end of reply', () => {
    expect(stripSqlFencesFromReply('Answer: 4\n```sql\nSELECT 1')).toBe(
      'Answer: 4',
    );
  });

  it('leaves non-SQL fenced code blocks alone', () => {
    const input = 'Here is code:\n```js\nconsole.log(1)\n```\nEnd.';
    expect(stripSqlFencesFromReply(input)).toBe(input);
  });

  it('preserves prose on both sides of the removed block', () => {
    const input =
      'There are 4 users.\n\n```sql\nSELECT COUNT(*) FROM "user"\n```\n\nThis reflects current DB state.';
    expect(stripSqlFencesFromReply(input)).toBe(
      'There are 4 users.\n\nThis reflects current DB state.',
    );
  });

  it('returns the input unchanged when there is no fence', () => {
    expect(stripSqlFencesFromReply('There are 4 users.')).toBe(
      'There are 4 users.',
    );
  });

  it('handles empty input', () => {
    expect(stripSqlFencesFromReply('')).toBe('');
  });
});

describe('createStreamingSqlFenceStripper', () => {
  it('strips a ```sql block delivered across multiple chunks', () => {
    const s = createStreamingSqlFenceStripper();
    // Token-at-a-time emission simulating an LLM stream
    const chunks = [
      '```',
      'sql\n',
      'SELECT COUNT(*) FROM "user"\n',
      '```',
      'There ',
      'are 4 users.',
    ];
    const out = chunks.map((c) => s.push(c)).join('') + s.flush();
    expect(out).toBe('There are 4 users.');
  });

  it('emits content before the fence immediately (minus lookahead)', () => {
    const s = createStreamingSqlFenceStripper();
    const emitted = s.push('There are 4 users.\n\n');
    // Keeps up to 6 chars of lookahead in case ```sql is forming.
    expect(emitted.length).toBeGreaterThan(0);
    expect('There are 4 users.\n\n').toContain(emitted);

    // Finishing the stream flushes the retained tail.
    expect(emitted + s.flush()).toBe('There are 4 users.\n\n');
  });

  it('passes non-SQL fenced code through untouched', () => {
    const s = createStreamingSqlFenceStripper();
    const input = 'Here is JS:\n```js\nconsole.log(1)\n```\nDone.';
    const out = s.push(input) + s.flush();
    expect(out).toBe(input);
  });

  it('drops an unclosed ```sql fence at end of stream', () => {
    const s = createStreamingSqlFenceStripper();
    const out =
      s.push('Answer: 4\n') +
      s.push('```sql\nSELECT') +
      s.push(' COUNT(*)') +
      s.flush();
    expect(out).toBe('Answer: 4\n');
  });

  it('handles the glued-closing-fence bug across chunks', () => {
    const s = createStreamingSqlFenceStripper();
    // The LLM emits the closing ``` immediately followed by prose in the
    // same token — exactly the pattern that broke markdown in the screenshot.
    const out =
      s.push('```sql\nSELECT 1\n') +
      s.push('```Found 4 rows.') +
      s.flush();
    expect(out).toBe('Found 4 rows.');
  });
});
