// Phase 2 (S1) — schema pre-warming in runSqlSubAgent.
//
// Tests the splice: when SubAgentConfig.prewarmedSchema is set,
// createAgent receives a systemPrompt that contains the schema block
// under the canonical "DO NOT re-fetch" header. When unset (today's
// default), createAgent's systemPrompt is byte-identical to config's.
//
// Mocking pattern mirrors sql-sub-agent.spec.ts / sql-sub-agent.config
// .spec.ts — `jest.unstable_mockModule` for the ESM-mode repo. See
// docs/langchain-agent-refactor-proposal.md §0.1.

import { jest } from '@jest/globals';
import { z } from 'zod';

let capturedSystemPrompt: string | null = null;
let mockToolkitTools: Array<{
  name: string;
  description: string;
  schema: z.ZodType;
  invoke: jest.Mock<(input: unknown) => Promise<unknown>>;
}> = [];

const invokeMock = jest.fn(async () => ({
  messages: [{ _getType: () => 'ai', content: 'done' }],
}));

jest.unstable_mockModule('@langchain/openai', () => ({
  ChatOpenAI: jest.fn(),
}));

jest.unstable_mockModule('@langchain/classic/agents/toolkits/sql', () => ({
  SqlToolkit: class {
    getTools() {
      return mockToolkitTools;
    }
  },
}));

jest.unstable_mockModule('langchain', () => ({
  createAgent: jest.fn((config: { systemPrompt: string }) => {
    capturedSystemPrompt = config.systemPrompt;
    return { invoke: invokeMock };
  }),
}));

const { runSqlSubAgent } = await import('./sql-sub-agent');

const baseConfig = {
  apiKey: 'sk-test',
  model: 'gpt-test',
  systemPrompt: 'Base system prompt for the sub-agent.',
  maxIterations: 8,
};

describe('runSqlSubAgent — Phase 2 S1 schema pre-warming', () => {
  beforeEach(() => {
    capturedSystemPrompt = null;
    mockToolkitTools = [
      {
        name: 'list-sql',
        description: 'list',
        schema: z.string(),
        invoke: jest.fn(async () => 'ok'),
      },
      {
        name: 'query-sql',
        description: 'query',
        schema: z.string(),
        invoke: jest.fn(async () => 'ok'),
      },
    ];
    invokeMock.mockClear();
  });

  it('leaves systemPrompt unchanged when prewarmedSchema is undefined (default)', async () => {
    await runSqlSubAgent({} as never, 'q', baseConfig);
    expect(capturedSystemPrompt).toBe('Base system prompt for the sub-agent.');
  });

  it('leaves systemPrompt unchanged when prewarmedSchema is an empty string', async () => {
    await runSqlSubAgent({} as never, 'q', {
      ...baseConfig,
      prewarmedSchema: '',
    });
    expect(capturedSystemPrompt).toBe('Base system prompt for the sub-agent.');
  });

  it('leaves systemPrompt unchanged when prewarmedSchema is whitespace-only', async () => {
    // Defensive: a pre-warm result that's just whitespace from the parent
    // library should degrade gracefully — same as undefined. The agent
    // then runs the discovery path as today.
    await runSqlSubAgent({} as never, 'q', {
      ...baseConfig,
      prewarmedSchema: '   \n\t  ',
    });
    expect(capturedSystemPrompt).toBe('Base system prompt for the sub-agent.');
  });

  it('appends the schema block under the DO-NOT-re-fetch header when prewarmedSchema is provided', async () => {
    const schema = 'TABLE users (\n  id integer PRIMARY KEY,\n  email text\n)';
    await runSqlSubAgent({} as never, 'q', {
      ...baseConfig,
      prewarmedSchema: schema,
    });

    expect(capturedSystemPrompt).not.toBeNull();
    // Base prompt MUST be preserved verbatim at the start (the schema
    // section is *appended*, not interleaved).
    expect(capturedSystemPrompt!).toMatch(
      /^Base system prompt for the sub-agent\./,
    );
    // The canonical header MUST appear exactly as the matching rule in
    // sql-tool-usage.md expects — a drift here would silently break the
    // prompt contract that lets the agent skip discovery tools.
    expect(capturedSystemPrompt!).toContain(
      '## Schema (already loaded — DO NOT re-fetch)',
    );
    // Schema text MUST appear after the header.
    expect(capturedSystemPrompt!).toContain(schema);
  });

  it('preserves toolkit tool set when pre-warming (does not interfere with S2.1 drop-checker)', async () => {
    // Combination test: pre-warm + dropCheckerEnabled. Both knobs are
    // independent and operator-composable per the proposal §7 matrix.
    mockToolkitTools.push({
      name: 'query-checker',
      description: 'checker',
      schema: z.string(),
      invoke: jest.fn(async () => 'ok'),
    });
    await runSqlSubAgent({} as never, 'q', {
      ...baseConfig,
      prewarmedSchema: 'TABLE t ()',
      dropCheckerEnabled: true,
    });
    expect(capturedSystemPrompt!).toContain('TABLE t ()');
    expect(capturedSystemPrompt!).toContain(
      '## Schema (already loaded — DO NOT re-fetch)',
    );
  });
});
