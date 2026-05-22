// End-to-end integration test for the streaming chat-agent path.
//
// WHY THIS FILE EXISTS:
// The LLM sometimes emits a fenced ```sql ... ``` block in its text reply
// even though (a) the system prompt tells it not to, and (b) the SQL is
// already delivered separately via the `sql_executed` metadata channel.
// When the closing fence lands glued to prose on the same line, the markdown
// parser in the SPA never closes the code block and the whole rest of the
// reply renders as a single monospaced box with literal **asterisks** and
// backticks bleeding through.
//
// `chat-agent.service.spec.ts` tests the sanitizer helpers in isolation.
// This spec goes one level up: it mocks `langchain.createAgent` so the
// fake agent emits the EXACT broken token sequence observed in production
// (captured from the user's devtools Response panel), then asserts that
// every surface the SPA can read — the live streamed chunks AND the final
// `done.reply.content` that gets persisted — is free of ```sql fences.
//
// If this test ever fails again, it means a new code path is bypassing the
// sanitizer and the fix is incomplete.

import { jest } from '@jest/globals';
import { AIMessage } from '@langchain/core/messages';

// IMPORTANT: this repo runs jest in ESM mode (extensionsToTreatAsEsm: ['.ts']
// + node --experimental-vm-modules). The legacy `jest.mock('langchain', ...)`
// pattern from CJS does NOT work here — the static `import` of `langchain`
// resolves to the real module before the mock factory is registered, real
// `createAgent` runs, and the OpenAI HTTP call returns 401 on the fake key.
// `jest.unstable_mockModule` + dynamic `import()` is the ESM-correct path.
const createAgentMock = jest.fn();
jest.unstable_mockModule('langchain', () => ({
  createAgent: (...args: unknown[]) => createAgentMock(...args),
}));

// ChatAgentService MUST be loaded dynamically AFTER the module mock above.
// Static `import` would resolve `langchain` before the mock factory runs.
type ChatAgentServiceType =
  InstanceType<typeof import('./chat-agent.service').ChatAgentService>;
let ChatAgentService:
  typeof import('./chat-agent.service').ChatAgentService;

// Phase 4-lite: barrel import.
import type {
  DataSourceRegistry,
  ProjectDataSource,
} from '../../../projects';

