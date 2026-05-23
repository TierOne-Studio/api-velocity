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

  describe('progress wrapper (regression guard)', () => {
    // CRITICAL: this suite reproduces a production regression where
    // `wrapQuerySqlWithProgress` detached `this` from `sqlTool.invoke`
    // via `const invoke = sqlTool.invoke as ...`. The detached method,
    // when called, tried to read `this.defaultConfig` on undefined and
    // crashed every SQL chat turn with
    //   "TypeError: Cannot read properties of undefined (reading 'defaultConfig')"
    //
    // These specs pass `progress` AND actually invoke the captured
    // wrapped tool, so they fail loudly if the binding bug returns.

    it('preserves `this` binding when invoking the underlying query-sql tool', async () => {
      // Use a class-method invoke to expose the binding bug. A plain
      // jest.fn() would still work even with `this` lost — we need a
      // method that reads `this.something` to assert the binding.
      class FakeToolkitQueryTool {
        public readonly defaultConfig = { canary: 'ok' };
        public readonly name = 'query-sql';
        public readonly description = 'query';
        public readonly schema = z.string();
        public readonly invokeMock = jest.fn(async (_input: unknown) => '[]');
        async invoke(input: unknown): Promise<unknown> {
          // Reads `this.defaultConfig` — fails if `this` is undefined,
          // mirroring the runtime crash path inside @langchain/core's
          // Runnable.invoke.
          if (!this.defaultConfig) {
            throw new TypeError(
              "Cannot read properties of undefined (reading 'defaultConfig')",
            );
          }
          return this.invokeMock(input);
        }
      }
      const fakeQuery = new FakeToolkitQueryTool();
      mockToolkitTools = [fakeQuery as unknown as (typeof mockToolkitTools)[number]];

      const onProgress = jest.fn();

      await runSqlSubAgent(
        {} as never,
        'q',
        {
          apiKey: 'sk-test',
          model: 'gpt-test',
          systemPrompt: 'prompt',
          maxIterations: 8,
        },
        undefined,
        {
          connectionId: 'conn-1',
          connectionName: 'prod-db',
          onProgress,
        },
      );

      const wrappedQuerySql = capturedAgentTools.find(
        (t) => t.name === 'query-sql',
      );
      expect(wrappedQuerySql).toBeDefined();

      // Bug repro: pre-fix this throws the defaultConfig TypeError.
      // Post-fix it resolves to the fake's empty result.
      await expect(wrappedQuerySql!.invoke('SELECT 1')).resolves.toBeDefined();

      expect(fakeQuery.invokeMock).toHaveBeenCalledWith('SELECT 1');
    });

    it('fires sql_executing before the underlying tool runs', async () => {
      const order: string[] = [];
      mockToolkitTools = [
        {
          name: 'query-sql',
          description: 'query',
          schema: z.string(),
          invoke: jest.fn(async () => {
            order.push('underlying-invoke');
            return '[]';
          }),
        },
      ];

      const onProgress = jest.fn().mockImplementation(() => {
        order.push('sql_executing');
      });

      await runSqlSubAgent(
        {} as never,
        'q',
        {
          apiKey: 'sk-test',
          model: 'gpt-test',
          systemPrompt: 'prompt',
          maxIterations: 8,
        },
        undefined,
        {
          connectionId: 'conn-1',
          connectionName: 'prod-db',
          onProgress,
        },
      );

      const wrappedQuerySql = capturedAgentTools.find(
        (t) => t.name === 'query-sql',
      );
      await wrappedQuerySql!.invoke('SELECT 1');

      // Order MUST be: progress event THEN underlying invoke. The SPA
      // needs the planning chrome to appear before the query runs.
      expect(order).toEqual(['sql_executing', 'underlying-invoke']);
      expect(onProgress).toHaveBeenCalledWith({
        type: 'sql_executing',
        connectionId: 'conn-1',
        connectionName: 'prod-db',
        sql: 'SELECT 1',
      });
    });

    // Regression guard: the progress wrapper must emit the same SQL
    // string that hits the DB. Earlier the wrapper extracted SQL from
    // the LLM's raw input (pre-repair) while the identifier-repair
    // wrapper rewrote it inside `target.invoke` — the SPA's
    // sql_executing event then surfaced a DIFFERENT string from what
    // executed. The progress wrapper now applies the same repair.
    it('emits sql_executing with the post-repair SQL (matches what the DB receives)', async () => {
      // Two tool calls in order: info-sql (teaches the repair about
      // mixed-case identifiers) → query-sql (the wrapper should now
      // emit the *repaired* SQL).
      mockToolkitTools = [
        {
          name: 'info-sql',
          description: 'schema info',
          schema: z.string(),
          invoke: jest.fn(async () =>
            [
              'CREATE TABLE public.member (',
              '  "userId" text,',
              '  "organizationId" text',
              ');',
            ].join('\n'),
          ),
        },
        {
          name: 'query-sql',
          description: 'query',
          schema: z.string(),
          invoke: jest.fn(async () => '[]'),
        },
      ];

      const onProgress = jest.fn();
      await runSqlSubAgent(
        {} as never,
        'q',
        {
          apiKey: 'sk-test',
          model: 'gpt-test',
          systemPrompt: 'prompt',
          maxIterations: 8,
        },
        undefined,
        {
          connectionId: 'conn-1',
          connectionName: 'prod-db',
          onProgress,
        },
      );

      // Warm the repair cache by invoking info-sql first (mirrors how
      // the real agent learns identifiers from schema before running
      // query-sql).
      await capturedAgentTools
        .find((t) => t.name === 'info-sql')
        ?.invoke('member');
      // Then invoke query-sql with PRE-repair SQL.
      const wrappedQuerySql = capturedAgentTools.find(
        (t) => t.name === 'query-sql',
      );
      await wrappedQuerySql!.invoke(
        'SELECT m.userId, m.organizationId FROM member m',
      );

      // The emitted SQL must match the post-repair form (identifiers
      // quoted) — same string that the underlying tool ends up running.
      const sqlExecutingCalls = onProgress.mock.calls
        .map((c) => c[0] as { type: string; sql?: string })
        .filter((p) => p.type === 'sql_executing');
      expect(sqlExecutingCalls.length).toBe(1);
      expect(sqlExecutingCalls[0]?.sql).toBe(
        'SELECT m."userId", m."organizationId" FROM member m',
      );
    });

    it('does NOT wrap when progress is undefined (preserves legacy callers)', async () => {
      mockToolkitTools = [
        {
          name: 'query-sql',
          description: 'query',
          schema: z.string(),
          invoke: jest.fn(async () => '[]'),
        },
      ];

      const onProgress = jest.fn();

      // No progress arg → wrapQuerySqlWithProgress should not run.
      await runSqlSubAgent(
        {} as never,
        'q',
        {
          apiKey: 'sk-test',
          model: 'gpt-test',
          systemPrompt: 'prompt',
          maxIterations: 8,
        },
      );

      const wrappedQuerySql = capturedAgentTools.find(
        (t) => t.name === 'query-sql',
      );
      await wrappedQuerySql!.invoke('SELECT 1');

      expect(onProgress).not.toHaveBeenCalled();
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
