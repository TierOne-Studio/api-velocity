import { jest } from '@jest/globals';
import {
  ChatAgentService,
  createStreamingSqlFenceStripper,
  normalizeMarkdownTables,
  stripJsonFencesFromReply,
  stripSqlFencesFromReply,
} from './chat-agent.service';
import type {
  ProjectDataSource,
  DataSourceRegistry,
  DataSourceProvider,
  DataSourceSearchOptions,
} from '../../../projects';
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
    getChatRoutingRules: any;
    getChatRouterEnabled: any;
    getChatRouterConfidenceThreshold: any;
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
      // Router defaults disabled for these tests.
      getChatRoutingRules: jest.fn().mockReturnValue('# RULES\n- SQL: counts.\n- RAG: docs.'),
      getChatRouterEnabled: jest.fn().mockReturnValue(false),
      getChatRouterConfidenceThreshold: jest.fn().mockReturnValue(0.7),
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

    it('emits the capabilities chip with DB names when DB sources attached', () => {
      configService.getChatSystemPrompt.mockReturnValue('expert persona body');

      const systemPrompt = (
        service as unknown as {
          buildAgentSystemPrompt: (params: {
            organizationName: string;
            projectName: string;
            sources: Array<{
              kind: string;
              name?: string;
              config?: { connectionName?: string };
            }>;
          }) => string;
        }
      ).buildAgentSystemPrompt({
        organizationName: 'TierOne',
        projectName: 'General',
        sources: [
          { kind: 'airweave_collection' },
          {
            kind: 'database',
            name: 'prod-source',
            config: { connectionName: 'prod-db' },
          },
          {
            kind: 'database',
            name: 'reporting-source',
            config: { connectionName: 'reporting-db' },
          },
        ],
      });

      expect(systemPrompt).toContain('Available capabilities');
      expect(systemPrompt).toContain('search_knowledge_base');
      expect(systemPrompt).toContain('query_database');
      // Concrete DB names appear in the chip so the LLM has a named menu.
      expect(systemPrompt).toContain('prod-db');
      expect(systemPrompt).toContain('reporting-db');
      // Chip lands BEFORE the routing protocol so the model has the menu in
      // mind when it reads the rules.
      const chipIdx = systemPrompt.indexOf('Available capabilities');
      const routingIdx = systemPrompt.indexOf('When the project has an attached database');
      expect(chipIdx).toBeGreaterThanOrEqual(0);
      expect(routingIdx).toBeGreaterThan(chipIdx);
    });

    it('falls back to the source.name when connectionName is missing', () => {
      configService.getChatSystemPrompt.mockReturnValue('expert persona body');
      const systemPrompt = (
        service as unknown as {
          buildAgentSystemPrompt: (params: unknown) => string;
        }
      ).buildAgentSystemPrompt({
        organizationName: 'TierOne',
        projectName: 'General',
        sources: [
          {
            kind: 'database',
            name: 'fallback-name',
            config: {},
          },
        ],
      });
      expect(systemPrompt).toContain('fallback-name');
    });

    it('omits the capabilities chip when no DB source is attached (zero-DB byte-identical)', () => {
      configService.getChatSystemPrompt.mockReturnValue('expert persona body');
      const systemPrompt = (
        service as unknown as {
          buildAgentSystemPrompt: (params: unknown) => string;
        }
      ).buildAgentSystemPrompt({
        organizationName: 'TierOne',
        projectName: 'General',
        sources: [{ kind: 'airweave_collection' }],
      });
      expect(systemPrompt).not.toContain('Available capabilities');
    });

    it('keeps the "do not emit SQL" guidance in the tool description file', async () => {
      // The "Answer format after query_database" rule lives in the tool
      // description bundled with query-database-tool-description.md.
      // The LLM sees it every time it considers calling the tool, which
      // is the right scope for per-call output rules. Test the .md file
      // directly so this assertion doesn't depend on the configService
      // mock surface.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const dir = path.dirname(url.fileURLToPath(import.meta.url));
      const file = path.resolve(
        dir,
        '../../prompts/query-database-tool-description.md',
      );
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toMatch(/prose only/i);
      expect(content).toMatch(/do not include the sql query/i);
      expect(content).toMatch(/do not paste raw tool output/i);
      expect(content).toMatch(/```json fenced dump/i);
      expect(content).toMatch(/Answer format/i);
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

describe('stripJsonFencesFromReply', () => {
  it('removes a closed ```json block before prose', () => {
    const rows =
      '[{"user_name":"Ada","user_role":"admin"},{"user_name":"Bob","user_role":"manager"}]';
    const input = `\`\`\`json\n${rows}\n\`\`\`\n\nHere is the summary table.`;
    expect(stripJsonFencesFromReply(input)).toBe('Here is the summary table.');
  });

  it('removes a ```json block glued to prose after the closing fence', () => {
    const input =
      '```json\n[{"name":"x"}]\n```Here are the roles **per user**:';
    expect(stripJsonFencesFromReply(input)).toBe(
      'Here are the roles **per user**:',
    );
  });

  it('is case-insensitive on the json fence tag', () => {
    expect(stripJsonFencesFromReply('```JSON\n[]\n```\nDone.')).toBe('Done.');
  });

  it('removes an unclosed ```json block at end of reply', () => {
    expect(stripJsonFencesFromReply('Intro:\n```json\n[{"a":1}]')).toBe(
      'Intro:',
    );
  });

  it('leaves ```js blocks alone', () => {
    const input = 'Ex:\n```js\nconst x = {a:1};\n```\nEnd.';
    expect(stripJsonFencesFromReply(input)).toBe(input);
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

  // Ambiguous keywords require a SQL-shaped follow-up to be treated as SQL.
  it('preserves a pascal-tagged block whose body uses BEGIN as a Pascal keyword', () => {
    const input = [
      'Here is the Pascal example:',
      '```pascal',
      'BEGIN',
      '  WriteLn(\'hi\');',
      'END.',
      '```',
      'That is the example.',
    ].join('\n');
    // BEGIN is not followed by TRANSACTION/WORK/`;`, so the block must
    // pass through untouched.
    expect(stripSqlFencesFromReply(input)).toBe(input);
  });

  it('still strips a bare ``` block whose BEGIN IS SQL-shaped', () => {
    const input = [
      'I ran:',
      '```',
      'BEGIN TRANSACTION;',
      'SELECT 1;',
      'COMMIT;',
      '```',
      'Done.',
    ].join('\n');
    const out = stripSqlFencesFromReply(input);
    expect(out).not.toContain('BEGIN TRANSACTION');
    expect(out).toContain('I ran:');
    expect(out).toContain('Done.');
  });

  it('still strips an explicit ```sql block even with bare BEGIN inside', () => {
    // The sql tag is the canonical match — body shape doesn't matter.
    const input = '```sql\nBEGIN\nSELECT 1;\n```\nResult.';
    expect(stripSqlFencesFromReply(input)).toBe('Result.');
  });

  it('preserves a bash block where a SQL-keyword-looking identifier appears', () => {
    // Pure non-SQL: language tag is bash, no SQL fingerprint in the body.
    const input = '```bash\nROLLBACK_TIMEOUT=5 ./run.sh\n```\nDone.';
    expect(stripSqlFencesFromReply(input)).toBe(input);
  });
});

describe('createStreamingSqlFenceStripper', () => {
  it('with stripJsonWhen strips ```json split across chunks without leaking fence markers', () => {
    const s = createStreamingSqlFenceStripper({
      stripJsonWhen: () => true,
    });
    const chunks = ['``', '`json\n[{"x":1}]\n```', 'Visible prose'];
    const out = chunks.map((c) => s.push(c)).join('') + s.flush();
    expect(out).toBe('Visible prose');
  });

  it('with stripJsonWhen strips ```json delivered one token after opener across chunks', () => {
    const s = createStreamingSqlFenceStripper({
      stripJsonWhen: () => true,
    });
    const chunks = ['```', 'json\n', '[{"x":1}]\n', '```', 'Answer ', 'done.'];
    const out = chunks.map((c) => s.push(c)).join('') + s.flush();
    expect(out).toBe('Answer done.');
  });

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

  // The streaming stripper has its own state machine + 64-char lookahead
  // window, so the ambiguous-keyword tightening needs coverage on both
  // the batch and the streaming implementations.
  it('streaming: preserves a ```pascal block with BEGIN as a Pascal keyword (token-by-token)', () => {
    const s = createStreamingSqlFenceStripper();
    // Emit the Pascal block one chunk at a time so the decision happens
    // during the streaming window-fill, not after the whole block is buffered.
    const chunks = [
      'Here is the Pascal example:\n',
      '```',
      'pascal\n',
      'BEGIN\n',
      "  WriteLn('hi');\n",
      'END.\n',
      '```',
      '\nThat is the example.',
    ];
    const out = chunks.map((c) => s.push(c)).join('') + s.flush();
    expect(out).toContain('```pascal');
    expect(out).toContain('BEGIN');
    expect(out).toContain('END.');
    expect(out).toContain('That is the example.');
  });

  it('streaming: preserves a ```bash block with a SQL-keyword-shaped identifier', () => {
    const s = createStreamingSqlFenceStripper();
    const chunks = [
      'Run: ',
      '```',
      'bash\n',
      'ROLLBACK_TIMEOUT=5 ./run.sh\n',
      '```',
      '\nDone.',
    ];
    const out = chunks.map((c) => s.push(c)).join('') + s.flush();
    expect(out).toContain('ROLLBACK_TIMEOUT=5');
    expect(out).toContain('Done.');
  });

  it('streaming: still strips a bare ``` block with SQL-shaped BEGIN', () => {
    const s = createStreamingSqlFenceStripper();
    const chunks = [
      'I ran:\n',
      '```\n',
      'BEGIN TRANSACTION;\n',
      'SELECT 1;\n',
      'COMMIT;\n',
      '```\n',
      'Done.',
    ];
    const out = chunks.map((c) => s.push(c)).join('') + s.flush();
    expect(out).not.toContain('BEGIN TRANSACTION');
    expect(out).toContain('I ran:');
    expect(out).toContain('Done.');
  });
});

describe('normalizeMarkdownTables', () => {
  // These cases pin the exact production failure modes captured in screenshots:
  //   - "...questions.| User | Email |" (no newline at all between prose and table)
  //   - "...questions.\n| User | Email |" (single newline; markdown needs two)
  // Both render as unstyled inline text on the SPA because GitHub-flavored-
  // markdown requires a blank line before a table header.

  it('inserts a blank line when prose is directly glued to a table line', () => {
    const input = 'There are 4 users.| User | Email |\n|---|---|\n| Ada | a@x |';
    const out = normalizeMarkdownTables(input);
    expect(out).toContain('There are 4 users.\n\n| User | Email |');
    expect(out).toContain('|---|---|');
    expect(out).toContain('| Ada | a@x |');
  });

  it('inserts a blank line when prose has only a single newline before a table line', () => {
    const input = 'There are 4 users.\n| User | Email |\n|---|---|\n| Ada | a@x |';
    const out = normalizeMarkdownTables(input);
    expect(out).toContain('There are 4 users.\n\n| User | Email |');
  });

  it('is a no-op when the table is already properly separated', () => {
    const input = 'There are 4 users.\n\n| User | Email |\n|---|---|\n| Ada | a@x |';
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  it('does NOT over-match a single inline pipe in prose ("Hello | World")', () => {
    // Heuristic: table-like = at least TWO pipes on the same line. A lone
    // inline pipe ("Hello | World") has zero or one trailing pipe and must
    // pass through unchanged or this would corrupt prose.
    const input = 'Hello | World';
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  it('does NOT insert duplicate blank lines on already-correct tables', () => {
    // Regression guard: applying the regex multiple times must converge.
    const input = 'Intro.\n\n| col1 | col2 |\n|---|---|\n| a | b |';
    const once = normalizeMarkdownTables(input);
    const twice = normalizeMarkdownTables(once);
    expect(twice).toBe(once);
  });

  it('preserves consecutive table rows (does not insert blank lines between rows)', () => {
    // Critical: only the FIRST table line should get a blank line inserted.
    // Subsequent rows (header-separator, data rows) must remain glued
    // together, otherwise the parser sees multiple single-row tables.
    const input = 'Intro.\n\n| a | b |\n| 1 | 2 |\n| 3 | 4 |';
    const out = normalizeMarkdownTables(input);
    expect(out).toBe(input);
  });

  it('handles the exact production failure shape (multi-bullet then glued table)', () => {
    // Reproduces the SPA screenshot from the bug report: 4 bullets then a
    // markdown table fused onto the last bullet's trailing text.
    const input = [
      '- Ada (a@x): 7 chats, 45 questions',
      '- Bob (b@x): 2 chats, 4 questions',
      '- Charlie (c@x): 0 chats, 0 questions| User | Email | Chats | Questions |',
      '|---|---|---:|---:|',
      '| Ada | a@x | 7 | 45 |',
    ].join('\n');
    const out = normalizeMarkdownTables(input);
    expect(out).toContain('0 chats, 0 questions\n\n| User | Email | Chats | Questions |');
    expect(out).toContain('|---|---|---:|---:|');
    expect(out).toContain('| Ada | a@x | 7 | 45 |');
    // The header-separator and data row must remain glued (no blank lines
    // inserted between them) — otherwise the table breaks into pieces.
    expect(out).not.toMatch(/\|---\|---\|---:\|---:\|\n\n\| Ada/);
  });

  it('handles empty input', () => {
    expect(normalizeMarkdownTables('')).toBe('');
  });

  it('handles prose-only content (no tables, no changes)', () => {
    const input = 'There are 4 users in your database.';
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  // Regression guards for splitLineAtTableStart: prose like
  // "a | b | c |" must not be misclassified as a table just because it
  // has multiple pipes and ends in `|`. A GFM separator row
  // (e.g. `|---|---|`) on the next line is required before treating any
  // line as a table header. Prose passes through untouched.

  it('does NOT split prose ending in multiple pipes when no separator row follows', () => {
    const input = 'columns: name | email | status |';
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  it('does NOT split prose ending in pipe (no following line at all)', () => {
    const input = 'a | b | c |';
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  it('does split prose-then-table when a separator row follows on the next line', () => {
    // Confirms the legitimate case (prose glued to a real table header
    // with a separator beneath it) still gets normalized.
    const input =
      'Here are the rows:| User | Email |\n|---|---|\n| Ada | a@x |';
    const out = normalizeMarkdownTables(input);
    expect(out).toContain('Here are the rows:\n\n| User | Email |');
    expect(out).toContain('|---|---|');
    expect(out).toContain('| Ada | a@x |');
  });

  it('does NOT insert blank line before a one-row "table" that has no separator (treats as prose)', () => {
    // The model occasionally emits a single pipe-delimited line without a
    // separator row. Per GFM this isn't a table; treating it as prose is
    // safer than synthesizing a missing header. With the separator-row
    // guard, the line stays as-is and renders as plain text (which is
    // what markdown does without a separator anyway).
    const input = 'Intro.\n| no separator | follows |';
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  it('isTableSeparator: accepts standard, colon-aligned, and tight forms', () => {
    // White-box assertion via end-to-end behavior: the splitter should
    // recognize all three separator styles as valid headers-of-tables.
    const cases = [
      '| Col |\n| --- |\n| val |',
      '| Col |\n|:---|\n| val |',
      '| Col |\n|---:|\n| val |',
      '| Col |\n|:---:|\n| val |',
      '| A | B |\n|---|---|\n| 1 | 2 |',
    ];
    for (const input of cases) {
      // Each case is already valid markdown (no prose before the header).
      // The normalizer should be a no-op — the separator-row detector
      // must accept all of these as valid separators.
      expect(normalizeMarkdownTables(input)).toBe(input);
    }
  });

  it('does NOT mistake a non-separator pipe-line as a separator (e.g. "|a-b|c|")', () => {
    // Edge case: a row whose cells happen to start with `-` should NOT
    // be treated as a separator row.
    const input = 'Intro.\n| a-b | c |\n| 1 | 2 |';
    // No separator row anywhere → no normalization.
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  // ---------------------------------------------------------------------
  // Table-after-table normalization (Pass-2 guard correction).
  //
  // When the model emits two distinct markdown tables back-to-back with
  // no blank line between them, remark-gfm merges them into a single
  // table — the second table's separator row renders as a literal data
  // row (`---`, `---`, …) and subsequent data rows shift one column
  // left. Pass-2 must insert a blank line at the second table's header.
  //
  // The `isHeader` precondition (NEXT line is a separator) already
  // proves the current line is a real new-table header — GFM separator
  // rows are only valid right after a header, never inside a table body.
  // So a blank line MUST be inserted regardless of whether the previous
  // line is prose or another table's data row.
  // ---------------------------------------------------------------------

  it('inserts a blank line between two tables emitted back-to-back (no blank between them)', () => {
    // Sequence: header-A → sep-A → row-A → header-B → sep-B → row-B
    // (no empty line between tables). The blank line must be inserted
    // before header-B so the second table is parsed independently.
    const input = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '| c | d |',
      '|---|---|',
      '| 3 | 4 |',
    ].join('\n');
    const expected = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '| c | d |',
      '|---|---|',
      '| 3 | 4 |',
    ].join('\n');
    expect(normalizeMarkdownTables(input)).toBe(expected);
  });

  it('is idempotent when two tables are already separated by a blank line', () => {
    // Properly-spaced two-table input must pass through unchanged.
    const input = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '| c | d |',
      '|---|---|',
      '| 3 | 4 |',
    ].join('\n');
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  it('recognises a right-aligned separator in the second table and still inserts a blank line', () => {
    // The bug screenshot featured a second table with `|---:|` alignment.
    // The separator detector must accept it, and the blank-line guard
    // must still fire so the right-aligned table is parsed independently.
    const input = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '| c | d |',
      '|---|---:|',
      '| 3 | 4 |',
    ].join('\n');
    const out = normalizeMarkdownTables(input);
    expect(out).toContain('| 1 | 2 |\n\n| c | d |');
    expect(out).toContain('|---|---:|');
  });

  it('inserts blank lines between three or more consecutive tables', () => {
    // Generalises the table→table case: every new table header gets a
    // blank line in front of it.
    const input = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '| c | d |',
      '|---|---|',
      '| 3 | 4 |',
      '| e | f |',
      '|---|---|',
      '| 5 | 6 |',
    ].join('\n');
    const out = normalizeMarkdownTables(input);
    // Two blank-line insertions expected (between table-1↔2 and 2↔3).
    expect(out).toContain('| 1 | 2 |\n\n| c | d |');
    expect(out).toContain('| 3 | 4 |\n\n| e | f |');
  });

  it('reproduces the production screenshot: prose + 4-col table + 3-col right-aligned table jammed together', () => {
    // Mirrors the exact user-reported failure: a preamble line, then two
    // stacked tables with no blank line between them. The bug rendered
    // the second table's separator row as literal data and shifted its
    // data rows one column left.
    const input = [
      'Here are the users who have chats, with their name, role, and number of chats:',
      '| userId | name | role | numberOfChats |',
      '|---|---|---|---|',
      '| bQ93Di | Mariano Ravinale | superadmin | 64 |',
      '| d3b1f6 | Mariano Ravinale | admin | 8 |',
      '| name | role | numberOfChats |',
      '|---|---|---:|',
      '| Mariano Ravinale | superadmin | 64 |',
      '| Mariano Ravinale | admin | 8 |',
    ].join('\n');
    const out = normalizeMarkdownTables(input);
    // Preamble → first table: existing prose→table behavior still fires.
    expect(out).toContain(
      'number of chats:\n\n| userId | name | role | numberOfChats |',
    );
    // First table → second table: the new behavior under test.
    expect(out).toContain(
      '| d3b1f6 | Mariano Ravinale | admin | 8 |\n\n| name | role | numberOfChats |',
    );
    // Separator rows must stay glued to their own headers (no blank
    // line inserted between header and separator).
    expect(out).not.toMatch(/\| userId \| name \| role \| numberOfChats \|\n\n\|---\|---\|---\|---\|/);
    expect(out).not.toMatch(/\| name \| role \| numberOfChats \|\n\n\|---\|---\|---:\|/);
  });

  it('does NOT insert a blank line between a separator row and its first data row', () => {
    // Explicit regression guard for the load-bearing `!isTableSeparator(prev)`
    // clause: a separator row is followed by the first body row. That
    // pair must stay glued — inserting a blank here would split one
    // table into two.
    const input = [
      'Intro.',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '| 3 | 4 |',
    ].join('\n');
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  // ---------------------------------------------------------------------
  // Syntactic-vs-semantic separator: `isTableSeparator()` matches ANY
  // dash-only line, including a body row whose cells happen to be
  // dash placeholders (`| - | - |`). Without the `!isTableSeparator(line)`
  // guard, the loop would mis-classify a real separator row as a "new
  // table header" whenever the line after it is also dash-only, and
  // insert a blank line between the header and its own separator —
  // splitting a single valid table into two broken halves.
  // ---------------------------------------------------------------------

  it('keeps a single table intact when its only body row is dash-only ("| - | - |")', () => {
    // The dash placeholder is a common null-rendering convention. The
    // separator-shape body row must NOT be promoted to a fake new-table
    // marker — the table must render whole.
    const input = [
      '| a | b |',
      '|---|---|',
      '| - | - |',
      '| c | d |',
    ].join('\n');
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  it('keeps a table intact when EVERY body row is dash-only', () => {
    const input = [
      '| col1 | col2 | col3 |',
      '|---|---|---|',
      '| - | - | - |',
      '| -- | -- | -- |',
      '| --- | --- | --- |',
    ].join('\n');
    expect(normalizeMarkdownTables(input)).toBe(input);
  });

  it('keeps a table intact when the first body row uses the same dash count as the separator', () => {
    // Adversarial case: a body row that looks character-for-character
    // like a separator (`|---|---|`). Must NOT trigger a blank-line
    // insertion between the real header and the real separator.
    const input = [
      '| a | b |',
      '|---|---|',
      '|---|---|',
      '| c | d |',
    ].join('\n');
    expect(normalizeMarkdownTables(input)).toBe(input);
  });
});
