import { jest } from '@jest/globals';
import { z } from 'zod';

let capturedInvokeOptions: Record<string, unknown> | null = null;
let capturedAgentTools: Array<{ name: string; invoke: (input: unknown) => Promise<unknown> }> =
  [];
let mockToolkitTools: Array<{
  name: string;
  description: string;
  schema: z.ZodType;
  invoke: jest.Mock<(input: unknown) => Promise<unknown>>;
}> = [];

const invokeMock = jest.fn(async (_input: unknown, options: Record<string, unknown>) => {
  capturedInvokeOptions = options;
  return {
    messages: [
      {
        _getType: () => 'ai',
        content: 'done',
      },
    ],
  };
});

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

const { repairPostgresMixedCaseIdentifiers, runSqlSubAgent } = await import(
  './sql-sub-agent'
);

describe('runSqlSubAgent', () => {
  beforeEach(() => {
    capturedInvokeOptions = null;
    capturedAgentTools = [];
    mockToolkitTools = [];
    invokeMock.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gives repaired SQL attempts enough graph budget to finish after a successful query', async () => {
    await runSqlSubAgent(
      {} as never,
      'I would like to know the role of each user in the database',
      {
        apiKey: 'sk-test',
        model: 'gpt-test',
        systemPrompt: 'prompt',
        maxIterations: 8,
      },
    );

    expect(capturedInvokeOptions).toMatchObject({ recursionLimit: 24 });
  });

  it('propagates sub-agent invocation failures', async () => {
    invokeMock.mockRejectedValueOnce(
      new Error('column m.userid does not exist password=super-secret'),
    );

    await expect(
      runSqlSubAgent({} as never, 'roles by user', {
        apiKey: 'sk-test',
        model: 'gpt-test',
        systemPrompt: 'prompt',
        maxIterations: 8,
      }),
    ).rejects.toThrow('column m.userid does not exist password=super-secret');
  });

  it('repairs bare mixed-case Postgres identifiers learned from schema inspection before executing SQL', async () => {
    const queryInvoke = jest.fn<(input: unknown) => Promise<unknown>>(async () => '[]');
    mockToolkitTools = [
      {
        name: 'info-sql',
        description: 'schema info',
        schema: z.string(),
        invoke: jest.fn(async () =>
          [
            'CREATE TABLE public.member (',
            '  userId text,',
            '  organizationId text,',
            '  createdAt timestamptz',
            ');',
            'CREATE TABLE public.user (',
            '  approvalStatus text',
            ');',
          ].join('\n'),
        ),
      },
      {
        name: 'query-sql',
        description: 'query',
        schema: z.string(),
        invoke: queryInvoke,
      },
    ];

    await runSqlSubAgent({} as never, 'roles by user', {
      apiKey: 'sk-test',
      model: 'gpt-test',
      systemPrompt: 'prompt',
      maxIterations: 8,
    });

    await capturedAgentTools.find((sqlTool) => sqlTool.name === 'info-sql')?.invoke('member, user');
    await capturedAgentTools
      .find((sqlTool) => sqlTool.name === 'query-sql')
      ?.invoke(
        `SELECT m.userId, m.organizationId, u.approvalStatus, 'm.userId' AS literal
         FROM "public"."member" m
         JOIN "public"."user" u ON m.userId = u.id
         ORDER BY m.createdAt DESC`,
      );

    expect(queryInvoke).toHaveBeenCalledWith(
      `SELECT m."userId", m."organizationId", u."approvalStatus", 'm.userId' AS literal
         FROM "public"."member" m
         JOIN "public"."user" u ON m."userId" = u.id
         ORDER BY m."createdAt" DESC`,
    );
  });

  it('repairs query-checker object inputs from quoted schema identifiers', async () => {
    const queryCheckerInvoke = jest.fn<(input: unknown) => Promise<unknown>>(async () => 'ok');
    mockToolkitTools = [
      {
        name: 'info-sql',
        description: 'schema info',
        schema: z.string(),
        invoke: jest.fn(async () =>
          [
            'CREATE TABLE "public"."member" (',
            '  "userId" text,',
            '  "organizationId" text',
            ');',
          ].join('\n'),
        ),
      },
      {
        name: 'query-checker',
        description: 'query checker',
        schema: z.object({ query: z.string() }),
        invoke: queryCheckerInvoke,
      },
    ];

    await runSqlSubAgent({} as never, 'roles by user', {
      apiKey: 'sk-test',
      model: 'gpt-test',
      systemPrompt: 'prompt',
      maxIterations: 8,
    });

    await capturedAgentTools.find((sqlTool) => sqlTool.name === 'info-sql')?.invoke('member');
    await capturedAgentTools
      .find((sqlTool) => sqlTool.name === 'query-checker')
      ?.invoke({ query: 'SELECT m.userId FROM member m WHERE m.organizationId IS NOT NULL' });

    expect(queryCheckerInvoke).toHaveBeenCalledWith({
      query: 'SELECT m."userId" FROM member m WHERE m."organizationId" IS NOT NULL',
    });
  });

  it('propagates wrapped SQL tool failures', async () => {
    const queryInvoke = jest.fn<(input: unknown) => Promise<unknown>>(async () => {
      throw new Error('column m.userid does not exist password=super-secret');
    });
    mockToolkitTools = [
      {
        name: 'query-sql',
        description: 'query',
        schema: z.string(),
        invoke: queryInvoke,
      },
    ];

    await runSqlSubAgent({} as never, 'roles by user', {
      apiKey: 'sk-test',
      model: 'gpt-test',
      systemPrompt: 'prompt',
      maxIterations: 8,
    });

    await expect(
      capturedAgentTools.find((sqlTool) => sqlTool.name === 'query-sql')?.invoke('SELECT m.userId'),
    ).rejects.toThrow('column m.userid does not exist password=super-secret');
  });

  it('repairs only SQL code segments and preserves quoted/literal regions', () => {
    expect(
      repairPostgresMixedCaseIdentifiers(
        `SELECT $$m.userId$$ AS dollar_literal, 'm.organizationId' AS string_literal, m.userId, m."organizationId" FROM member m`,
        ['userId', 'organizationId'],
      ),
    ).toBe(
      `SELECT $$m.userId$$ AS dollar_literal, 'm.organizationId' AS string_literal, m."userId", m."organizationId" FROM member m`,
    );
  });
});
