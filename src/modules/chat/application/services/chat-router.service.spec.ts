// Tests for ChatRouterService in isolation.
//
// Mocks @langchain/openai's ChatOpenAI so the classifier never makes a
// real LLM call. Uses the ESM-correct unstable_mockModule pattern.
//
// Coverage:
// - happy classifications (sql, rag, agent)
// - LLM error → safe fallback {route:'agent', confidence:0, reasoning:'classifier_error'}
// - malformed JSON → safe fallback
// - schema-shape mismatch → safe fallback
// - confidence clamped to [0,1]
// - SSoT: classifier prompt embeds chat-routing-rules.md verbatim
// - model env-fallback chain works (CHAT_ROUTER_MODEL ?? OPENAI_MODEL)

import { jest } from '@jest/globals';

// Capture ChatOpenAI constructor args + .invoke return shape per test.
let capturedConstructorArgs: Record<string, unknown> | null = null;
let invokeMock: jest.Mock<(messages: unknown) => Promise<{ content: unknown }>>;

jest.unstable_mockModule('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation((args: Record<string, unknown>) => {
    capturedConstructorArgs = args;
    return { invoke: invokeMock };
  }),
}));

const { ChatRouterService } = await import('./chat-router.service');
import type { ProjectDataSource } from '../../../projects/api/dto/project.dto';

function buildConfig(opts: {
  routerModel?: string | null;
  openaiModel?: string;
  rules?: string;
  systemTemplate?: string;
} = {}) {
  return {
    getChatRouterModel: jest.fn().mockReturnValue(opts.routerModel ?? null),
    getOpenAiModel: jest.fn().mockReturnValue(opts.openaiModel ?? 'gpt-default'),
    getChatRoutingRules: jest
      .fn()
      .mockReturnValue(opts.rules ?? '# RULES\nSQL: counts.\nRAG: docs.'),
    getChatRouterSystemPrompt: jest
      .fn()
      .mockReturnValue(
        opts.systemTemplate ??
          'You are a classifier.\n\n{{ROUTING_RULES}}\n\nRespond JSON.',
      ),
  };
}

function makeService(configOverrides: Parameters<typeof buildConfig>[0] = {}) {
  return new ChatRouterService(buildConfig(configOverrides) as never);
}

