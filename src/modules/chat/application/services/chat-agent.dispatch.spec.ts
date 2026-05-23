// Tests for the dispatcher branch in ChatAgentService.
//
// Coverage:
// - flag off → existing agent path runs, router NOT consulted.
// - flag on + ChatRouterService missing → warn + agent path (fail-safe).
// - flag on + classifier returns route='agent' → agent path.
// - flag on + classifier returns confidence < threshold → agent path.
// - flag on + classifier returns sql with high confidence → runSqlRoute fires.
// - flag on + classifier returns rag with high confidence → runRagRoute fires.
// - SSoT: agent system prompt contains routing-rules text whether flag on or off.
//
// Uses the established unstable_mockModule pattern for the agent layer.

import { jest } from '@jest/globals';
import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import {
  installCreateAgentMock,
  mockCreateAgentWithTranscript,
  resetCapturedTools,
} from '../../../../shared/test-utils/agent-transcript-mock';
import { registerPinMatcher } from '../../../../shared/test-utils/pin-matchers';
import type {
  DataSourceRegistry,
  AgentToolContext,
  DataSourceProvider,
  ProjectDataSource,
} from '../../../projects';
import type { AirweaveSearchResponse } from '../../../airweave/application/services/airweave.service';
import type {
  ChatRouterService,
  RouterDecision,
} from './chat-router.service';

registerPinMatcher();

const createAgentMock = installCreateAgentMock();
jest.unstable_mockModule('langchain', () => ({
  createAgent: (...args: unknown[]) =>
    (createAgentMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

// llm.stream() returns an async iterable of chunks. Stub it module-wide so
// runSqlRoute / runRagRoute's synthesis path produces deterministic output.
async function* fakeLlmStream(text: string) {
  yield new AIMessage(text);
}

jest.unstable_mockModule('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn(),
    stream: jest.fn(async () => fakeLlmStream('Synthesized answer text.')),
  })),
}));

const { ChatAgentService } = await import('./chat-agent.service');

// --- fixtures ----------------------------------------------------------------

