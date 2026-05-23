// Tests for operator-facing knobs that affect the SQL sub-agent. Three
// knobs live at different layers:
//
//   - drop-checker      → runSqlSubAgent (this file)
//   - sample-rows       → ReadOnlySqlDatabase.fromDataSource
//                         (covered in read-only-sql-database.spec.ts)
//   - model env-fallback → ChatToSqlService.askConnection (existing
//                         chain `getSqlAgentModel() ?? getOpenAiModel()`)
//
// This spec covers the unit where the new code shipped: the
// conditional `query-checker` filter in runSqlSubAgent.

import { jest } from '@jest/globals';
import { z } from 'zod';

let capturedAgentTools: Array<{
  name: string;
  invoke: (input: unknown) => Promise<unknown>;
}> = [];
let mockToolkitTools: Array<{
  name: string;
  description: string;
  schema: z.ZodType;
  invoke: jest.Mock<(input: unknown) => Promise<unknown>>;
}> = [];

const invokeMock = jest.fn(async () => ({
  messages: [
    {
      _getType: () => 'ai',
      content: 'done',
    },
  ],
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
  createAgent: jest.fn((config: { tools: typeof capturedAgentTools }) => {
    capturedAgentTools = config.tools;
    return { invoke: invokeMock };
  }),
}));

const { runSqlSubAgent } = await import('./sql-sub-agent');

function makeToolkitTool(name: string): (typeof mockToolkitTools)[number] {
  return {
    name,
    description: `${name} description`,
    schema: z.string(),
    invoke: jest.fn(async () => 'ok'),
  };
}

const baseConfig = {
  apiKey: 'sk-test',
  model: 'gpt-test',
  systemPrompt: 'prompt',
  maxIterations: 8,
};

describe('runSqlSubAgent — drop-checker config', () => {
  beforeEach(() => {
    capturedAgentTools = [];
    mockToolkitTools = [
      makeToolkitTool('list-sql'),
      makeToolkitTool('info-sql'),
      makeToolkitTool('query-checker'),
      makeToolkitTool('query-sql'),
    ];
    invokeMock.mockClear();
  });

  it('keeps query-checker in the agent tool set when dropCheckerEnabled is undefined (legacy default)', async () => {
    await runSqlSubAgent({} as never, 'q', baseConfig);

    expect(capturedAgentTools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['list-sql', 'info-sql', 'query-checker', 'query-sql']),
    );
  });

  it('keeps query-checker in the agent tool set when dropCheckerEnabled is explicitly false', async () => {
    await runSqlSubAgent({} as never, 'q', {
      ...baseConfig,
      dropCheckerEnabled: false,
    });

    expect(capturedAgentTools.map((t) => t.name)).toContain('query-checker');
  });

  it('filters query-checker out of the agent tool set when dropCheckerEnabled is true', async () => {
    await runSqlSubAgent({} as never, 'q', {
      ...baseConfig,
      dropCheckerEnabled: true,
    });

    const names = capturedAgentTools.map((t) => t.name);
    expect(names).not.toContain('query-checker');
    // Dropping the checker must leave the other three tools intact so
    // the agent can still discover schema and execute SQL.
    expect(names).toEqual(
      expect.arrayContaining(['list-sql', 'info-sql', 'query-sql']),
    );
  });

  it('preserves the identifier-repair wrapper around remaining tools after dropping checker', async () => {
    // The identifier-repair wrapper assigns each tool's invoke via
    // tool(...) rather than passing through the raw toolkit tool.
    // Detect the wrapper indirectly: the captured tool object MUST NOT
    // be the same reference as the toolkit's raw tool. If the
    // post-filter tools bypassed the wrapper, this would regress
    // identifier safety. (Per CLAUDE.md fail-fast: the wrapper is
    // load-bearing for Postgres mixed-case identifiers.)
    await runSqlSubAgent({} as never, 'q', {
      ...baseConfig,
      dropCheckerEnabled: true,
    });
    const querySqlRaw = mockToolkitTools.find((t) => t.name === 'query-sql');
    const querySqlCaptured = capturedAgentTools.find((t) => t.name === 'query-sql');
    expect(querySqlCaptured).toBeDefined();
    expect(querySqlRaw).toBeDefined();
    expect(querySqlCaptured).not.toBe(querySqlRaw);
  });
});