function makeAirweaveSource(): ProjectDataSource {
  return {
    id: 'src-1',
    projectId: 'p1',
    kind: 'airweave_collection',
    name: 'Wiki',
    config: { airweaveCollectionReadableId: 'wiki', airweaveCollectionName: 'Wiki' },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeDatabaseSource(connectionId: string): ProjectDataSource {
  return {
    id: `src-db-${connectionId}`,
    projectId: 'p1',
    kind: 'database',
    name: `db-${connectionId}`,
    config: { connectionId, connectionName: `prod-${connectionId}` },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('ChatRouterService', () => {
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    capturedConstructorArgs = null;
    invokeMock = jest.fn();
    consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('happy classifications', () => {
    it('classifies a clear SQL question', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({
          route: 'sql',
          confidence: 0.95,
          reasoning: 'count over users',
        }),
      });
      const service = makeService();

      const decision = await service.classify({
        question: 'how many users?',
        apiKey: 'sk-1',
        sources: [makeDatabaseSource('conn-1')],
      });

      expect(decision).toEqual({
        route: 'sql',
        confidence: 0.95,
        reasoning: 'count over users',
      });
    });

    it('embeds the airweave collection name (config.airweaveCollectionName) in the classifier prompt', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'rag', confidence: 0.9, reasoning: 'x' }),
      });
      const service = makeService();
      const airweaveSource: ProjectDataSource = {
        id: 'src-aw',
        projectId: 'p1',
        kind: 'airweave_collection',
        name: 'fallback-src-name',
        config: {
          airweaveCollectionReadableId: 'kb-x',
          airweaveCollectionName: 'Distinct-KB-Label',
        },
        status: 'ready',
        statusDetail: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      await service.classify({
        question: 'where is auth?',
        apiKey: 'sk-1',
        sources: [airweaveSource],
      });

      const messages = invokeMock.mock.calls[0][0] as Array<{ content: string }>;
      const userMessage = messages[1].content;
      // Non-vacuous: the name is read from config.airweaveCollectionName and is
      // deliberately distinct from s.name, so the `|| s.name` fallback cannot
      // mask a revert to the old `config.collectionName` key.
      expect(userMessage).toContain('name="Distinct-KB-Label"');
      expect(userMessage).not.toContain('fallback-src-name');
    });

    it('classifies a clear RAG question', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({
          route: 'rag',
          confidence: 0.9,
          reasoning: 'code location ask',
        }),
      });
      const service = makeService();

      const decision = await service.classify({
        question: 'where is auth defined?',
        apiKey: 'sk-1',
        sources: [makeAirweaveSource()],
      });

      expect(decision.route).toBe('rag');
      expect(decision.confidence).toBeCloseTo(0.9);
    });

    it('classifies route=agent for genuinely ambiguous-but-unconfident', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({
          route: 'agent',
          confidence: 0.3,
          reasoning: 'unclear intent',
        }),
      });
      const service = makeService();

      const decision = await service.classify({
        question: 'asdfasdf',
        apiKey: 'sk-1',
        sources: [],
      });

      expect(decision.route).toBe('agent');
    });

    it('preserves sourceId when classifier specifies one for sql', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({
          route: 'sql',
          confidence: 0.9,
          reasoning: 'aggregate',
          sourceId: 'conn-1',
        }),
      });
      const service = makeService();

      const decision = await service.classify({
        question: 'how many orders in prod?',
        apiKey: 'sk-1',
        sources: [makeDatabaseSource('conn-1'), makeDatabaseSource('conn-2')],
      });

      expect(decision).toEqual({
        route: 'sql',
        confidence: 0.9,
        reasoning: 'aggregate',
        sourceId: 'conn-1',
      });
    });
  });

  describe('fail-fast error handling', () => {
    it('returns safe fallback when LLM throws', async () => {
      invokeMock.mockRejectedValue(new Error('429 rate limit'));
      const service = makeService();

      const decision = await service.classify({
        question: 'q',
        apiKey: 'sk-1',
        sources: [],
      });

      expect(decision).toEqual({
        route: 'agent',
        confidence: 0,
        reasoning: 'classifier_error',
      });
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('returns safe fallback on malformed JSON', async () => {
      invokeMock.mockResolvedValue({ content: 'not json {{{' });
      const service = makeService();

      const decision = await service.classify({
        question: 'q',
        apiKey: 'sk-1',
        sources: [],
      });

      expect(decision).toEqual({
        route: 'agent',
        confidence: 0,
        reasoning: 'classifier_invalid_json',
      });
    });

    it('returns safe fallback when route field is missing or invalid', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ confidence: 0.9, reasoning: 'no route' }),
      });
      const service = makeService();

      const decision = await service.classify({
        question: 'q',
        apiKey: 'sk-1',
        sources: [],
      });

      expect(decision.route).toBe('agent');
      expect(decision.reasoning).toBe('classifier_invalid_route');
    });

    it('returns safe fallback when content is not an object', async () => {
      invokeMock.mockResolvedValue({ content: JSON.stringify('just a string') });
      const service = makeService();

      const decision = await service.classify({
        question: 'q',
        apiKey: 'sk-1',
        sources: [],
      });

      expect(decision.route).toBe('agent');
      expect(decision.reasoning).toBe('classifier_invalid_shape');
    });
  });

  describe('confidence clamping and defaults', () => {
    it('clamps confidence above 1', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'sql', confidence: 1.5, reasoning: 'r' }),
      });
      const decision = await makeService().classify({
        question: 'q',
        apiKey: 'sk-1',
        sources: [],
      });
      expect(decision.confidence).toBe(1);
    });

    it('clamps confidence below 0', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'rag', confidence: -0.5, reasoning: 'r' }),
      });
      const decision = await makeService().classify({
        question: 'q',
        apiKey: 'sk-1',
        sources: [],
      });
      expect(decision.confidence).toBe(0);
    });

    it('defaults confidence to 0 when missing or non-numeric', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'sql', reasoning: 'no conf' }),
      });
      const decision = await makeService().classify({
        question: 'q',
        apiKey: 'sk-1',
        sources: [],
      });
      expect(decision.confidence).toBe(0);
    });

    it('defaults reasoning to "no reasoning" when missing', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'sql', confidence: 0.8 }),
      });
      const decision = await makeService().classify({
        question: 'q',
        apiKey: 'sk-1',
        sources: [],
      });
      expect(decision.reasoning).toBe('no reasoning');
    });
  });

  describe('SSoT: classifier prompt composition', () => {
    it('embeds chat-routing-rules.md verbatim into the system prompt at {{ROUTING_RULES}}', () => {
      const customRules = '# SSOT-MARKER-RULES\nThis is the canonical taxonomy.';
      const customTemplate = 'CLASSIFIER PREAMBLE\n\n{{ROUTING_RULES}}\n\nEND.';
      const service = makeService({ rules: customRules, systemTemplate: customTemplate });

      const prompt = service.buildClassifierSystemPrompt();

      expect(prompt).toBe(
        `CLASSIFIER PREAMBLE\n\n${customRules}\n\nEND.`,
      );
      expect(prompt).toContain('SSOT-MARKER-RULES');
    });

    it('appends rules and warns when template is missing {{ROUTING_RULES}} placeholder', () => {
      const customRules = '# RULES\nSQL: counts.';
      const customTemplate = 'CLASSIFIER PREAMBLE WITHOUT PLACEHOLDER';
      const service = makeService({ rules: customRules, systemTemplate: customTemplate });

      const prompt = service.buildClassifierSystemPrompt();

      expect(prompt).toContain('CLASSIFIER PREAMBLE WITHOUT PLACEHOLDER');
      expect(prompt).toContain('# RULES');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing the {{ROUTING_RULES}} placeholder'),
      );
    });

    // Regression guard for multi-occurrence substitution. An operator
    // override template can contain `{{ROUTING_RULES}}` more than once
    // (e.g., once in the preamble and once near examples).
    // `String.prototype.replace` would substitute only the first
    // occurrence and leave the second as a literal placeholder — the
    // classifier would then see an instruction it couldn't fulfil.
    // `replaceAll` is required so every occurrence is substituted.
    it('substitutes ALL occurrences of {{ROUTING_RULES}} (not just the first)', () => {
      const customRules = '# RULES-CONTENT';
      const customTemplate = [
        'PREAMBLE WITH RULES:',
        '{{ROUTING_RULES}}',
        '',
        'AND AGAIN IN EXAMPLES:',
        '{{ROUTING_RULES}}',
        '',
        'END.',
      ].join('\n');
      const service = makeService({ rules: customRules, systemTemplate: customTemplate });

      const prompt = service.buildClassifierSystemPrompt();

      // Every occurrence must be substituted — zero residual placeholders.
      expect(prompt).not.toContain('{{ROUTING_RULES}}');
      // The rules text appears twice — once per placeholder position.
      const rulesOccurrences = (prompt.match(/# RULES-CONTENT/g) ?? []).length;
      expect(rulesOccurrences).toBe(2);
    });
  });

  describe('model env-fallback chain', () => {
    it('uses CHAT_ROUTER_MODEL when set', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'sql', confidence: 0.9, reasoning: 'r' }),
      });
      const service = makeService({
        routerModel: 'router-mini',
        openaiModel: 'gpt-big',
      });

      await service.classify({ question: 'q', apiKey: 'sk-1', sources: [] });

      expect(capturedConstructorArgs?.model).toBe('router-mini');
    });

    it('falls back to OPENAI_MODEL when CHAT_ROUTER_MODEL is null', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'sql', confidence: 0.9, reasoning: 'r' }),
      });
      const service = makeService({
        routerModel: null,
        openaiModel: 'gpt-default',
      });

      await service.classify({ question: 'q', apiKey: 'sk-1', sources: [] });

      expect(capturedConstructorArgs?.model).toBe('gpt-default');
    });

    it('forces JSON output via modelKwargs.response_format', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'sql', confidence: 0.9, reasoning: 'r' }),
      });
      const service = makeService();

      await service.classify({ question: 'q', apiKey: 'sk-1', sources: [] });

      expect(capturedConstructorArgs?.modelKwargs).toMatchObject({
        response_format: { type: 'json_object' },
      });
    });

    it('uses temperature 0 (deterministic classification)', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'sql', confidence: 0.9, reasoning: 'r' }),
      });
      const service = makeService();

      await service.classify({ question: 'q', apiKey: 'sk-1', sources: [] });

      expect(capturedConstructorArgs?.temperature).toBe(0);
    });
  });

  describe('LLM client caching', () => {
    it('reuses the LLM instance across calls with the same (apiKey, model)', async () => {
      invokeMock.mockResolvedValue({
        content: JSON.stringify({ route: 'sql', confidence: 0.9, reasoning: 'r' }),
      });
      const { ChatOpenAI } = await import('@langchain/openai');
      const ChatOpenAIMock = ChatOpenAI as unknown as jest.Mock;
      // The ChatOpenAI mock is module-scope (set up via unstable_mockModule
      // at load time) so its call count accumulates across the whole suite.
      // We measure the DELTA inside this test, not the absolute count.
      const before = ChatOpenAIMock.mock.calls.length;

      const service = makeService();
      await service.classify({ question: 'q1', apiKey: 'sk-1', sources: [] });
      await service.classify({ question: 'q2', apiKey: 'sk-1', sources: [] });

      const after = ChatOpenAIMock.mock.calls.length;
      expect(after - before).toBe(1);
    });
  });
});