function makeAirweaveSource(): ProjectDataSource {
  return {
    id: 'src-aw',
    projectId: 'proj-1',
    kind: 'airweave_collection',
    name: 'General',
    config: { collectionReadableId: 'velocity', collectionName: 'General' },
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

function makeFakeQueryDatabaseTool(ctx: AgentToolContext): StructuredTool {
  return tool(
    async () => {
      ctx.eventSink.push({
        type: 'sql_executed',
        connectionId: 'conn-1',
        connectionName: 'prod-db',
        sql: 'SELECT count(*) FROM users',
        rowCount: 1,
        rows: [{ count: 12 }],
        truncated: false,
        durationMs: 42,
      });
      ctx.persistedCalls.push({
        connectionId: 'conn-1',
        connectionName: 'prod-db',
        sql: 'SELECT count(*) FROM users',
        rowCount: 1,
        truncated: false,
        durationMs: 42,
      });
      return JSON.stringify({ rowCount: 1, rows: [{ count: 12 }] });
    },
    {
      name: 'query_database',
      description: 'fake',
      schema: z.object({ question: z.string(), source_id: z.string().optional() }),
    },
  ) as unknown as StructuredTool;
}

function buildRegistry(opts: { withDatabase: boolean }): DataSourceRegistry {
  const searchMock = jest
    .fn<DataSourceProvider['search']>()
    .mockResolvedValue({
      results: [
        {
          entityId: 'e1',
          name: 'doc',
          relevanceScore: 0.9,
          breadcrumbs: [],
          createdAt: null,
          updatedAt: null,
          text: 'Some doc text.',
          sourceName: 'wiki',
          entityType: 'page',
          webUrl: 'https://example.test/',
        },
      ],
    } as unknown as AirweaveSearchResponse);
  return {
    get: jest.fn(() => ({
      kind: 'airweave_collection',
      search: searchMock,
    })),
    kinds: jest.fn(() => ['airweave_collection', 'database']),
    getAgentToolsFor: jest.fn(
      (sources: ProjectDataSource[], ctx: AgentToolContext) => {
        if (opts.withDatabase && sources.some((s) => s.kind === 'database')) {
          return [makeFakeQueryDatabaseTool(ctx)];
        }
        return [];
      },
    ),
  } as unknown as DataSourceRegistry;
}

function buildConfig(opts: {
  routerEnabled?: boolean;
  threshold?: number;
  rules?: string;
}) {
  return {
    getOpenAiApiKey: jest.fn().mockReturnValue('sk-pin'),
    getOpenAiModel: jest.fn().mockReturnValue('gpt-pin'),
    getChatSystemPrompt: jest.fn().mockReturnValue('expert prompt'),
    getChatAgentMaxIterations: jest.fn().mockReturnValue(5),
    getChatAgentToolResultCharCap: jest.fn().mockReturnValue(3000),
    getChatAgentToolResultLimit: jest.fn().mockReturnValue(12),
    getChatAgentMaxSources: jest.fn().mockReturnValue(15),
    getChatAgentHistoryWindow: jest.fn().mockReturnValue(6),
    getChatAgentSearchTier: jest.fn().mockReturnValue('classic'),
    getChatAgentRetrievalStrategy: jest.fn().mockReturnValue(undefined),
    getQueryDatabaseToolDescription: jest.fn().mockReturnValue('fake desc'),
    getChatRoutingRules: jest.fn().mockReturnValue(
      opts.rules ?? '# SSOT-MARKER\n- SQL: counts.\n- RAG: docs.',
    ),
    getChatRouterEnabled: jest.fn().mockReturnValue(opts.routerEnabled ?? false),
    getChatRouterConfidenceThreshold: jest
      .fn()
      .mockReturnValue(opts.threshold ?? 0.7),
  };
}

function buildRouter(decision: RouterDecision | (() => Promise<RouterDecision>)) {
  return {
    classify: jest.fn().mockImplementation(async () =>
      typeof decision === 'function' ? await decision() : decision,
    ),
  } as unknown as ChatRouterService;
}

function baseParams(sources: ProjectDataSource[], question = 'q') {
  return {
    organizationName: 'Champion',
    projectName: 'General',
    projectId: 'proj-1',
    orgId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    sources,
    question,
    previousMessages: [],
  };
}

async function collect(
  service: InstanceType<typeof ChatAgentService>,
  params: ReturnType<typeof baseParams>,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of service.generateReplyStreaming(params)) {
    events.push(event as unknown as Record<string, unknown>);
  }
  return events;
}

// --- suite -------------------------------------------------------------------

describe('ChatAgentService dispatcher', () => {
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
  let consoleInfoSpy: jest.SpiedFunction<typeof console.info>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    resetCapturedTools();
    createAgentMock.mockReset();
    consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('router flag off (default)', () => {
    it('does not call the router and runs the agent path', async () => {
      const router = buildRouter({
        route: 'sql',
        confidence: 0.99,
        reasoning: 'r',
      });
      const service = new ChatAgentService(
        buildRegistry({ withDatabase: false }),
        buildConfig({ routerEnabled: false }) as never,
        router,
      );
      mockCreateAgentWithTranscript(createAgentMock, [
        { type: 'content', text: 'Agent answer.' },
      ]);

      await collect(service, baseParams([makeAirweaveSource()]));

      expect(router.classify).not.toHaveBeenCalled();
      expect(createAgentMock).toHaveBeenCalled();
    });
  });

  describe('router flag on, fail-safe defaults', () => {
    it('falls through to agent path when ChatRouterService is not injected (warn)', async () => {
      const service = new ChatAgentService(
        buildRegistry({ withDatabase: false }),
        buildConfig({ routerEnabled: true }) as never,
        // No router — third arg omitted entirely.
      );
      mockCreateAgentWithTranscript(createAgentMock, [
        { type: 'content', text: 'Agent answer.' },
      ]);

      await collect(service, baseParams([makeAirweaveSource()]));

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ChatRouterService is not injected'),
      );
      expect(createAgentMock).toHaveBeenCalled();
    });

    it('falls through to agent path when classifier returns route=agent', async () => {
      const router = buildRouter({
        route: 'agent',
        confidence: 0.95,
        reasoning: 'ambiguous',
      });
      const service = new ChatAgentService(
        buildRegistry({ withDatabase: true }),
        buildConfig({ routerEnabled: true }) as never,
        router,
      );
      mockCreateAgentWithTranscript(createAgentMock, [
        { type: 'content', text: 'Agent answer.' },
      ]);

      await collect(
        service,
        baseParams([makeAirweaveSource(), makeDatabaseSource()]),
      );

      expect(router.classify).toHaveBeenCalled();
      expect(createAgentMock).toHaveBeenCalled();
    });

    it('falls through to agent path when confidence < threshold', async () => {
      const router = buildRouter({
        route: 'sql',
        confidence: 0.5, // below default 0.7
        reasoning: 'unsure',
      });
      const service = new ChatAgentService(
        buildRegistry({ withDatabase: true }),
        buildConfig({ routerEnabled: true, threshold: 0.7 }) as never,
        router,
      );
      mockCreateAgentWithTranscript(createAgentMock, [
        { type: 'content', text: 'Agent answer.' },
      ]);

      await collect(service, baseParams([makeDatabaseSource()]));

      expect(router.classify).toHaveBeenCalled();
      expect(createAgentMock).toHaveBeenCalled();
    });
  });

  describe('router flag on, high confidence — direct route execution', () => {
    it('runSqlRoute fires when classifier returns sql with confidence >= threshold', async () => {
      const router = buildRouter({
        route: 'sql',
        confidence: 0.95,
        reasoning: 'count',
      });
      const service = new ChatAgentService(
        buildRegistry({ withDatabase: true }),
        buildConfig({ routerEnabled: true, threshold: 0.7 }) as never,
        router,
      );

      const events = await collect(
        service,
        baseParams([makeDatabaseSource()], 'how many users?'),
      );

      expect(router.classify).toHaveBeenCalled();
      expect(createAgentMock).not.toHaveBeenCalled(); // bypassed!
      const types = events.map((e) => e.type);
      expect(types).toContain('searching');
      expect(types).toContain('sql_executed');
      expect(types[types.length - 1]).toBe('done');
      const done = events.at(-1) as {
        reply: { metadata: Record<string, unknown> };
      };
      expect(done.reply.metadata.generator).toBe('router-sql');
      // Router-path metadata must surface toolCallCount so
      // recordTurnMetrics computes llmCalls correctly (1 query_database
      // tool call + 1 synthesis → llmCalls=2).
      expect(done.reply.metadata.toolCallCount).toBe(1);
      // The chat.turn telemetry event must report route='sql' for
      // router-sql turns.
      const turnEvents = consoleInfoSpy.mock.calls
        .map((c) => c[1] as Record<string, unknown> | undefined)
        .filter((p): p is Record<string, unknown> => p?.event === 'chat.turn');
      expect(turnEvents.length).toBeGreaterThanOrEqual(1);
      expect(turnEvents[0]?.route).toBe('sql');
      // durationMs must reflect the real turn time.
      expect(turnEvents[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('runRagRoute fires when classifier returns rag with confidence >= threshold', async () => {
      const router = buildRouter({
        route: 'rag',
        confidence: 0.9,
        reasoning: 'concept',
      });
      const service = new ChatAgentService(
        buildRegistry({ withDatabase: false }),
        buildConfig({ routerEnabled: true, threshold: 0.7 }) as never,
        router,
      );

      const events = await collect(
        service,
        baseParams([makeAirweaveSource()], 'how does auth work?'),
      );

      expect(router.classify).toHaveBeenCalled();
      expect(createAgentMock).not.toHaveBeenCalled();
      const types = events.map((e) => e.type);
      expect(types).toContain('searching');
      expect(types[types.length - 1]).toBe('done');
      const done = events.at(-1) as {
        reply: { metadata: Record<string, unknown> };
      };
      expect(done.reply.metadata.generator).toBe('router-rag');
      // Same telemetry guards as runSqlRoute — see comment block above.
      expect(done.reply.metadata.toolCallCount).toBe(1);
      const turnEvents = consoleInfoSpy.mock.calls
        .map((c) => c[1] as Record<string, unknown> | undefined)
        .filter((p): p is Record<string, unknown> => p?.event === 'chat.turn');
      expect(turnEvents.length).toBeGreaterThanOrEqual(1);
      expect(turnEvents[0]?.route).toBe('rag');
      expect(turnEvents[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('SSoT routing-rules embedded in agent system prompt', () => {
    it('agent prompt contains routing-rules text under both router flag states', () => {
      const customRules = '# SSOT-MARKER\nThis text MUST appear in the agent prompt.';
      const paramsWithDb = baseParams([makeDatabaseSource()]);

      // Flag OFF
      const offService = new ChatAgentService(
        buildRegistry({ withDatabase: true }),
        buildConfig({ routerEnabled: false, rules: customRules }) as never,
      );
      const offPrompt = offService.buildAgentSystemPrompt(paramsWithDb);
      expect(offPrompt).toContain('SSOT-MARKER');

      // Flag ON
      const onService = new ChatAgentService(
        buildRegistry({ withDatabase: true }),
        buildConfig({ routerEnabled: true, rules: customRules }) as never,
        buildRouter({ route: 'agent', confidence: 0.5, reasoning: 'r' }),
      );
      const onPrompt = onService.buildAgentSystemPrompt(paramsWithDb);
      expect(onPrompt).toContain('SSOT-MARKER');

      // The rules text must be byte-identical in both consumers — that's
      // the SSoT property. If the prompt builders ever diverge, this
      // assertion regresses.
      const offRulesSection = offPrompt
        .split('## When the project has an attached database')[1]
        ?.split('## Tool-use directives')[0];
      const onRulesSection = onPrompt
        .split('## When the project has an attached database')[1]
        ?.split('## Tool-use directives')[0];
      expect(offRulesSection).toBe(onRulesSection);
    });

    it('agent prompt OMITS the routing protocol when no database source is attached', () => {
      // Preserves prior behavior — the routing section is database-gated.
      const service = new ChatAgentService(
        buildRegistry({ withDatabase: false }),
        buildConfig({ routerEnabled: false }) as never,
      );
      const prompt = service.buildAgentSystemPrompt(
        baseParams([makeAirweaveSource()]),
      );
      expect(prompt).not.toContain('## When the project has an attached database');
    });
  });
});
