// Behavior-pin integration tests for ChatAgentService streaming path.
//
// PURPOSE (per docs/langchain-agent-refactor-proposal.md §0.2):
// Lock the SHAPE of streamed event sequences and reply metadata BEFORE any
// refactor phase changes behavior. Every later phase (P1 drop-checker, P2
// schema pre-warm, P3 router, P3b streaming events) MUST keep these pins
// green. The matcher in `pin-matchers.ts` is intentionally permissive on
// optional tool-call types (`?` suffix) so the same pins survive when
// pre-warming removes discovery tool-calls or when P3b adds new streaming
// events — both states match the same pattern.
//
// MOCK SEAM (per proposal §0.1):
// Mocks `langchain.createAgent` via `jest.unstable_mockModule` (the ESM-correct
// pattern). The mocked agent's `stream()` yields a deterministic transcript
// built from `streamFromTranscript(steps)` — no real LLM call ever fires.
// See `src/shared/test-utils/agent-transcript-mock.ts` for the helper.

import { jest } from '@jest/globals';
import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  installCreateAgentMock,
  mockCreateAgentWithTranscript,
  resetCapturedTools,
  type TranscriptStep,
} from '../../../../shared/test-utils/agent-transcript-mock';
import { registerPinMatcher } from '../../../../shared/test-utils/pin-matchers';
// Phase 4-lite: barrel import.
import type {
  DataSourceRegistry,
  AgentToolContext,
  DataSourceProvider,
  ProjectDataSource,
} from '../../../projects';
import type {
  AirweaveSearchResponse,
  AirweaveSearchResultSummary,
} from '../../../airweave/application/services/airweave.service';

registerPinMatcher();