function makeAirweaveSource(): ProjectDataSource {
  return {
    id: 'src-1',
    projectId: 'proj-1',
    kind: 'airweave_collection',
    name: 'General',
    config: {
      collectionReadableId: 'velocity',
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
    id: 'src-db-1',
    projectId: 'proj-1',
    kind: 'database',
    name: 'prod-db',
    config: {
      connectionId: 'conn-1',
      connectionName: 'prod-db',
    },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as ProjectDataSource;
}

function baseParams(
  overrides: Partial<Parameters<ChatAgentServiceType['generateReply']>[0]> = {},
) {
  return {
    organizationName: 'Champion Velocity',
    projectName: 'General',
    projectId: 'proj-1',
    orgId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    sources: [makeAirweaveSource(), makeDatabaseSource()],
    question: 'count users in database',
    previousMessages: [],
    ...overrides,
  };
}

function buildService(): ChatAgentServiceType {
  const registry = {
    get: jest.fn(() => ({
      kind: 'airweave_collection',
      search: jest.fn(),
    })),
    kinds: jest.fn(() => ['airweave_collection']),
    getAgentToolsFor: jest.fn(() => []),
  } as unknown as DataSourceRegistry;

  const configService = {
    getOpenAiApiKey: jest.fn().mockReturnValue('sk-openai'),
    getOpenAiModel: jest.fn().mockReturnValue('gpt-4o'),
    getChatSystemPrompt: jest.fn().mockReturnValue('expert prompt'),
    getChatAgentMaxIterations: jest.fn().mockReturnValue(5),
    getChatAgentToolResultCharCap: jest.fn().mockReturnValue(3000),
    getChatAgentToolResultLimit: jest.fn().mockReturnValue(12),
    getChatAgentMaxSources: jest.fn().mockReturnValue(15),
    getChatAgentHistoryWindow: jest.fn().mockReturnValue(6),
    getChatAgentSearchTier: jest.fn().mockReturnValue('classic'),
    getChatAgentRetrievalStrategy: jest.fn().mockReturnValue(undefined),
    // Phase 3b additions (router OFF — this spec exercises the agent path).
    getChatRoutingRules: jest
      .fn()
      .mockReturnValue('# RULES\n- SQL: counts.\n- RAG: docs.'),
    getChatRouterEnabled: jest.fn().mockReturnValue(false),
    getChatRouterConfidenceThreshold: jest.fn().mockReturnValue(0.7),
  };

  return new ChatAgentService(registry, configService as never);
}

// Builds an async iterable that mimics what `agent.stream({messages}, {streamMode: 'messages'})`
// returns: a sequence of [BaseMessage, metadata] tuples where each AIMessage
// carries a delta token in .content and metadata has langgraph_node set.
function agentStreamOf(tokens: string[]) {
  return (async function* () {
    for (const token of tokens) {
      yield [new AIMessage(token), { langgraph_node: 'agent' }] as const;
    }
  })();
}

describe('ChatAgentService streaming — SQL fence sanitization (integration)', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleInfoSpy: jest.SpiedFunction<typeof console.info>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeAll(async () => {
    ({ ChatAgentService } = await import('./chat-agent.service'));
  });

  beforeEach(() => {
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

  it('produces clean streamed chunks AND clean persisted content for the real-world broken output', async () => {
    // Exact token shape from the user's DevTools Response panel screenshot.
    // Reconstructed as the kind of deltas LangChain emits when streaming:
    // the model's full output was:
    //   ```sql
    //   SELECT COUNT(*) AS user_count FROM "user" LIMIT 100
    //   ```Found **4** rows in the `"user"` table (user_count = 4).There are **4 users** in the database.
    // Note the closing fence glued to "Found" on the same line.
    const brokenTokens = [
      '```',
      'sql\n',
      'SELECT COUNT(*) AS user_count FROM "user" LIMIT 100\n',
      '```',
      'Found ',
      '**4** ',
      'rows in the `"user"` table ',
      '(user_count = 4).',
      'There are **4 users** in the database.',
    ];

    createAgentMock.mockReturnValue({
      stream: jest.fn<() => Promise<unknown>>().mockResolvedValue(
        agentStreamOf(brokenTokens),
      ),
      invoke: jest.fn(),
    } as never);

    const service = buildService();
    const events: Array<Record<string, unknown>> = [];
    for await (const event of service.generateReplyStreaming(baseParams())) {
      events.push(event as unknown as Record<string, unknown>);
    }

    // Reconstruct what the SPA sees live during streaming.
    const streamedLive = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.content as string)
      .join('');

    // Reconstruct what the SPA persists + shows on page reload.
    const doneEvent = events.find((e) => e.type === 'done') as
      | { reply: { content: string; metadata: Record<string, unknown> } }
      | undefined;
    const persisted = doneEvent?.reply?.content ?? '';

    // --- The bug manifests as ANY of these on either surface:

    // 1. Triple backticks anywhere at all (the SPA markdown parser's input).
    expect(streamedLive).not.toContain('```');
    expect(persisted).not.toContain('```');

    // 2. The literal "sql" language tag adjacent to fence markers.
    expect(streamedLive.toLowerCase()).not.toContain('```sql');
    expect(persisted.toLowerCase()).not.toContain('```sql');

    // 3. The SQL itself leaking into the prose — it belongs in metadata only.
    expect(persisted).not.toContain('SELECT COUNT(*)');
    expect(streamedLive).not.toContain('SELECT COUNT(*)');

    // --- And the ACTUAL prose must remain intact and readable.
    expect(persisted).toContain('Found');
    expect(persisted).toContain('**4**');
    expect(persisted).toContain('There are **4 users** in the database.');
    expect(streamedLive).toContain('Found');
    expect(streamedLive).toContain('There are **4 users** in the database.');
  });

  it('handles the pathological case where ```sql and its closing fence arrive in a single token', async () => {
    const brokenTokens = [
      '```sql\nSELECT 1\n```Found 4 rows.',
      ' All good.',
    ];

    createAgentMock.mockReturnValue({
      stream: jest.fn<() => Promise<unknown>>().mockResolvedValue(
        agentStreamOf(brokenTokens),
      ),
      invoke: jest.fn(),
    } as never);

    const service = buildService();
    const events: Array<Record<string, unknown>> = [];
    for await (const event of service.generateReplyStreaming(baseParams())) {
      events.push(event as unknown as Record<string, unknown>);
    }

    const streamedLive = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.content as string)
      .join('');
    const doneEvent = events.find((e) => e.type === 'done') as
      | { reply: { content: string } }
      | undefined;
    const persisted = doneEvent?.reply?.content ?? '';

    expect(streamedLive).not.toContain('```');
    expect(persisted).not.toContain('```');
    expect(persisted).toContain('Found 4 rows.');
    expect(persisted).toContain('All good.');
  });

  it('passes non-SQL fenced code (e.g. ```js) through untouched', async () => {
    const tokens = [
      'Here is JS:\n',
      '```',
      'js\n',
      'console.log(1)\n',
      '```',
      '\nDone.',
    ];

    createAgentMock.mockReturnValue({
      stream: jest.fn<() => Promise<unknown>>().mockResolvedValue(
        agentStreamOf(tokens),
      ),
      invoke: jest.fn(),
    } as never);

    const service = buildService();
    const events: Array<Record<string, unknown>> = [];
    for await (const event of service.generateReplyStreaming(baseParams())) {
      events.push(event as unknown as Record<string, unknown>);
    }

    const doneEvent = events.find((e) => e.type === 'done') as
      | { reply: { content: string } }
      | undefined;
    const persisted = doneEvent?.reply?.content ?? '';

    expect(persisted).toContain('```js');
    expect(persisted).toContain('console.log(1)');
    expect(persisted).toContain('Done.');
  });
});