// MUST install BEFORE the SUT import. `jest.unstable_mockModule` requires the
// factory to register before any dynamic import resolves `langchain`.
const createAgentMock = installCreateAgentMock();
jest.unstable_mockModule('langchain', () => ({
  createAgent: (...args: unknown[]) =>
    (createAgentMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

type ChatAgentServiceType =
  InstanceType<typeof import('./chat-agent.service').ChatAgentService>;
let ChatAgentService:
  typeof import('./chat-agent.service').ChatAgentService;

// --- fixtures ----------------------------------------------------------------

function makeAirweaveSource(): ProjectDataSource {
  return {
    id: 'src-aw',
    projectId: 'proj-1',
    kind: 'airweave_collection',
    name: 'General',
    config: {
      collectionReadableId: 'velocity-pin',
      collectionName: 'General',
    },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeDatabaseSource(): ProjectDataSource {
  return {
    id: 'src-db',
    projectId: 'proj-1',
    kind: 'database',
    name: 'prod-db',
    config: { connectionId: 'conn-1', connectionName: 'prod-db' },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeSearchResult(): AirweaveSearchResultSummary {
  return {
    entityId: 'entity-1',
    name: 'Onboarding Guide',
    relevanceScore: 0.95,
    breadcrumbs: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'Welcome to the platform.',
    sourceName: 'wiki',
    entityType: 'page',
    webUrl: 'https://example.test/onboarding',
  };
}

function makeSearchResponse(): AirweaveSearchResponse {
  return { results: [makeSearchResult()] };
}

// A fake `query_database` tool that synthesizes a `sql_executed` event into
// ctx.eventSink — same side effect the real DatabaseSourceProvider tool has.
// This is what makes the streaming loop's drain-on-tool-message surface a
// `sql_executed` event in pin_sql_only / pin_hybrid without running a real DB.
function makeFakeQueryDatabaseTool(ctx: AgentToolContext): StructuredTool {
  return tool(
    async (_input: { question?: string; source_id?: string }) => {
      ctx.eventSink.push({
        type: 'sql_executed',
        connectionId: 'conn-1',
        connectionName: 'prod-db',
        sql: 'SELECT COUNT(*) FROM users',
        rowCount: 1,
        rows: [{ count: 12 }],
        truncated: false,
        durationMs: 42,
      });
      ctx.persistedCalls.push({
        connectionId: 'conn-1',
        connectionName: 'prod-db',
        sql: 'SELECT COUNT(*) FROM users',
        rowCount: 1,
        truncated: false,
        durationMs: 42,
      });
      return JSON.stringify({
        connectionId: 'conn-1',
        connectionName: 'prod-db',
        sql: 'SELECT COUNT(*) FROM users',
        rowCount: 1,
        rows: [{ count: 12 }],
        truncated: false,
        durationMs: 42,
      });
    },
    {
      name: 'query_database',
      description: 'fake query_database tool for pin tests',
      schema: z.object({
        question: z.string(),
        source_id: z.string().optional(),
      }),
    },
  ) as unknown as StructuredTool;
}

function buildRegistry(
  searchMock: jest.Mock<DataSourceProvider['search']>,
  options: { contributeQueryDatabase: boolean },
): DataSourceRegistry {
  const airweaveProvider: DataSourceProvider = {
    kind: 'airweave_collection',
    search: searchMock as unknown as DataSourceProvider['search'],
  };
  return {
    get: jest.fn((kind: string) => {
      if (kind === 'airweave_collection') return airweaveProvider;
      throw new Error(`unexpected get(${kind})`);
    }),
    kinds: jest.fn(() => ['airweave_collection', 'database']),
    getAgentToolsFor: jest.fn(
      (sources: ProjectDataSource[], ctx: AgentToolContext) => {
        if (
          options.contributeQueryDatabase &&
          sources.some((s) => s.kind === 'database')
        ) {
          return [makeFakeQueryDatabaseTool(ctx)];
        }
        return [];
      },
    ),
  } as unknown as DataSourceRegistry;
}

function buildConfigService(opts: { apiKey: string | null }) {
  return {
    getOpenAiApiKey: jest.fn().mockReturnValue(opts.apiKey),
    getOpenAiModel: jest.fn().mockReturnValue('gpt-pin'),
    getChatSystemPrompt: jest.fn().mockReturnValue('pin prompt'),
    getChatAgentMaxIterations: jest.fn().mockReturnValue(5),
    getChatAgentToolResultCharCap: jest.fn().mockReturnValue(3000),
    getChatAgentToolResultLimit: jest.fn().mockReturnValue(12),
    getChatAgentMaxSources: jest.fn().mockReturnValue(15),
    getChatAgentHistoryWindow: jest.fn().mockReturnValue(6),
    getChatAgentSearchTier: jest.fn().mockReturnValue('classic'),
    getChatAgentRetrievalStrategy: jest.fn().mockReturnValue(undefined),
    getQueryDatabaseToolDescription: jest.fn().mockReturnValue('fake desc'),
    // Phase 3b additions (router OFF — pin spec exercises agent path
    // unchanged. Critical: the matcher allows sql_planning/sql_executing
    // as optional events so pins survive both off and on).
    getChatRoutingRules: jest
      .fn()
      .mockReturnValue('# RULES\n- SQL: counts.\n- RAG: docs.'),
    getChatRouterEnabled: jest.fn().mockReturnValue(false),
    getChatRouterConfidenceThreshold: jest.fn().mockReturnValue(0.7),
  };
}

function baseParams(
  overrides: Partial<{
    sources: ProjectDataSource[];
    question: string;
  }> = {},
) {
  return {
    organizationName: 'Champion Velocity',
    projectName: 'General',
    projectId: 'proj-1',
    orgId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    sources: [makeAirweaveSource()],
    question: 'pin question',
    previousMessages: [],
    ...overrides,
  };
}

async function collectEvents(
  service: ChatAgentServiceType,
  params: ReturnType<typeof baseParams>,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of service.generateReplyStreaming(params)) {
    events.push(event as unknown as Record<string, unknown>);
  }
  return events;
}

const eventTypes = (events: Array<Record<string, unknown>>): string[] =>
  events.map((e) => e.type as string);

// --- suite -------------------------------------------------------------------

describe('ChatAgentService behavior pins (Phase 0 baseline)', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleInfoSpy: jest.SpiedFunction<typeof console.info>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeAll(async () => {
    ({ ChatAgentService } = await import('./chat-agent.service'));
  });

  beforeEach(() => {
    resetCapturedTools();
    createAgentMock.mockReset();
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('pin_search_only — 1 Airweave source, search + synthesize', async () => {
    const searchMock = jest
      .fn<DataSourceProvider['search']>()
      .mockResolvedValue(makeSearchResponse());
    const registry = buildRegistry(searchMock, {
      contributeQueryDatabase: false,
    });
    const configService = buildConfigService({ apiKey: 'sk-pin' });
    const service = new ChatAgentService(registry, configService as never);

    const transcript: TranscriptStep[] = [
      {
        type: 'tool_call',
        toolName: 'search_knowledge_base',
        args: { query: 'pin question' },
        toolResult: JSON.stringify({ results: [makeSearchResult()] }),
      },
      { type: 'content', text: 'Pinned answer text.' },
    ];

    mockCreateAgentWithTranscript(createAgentMock, transcript);

    const events = await collectEvents(service, baseParams());

    // Verified empirically: `thinking` is emitted just before the first
    // content chunk (chat-agent.service.ts:698-701), NOT at the start of
    // the turn. Tool-call events (`searching`, `sql_executed`) precede it.
    expect(eventTypes(events)).toMatchPinSequence([
      'searching',
      'thinking',
      'chunk*',
      'done',
    ]);
    const done = events.at(-1) as {
      type: 'done';
      reply: { metadata: Record<string, unknown> };
    };
    expect(done.type).toBe('done');
    expect(done.reply.metadata.generator).toBe('langchain-agent');
    expect(Array.isArray(done.reply.metadata.sources)).toBe(true);
    expect(
      (done.reply.metadata.sources as unknown[]).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('pin_no_sources — agent path with no sources, just synthesis', async () => {
    const searchMock = jest.fn<DataSourceProvider['search']>();
    const registry = buildRegistry(searchMock, {
      contributeQueryDatabase: false,
    });
    const configService = buildConfigService({ apiKey: 'sk-pin' });
    const service = new ChatAgentService(registry, configService as never);

    const transcript: TranscriptStep[] = [
      { type: 'content', text: 'Hello there.' },
    ];

    mockCreateAgentWithTranscript(createAgentMock, transcript);

    const events = await collectEvents(service, baseParams({ sources: [] }));

    // No tool calls in this transcript → `thinking` is the first event
    // (gates the first chunk per chat-agent.service.ts:698-701).
    expect(eventTypes(events)).toMatchPinSequence([
      'thinking',
      'chunk*',
      'done',
    ]);
    const done = events.at(-1) as {
      type: 'done';
      reply: { metadata: Record<string, unknown> };
    };
    expect(['langchain-agent', 'fallback-search-summary']).toContain(
      done.reply.metadata.generator,
    );
  });

  it('pin_keyless_fallback — no API key, search summary returned as content', async () => {
    const searchMock = jest
      .fn<DataSourceProvider['search']>()
      .mockResolvedValue(makeSearchResponse());
    const registry = buildRegistry(searchMock, {
      contributeQueryDatabase: false,
    });
    const configService = buildConfigService({ apiKey: null });
    const service = new ChatAgentService(registry, configService as never);

    // createAgent must NOT be called in keyless path — explicit failure if it is.
    createAgentMock.mockImplementation(() => {
      throw new Error('createAgent should not be called in keyless fallback');
    });

    const events = await collectEvents(service, baseParams());

    expect(eventTypes(events)).toMatchPinSequence(['chunk*', 'done']);
    const done = events.at(-1) as {
      type: 'done';
      reply: { metadata: Record<string, unknown> };
    };
    // NB: the generator label in code is `'fallback-search-summary'`, not
    // `'keyless-fallback'` (the proposal had the colloquial name; this is
    // the actual string in chat-agent.service.ts). Pin tests pin reality.
    expect(done.reply.metadata.generator).toBe('fallback-search-summary');
  });

  it('pin_sql_only — 1 SQL source, query_database + sql_executed surfaced', async () => {
    const searchMock = jest
      .fn<DataSourceProvider['search']>()
      .mockResolvedValue({ results: [] });
    const registry = buildRegistry(searchMock, {
      contributeQueryDatabase: true,
    });
    const configService = buildConfigService({ apiKey: 'sk-pin' });
    const service = new ChatAgentService(registry, configService as never);

    const transcript: TranscriptStep[] = [
      {
        type: 'tool_call',
        toolName: 'query_database',
        args: { question: 'how many users?' },
        toolResult: JSON.stringify({ rowCount: 1, rows: [{ count: 12 }] }),
      },
      { type: 'content', text: 'There are 12 users.' },
    ];

    mockCreateAgentWithTranscript(createAgentMock, transcript);

    const events = await collectEvents(
      service,
      baseParams({
        sources: [makeDatabaseSource()],
        question: 'how many users?',
      }),
    );

    // Tool-call events (`searching` from the `query_database` tool-call AI
    // message, `sql_executed` drained from ctx.eventSink on the tool message)
    // both precede `thinking`. Order verified empirically against the
    // streaming-loop in chat-agent.service.ts:661-719.
    expect(eventTypes(events)).toMatchPinSequence([
      'searching',
      'sql_executed',
      'thinking',
      'chunk*',
      'done',
    ]);
    const done = events.at(-1) as {
      type: 'done';
      reply: { metadata: Record<string, unknown> };
    };
    expect(done.reply.metadata.generator).toBe('langchain-agent');
    expect(Array.isArray(done.reply.metadata.sqlCalls)).toBe(true);
    expect((done.reply.metadata.sqlCalls as unknown[]).length).toBe(1);
  });

  it('pin_hybrid — 1 Airweave + 1 SQL, both surfaces produce events', async () => {
    const searchMock = jest
      .fn<DataSourceProvider['search']>()
      .mockResolvedValue(makeSearchResponse());
    const registry = buildRegistry(searchMock, {
      contributeQueryDatabase: true,
    });
    const configService = buildConfigService({ apiKey: 'sk-pin' });
    const service = new ChatAgentService(registry, configService as never);

    const transcript: TranscriptStep[] = [
      {
        type: 'tool_call',
        toolName: 'search_knowledge_base',
        args: { query: 'how are users measured' },
        toolResult: JSON.stringify({ results: [makeSearchResult()] }),
      },
      {
        type: 'tool_call',
        toolName: 'query_database',
        args: { question: 'how many active users?' },
        toolResult: JSON.stringify({ rowCount: 1, rows: [{ count: 12 }] }),
      },
      {
        type: 'content',
        text: 'We have 12 active users measured by login frequency.',
      },
    ];

    mockCreateAgentWithTranscript(createAgentMock, transcript);

    const events = await collectEvents(
      service,
      baseParams({
        sources: [makeAirweaveSource(), makeDatabaseSource()],
        question:
          'who are our most active users and how is engagement measured?',
      }),
    );

    // CRITICAL pin: both `searching` (from search_knowledge_base) AND
    // `sql_executed` (from query_database wrapper draining ctx.eventSink)
    // MUST appear. The hybrid scenario is what the router-fallback path
    // (P3b `route='agent'`) is for; this pin guarantees we don't regress
    // it when the router is wired.
    const types = eventTypes(events);
    expect(types).toContain('searching');
    expect(types).toContain('sql_executed');
    expect(types[types.length - 1]).toBe('done');
  });
});
