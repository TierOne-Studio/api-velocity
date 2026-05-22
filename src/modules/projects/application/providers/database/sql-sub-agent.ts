import { ChatOpenAI } from '@langchain/openai';
import { SqlToolkit } from '@langchain/classic/agents/toolkits/sql';
import { createAgent } from 'langchain';
import { tool } from '@langchain/core/tools';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ReadOnlySqlDatabase } from './read-only-sql-database';
import type { SqlProgressCallback } from '../data-source-provider.interface';

type SqlToolkitTool = ReturnType<SqlToolkit['getTools']>[number];

/**
 * Phase 3b (R / §3.6): connection identity for the streaming progress
 * events `runSqlSubAgent` emits via the optional `onProgress` callback.
 * The sub-agent doesn't know the connection's id/name itself — caller
 * passes them through so events carry the metadata the SPA needs to
 * label the progress row correctly when multiple connections are
 * attached.
 */
export type SubAgentProgressContext = {
  connectionId: string;
  connectionName: string;
  onProgress: SqlProgressCallback;
};

export type SubAgentConfig = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxIterations: number;
  /**
   * Phase 1 (S2.1) — when true, the `query-checker` tool is filtered out
   * of the SqlToolkit set exposed to the sub-agent. Saves one LLM call per
   * SQL turn that would have invoked the checker; query syntax errors are
   * handled via the agent's existing repair loop instead.
   *
   * Defaults to `false` (preserves today's behavior). Wired from
   * `ConfigService.getSqlAgentDropCheckerEnabled()` in `ChatToSqlService`.
   */
  dropCheckerEnabled?: boolean;
  /**
   * Phase 2 (S1) — when present, the rendered schema text (from
   * `db.getTableInfo()`) is prepended to `systemPrompt` so the agent
   * starts with full schema context. Combined with the prompt rule in
   * `sql-tool-usage.md`, this lets the agent skip `list-sql` / `info-sql`
   * on the typical turn — saving ~2 LLM round-trips.
   *
   * When undefined, the agent runs as today (must discover schema via
   * tool calls). Wired from `ChatToSqlService` only when
   * `SQL_AGENT_PREWARM_SCHEMA_ENABLED=true`. See proposal §3.1.
   *
   * SoC: schema fetching is a DB-read concern owned by `ChatToSqlService`.
   * `runSqlSubAgent` just receives the rendered text as data.
   */
  prewarmedSchema?: string;
};

export type SubAgentResult = {
  finalText: string;
  messages: BaseMessage[];
  toolMessages: BaseMessage[];
};

/**
 * Runs an inner LangChain agent scoped to a single SqlDatabase. The outer
 * chat agent's `query_database` tool delegates here. The result's tool
 * messages are inspected by the caller to extract the executed SQL + rows.
 */
export async function runSqlSubAgent(
  db: ReadOnlySqlDatabase,
  question: string,
  config: SubAgentConfig,
  signal?: AbortSignal,
  /**
   * Phase 3b (R / §3.6): when provided, fires `sql_executing` via
   * `progress.onProgress` right BEFORE each query-sql tool invocation
   * actually runs against the DB. The chat-agent's streaming loop drains
   * these events at the next outer-loop message boundary so the SPA
   * surfaces progress chrome during the otherwise-silent sub-agent
   * window.
   *
   * Optional and additive — when undefined (legacy callers), behavior
   * is unchanged.
   */
  progress?: SubAgentProgressContext,
): Promise<SubAgentResult> {
  const llm = new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    temperature: 0,
  });

  const toolkit = new SqlToolkit(
    db,
    llm as unknown as BaseChatModel,
  );
  // Phase 1 (S2.1): optionally drop `query-checker`. It performs an extra
  // LLM round-trip to lint SQL before execution; for SELECT-only queries
  // the error from `query-sql` is a sufficient signal to repair on the
  // next iteration. Gate behind `dropCheckerEnabled` so the change is
  // opt-in per environment and the legacy behavior remains the default.
  const rawTools = config.dropCheckerEnabled
    ? toolkit.getTools().filter((t) => t.name !== 'query-checker')
    : toolkit.getTools();
  const identifierRepair = createPostgresIdentifierRepair();
  const repairedTools = rawTools.map((sqlTool) =>
    wrapSqlToolWithIdentifierRepair(sqlTool, identifierRepair),
  );
  // Phase 3b (R / §3.6): wrap the query-sql tool ONCE MORE so each
  // invocation fires `sql_executing` via the progress callback before
  // db.run() actually executes. This is the synchronous push channel
  // chosen in proposal §3.6 (over polling / async-iterator alternatives)
  // because (a) it composes cleanly with the existing identifier-repair
  // wrapper above, (b) it adds zero overhead when progress is undefined,
  // and (c) callers control when the event surfaces via the same
  // ctx.eventSink drain mechanism the chat-agent already runs.
  // Pass identifierRepair into the progress wrapper (Copilot C7 fix). The
  // wrapper applies the SAME repair logic before extracting SQL for the
  // sql_executing event, so what the SPA shows matches what hits the DB.
  // Without this, the event surfaced the LLM's raw SQL (pre-repair) while
  // the actual query was post-repair — visible drift on schemas with
  // mixed-case Postgres identifiers.
  const tools = progress
    ? repairedTools.map((sqlTool) =>
        sqlTool.name === 'query-sql'
          ? wrapQuerySqlWithProgress(sqlTool, progress, identifierRepair)
          : sqlTool,
      )
    : repairedTools;

  // Phase 2 (S1): if ChatToSqlService pre-warmed the schema, splice it into
  // the system prompt so the agent knows tables + columns up front and can
  // skip the discovery tool calls. Empty/whitespace strings degrade
  // gracefully (treated as "no pre-warm provided"). The "DO NOT re-fetch"
  // header is the contract enforced by the matching rule in
  // sql-tool-usage.md — when the agent sees this header it skips
  // list_tables_sql_db / info_sql_db on the typical turn.
  const systemPrompt = config.prewarmedSchema?.trim()
    ? `${config.systemPrompt}\n\n## Schema (already loaded — DO NOT re-fetch)\n${config.prewarmedSchema}`
    : config.systemPrompt;

  const agent = createAgent({
    model: llm as unknown as BaseChatModel,
    tools,
    systemPrompt,
  });

  const messages: BaseMessage[] = [new HumanMessage(question)];
  // The SQL toolkit can spend several graph transitions repairing generated
  // SQL before producing the final assistant message. Keep the cap bounded,
  // but leave room for: inspect schema -> check -> failed query -> repair ->
  // successful query -> final answer.
  const recursionLimit = Math.max(12, config.maxIterations * 3);

  const result = await agent.invoke(
    { messages } as Parameters<typeof agent.invoke>[0],
    { recursionLimit, signal },
  );

  const resultMessages = (result?.messages ?? []) as BaseMessage[];
  const toolMessages = resultMessages.filter((m) => {
    const typed = m as unknown as { _getType?: () => string };
    return typed._getType?.() === 'tool';
  });

  const finalText = extractFinalAssistantText(resultMessages);
  return { finalText, messages: resultMessages, toolMessages };
}

/**
 * Phase 3b (R / §3.6) — wraps an already-identifier-repaired query-sql
 * tool with a progress emitter that fires `sql_executing` JUST BEFORE
 * the underlying tool runs. The emitter is synchronous (no await),
 * matching the §3.6 push-channel choice.
 *
 * IMPORTANT — Copilot C7 fix (post-PR-#22-review): the wrapper applies
 * the SAME identifier-repair to the input before extracting the SQL
 * for the event. Without this, sql_executing surfaced the LLM's raw
 * pre-repair input (e.g. `SELECT * FROM userTable`) while the actual
 * query that hit the DB was post-repair (`SELECT * FROM "userTable"`).
 * The repair is idempotent (proven by repairPostgresMixedCaseIdentifiers'
 * negative lookbehind/lookahead — already-quoted identifiers are
 * skipped) so the inner identifier-repair wrapper running the same
 * repair again is harmless redundant work, not a bug.
 *
 * REGRESSION HISTORY (post-P3b production fix):
 *   The first implementation re-wrapped the tool with another `tool()`
 *   call and reused `sqlTool.schema`. That had TWO bugs in production:
 *   (1) detached `this` when calling sqlTool.invoke via a const-bound
 *       function reference — @langchain/core's Runnable read
 *       `this.defaultConfig` on undefined and crashed every SQL turn.
 *   (2) schema-shape mismatch — feeding a DynamicTool's z.string()
 *       schema back into `tool(...)` resurfaced as a structured-input
 *       expectation, so plain-string inputs got rejected before reaching
 *       the underlying tool.
 *
 *   The Proxy approach below sidesteps BOTH bugs by NOT re-creating the
 *   tool at all. Only `.invoke` is intercepted; every other property
 *   (name, description, schema, _getType, etc.) passes through to the
 *   original object. The `target.invoke(input)` call inside the
 *   intercept preserves `this` because it's a real method call on the
 *   underlying tool — same pattern as the existing
 *   `wrapSqlToolWithIdentifierRepair` which calls `sqlTool.invoke(...)`
 *   as a method.
 */
function wrapQuerySqlWithProgress(
  sqlTool: ReturnType<typeof tool>,
  progress: SubAgentProgressContext,
  identifierRepair: PostgresIdentifierRepair,
): ReturnType<typeof tool> {
  return new Proxy(sqlTool, {
    get(target, prop, receiver) {
      if (prop === 'invoke') {
        // Returned arrow function captures `target` (the actual tool
        // object) so `target.invoke(input)` below preserves `this`.
        return async (input: unknown) => {
          // Copilot C7: apply identifier repair BEFORE emitting so the
          // SPA sees the same SQL the DB receives. The inner repair
          // wrapper will repair again (idempotent — already-quoted
          // identifiers pass through unchanged).
          const repairedInput = repairSqlToolInput(
            'query-sql',
            input,
            identifierRepair,
          );
          const sql = extractSqlFromQueryToolInput(repairedInput);
          progress.onProgress({
            type: 'sql_executing',
            connectionId: progress.connectionId,
            connectionName: progress.connectionName,
            sql,
          });
          // Method call on `target` — preserves `this` binding inside
          // @langchain/core's Runnable.invoke. See REGRESSION HISTORY
          // above for what happens when this binding is lost. We pass
          // the ORIGINAL `input` here (not `repairedInput`) so the
          // inner repair wrapper's contract is unchanged — it expects
          // raw input from the agent.
          return (target as { invoke: (i: unknown) => Promise<unknown> }).invoke(
            input,
          );
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Best-effort SQL extraction from the query-sql tool's input. The
 * toolkit's input shape evolves (string vs {input: string} vs
 * {query: string}); return an empty string when we can't recognize it
 * rather than throwing — the `sql_executing` event is informational
 * progress, NOT load-bearing for correctness.
 */
function extractSqlFromQueryToolInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.input === 'string') return obj.input;
    if (typeof obj.query === 'string') return obj.query;
    if (typeof obj.sql === 'string') return obj.sql;
  }
  return '';
}

function wrapSqlToolWithIdentifierRepair(
  sqlTool: SqlToolkitTool,
  identifierRepair: PostgresIdentifierRepair,
): ReturnType<typeof tool> {
  return tool(
    async (input: unknown) => {
      const toolInput = repairSqlToolInput(sqlTool.name, input, identifierRepair);
      const output = await sqlTool.invoke(
        toolInput as Parameters<typeof sqlTool.invoke>[0],
      );
      if (sqlTool.name === 'info-sql') {
        identifierRepair.addFromSchemaInfo(output);
      }
      return output;
    },
    {
      name: sqlTool.name,
      description: sqlTool.description,
      schema: sqlTool.schema,
    },
  );
}

type PostgresIdentifierRepair = {
  addFromSchemaInfo(output: unknown): void;
  repairSql(sql: string): string;
};

function createPostgresIdentifierRepair(): PostgresIdentifierRepair {
  const mixedCaseIdentifiers = new Set<string>();
  return {
    addFromSchemaInfo(output: unknown): void {
      if (typeof output !== 'string') return;
      for (const identifier of extractQuotedMixedCaseIdentifiers(output)) {
        mixedCaseIdentifiers.add(identifier);
      }
    },
    repairSql(sql: string): string {
      return repairPostgresMixedCaseIdentifiers(sql, mixedCaseIdentifiers);
    },
  };
}

function repairSqlToolInput(
  toolName: string,
  input: unknown,
  identifierRepair: PostgresIdentifierRepair,
): unknown {
  if (toolName !== 'query-sql' && toolName !== 'query-checker') {
    return input;
  }
  if (typeof input === 'string') {
    return identifierRepair.repairSql(input);
  }
  if (!input || typeof input !== 'object') {
    return input;
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === 'string' ? identifierRepair.repairSql(value) : value,
    ]),
  );
}

function extractQuotedMixedCaseIdentifiers(schemaInfo: string): string[] {
  const identifiers = new Set<string>();
  const quotedIdentifierPattern = /"((?:[^"]|"")*[A-Z](?:[^"]|"")*)"/g;
  let match: RegExpExecArray | null;
  while ((match = quotedIdentifierPattern.exec(schemaInfo)) !== null) {
    const identifier = match[1]?.replace(/""/g, '"') ?? '';
    if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(identifier)) {
      identifiers.add(identifier);
    }
  }
  const bareMixedCaseIdentifierPattern =
    /\b(?=[A-Za-z_][A-Za-z0-9_$]*\b)(?=[A-Za-z0-9_$]*[a-z])(?=[A-Za-z0-9_$]*[A-Z])[A-Za-z_][A-Za-z0-9_$]*\b/g;
  while ((match = bareMixedCaseIdentifierPattern.exec(schemaInfo)) !== null) {
    identifiers.add(match[0]);
  }
  return [...identifiers];
}

export function repairPostgresMixedCaseIdentifiers(
  sql: string,
  mixedCaseIdentifiers: Iterable<string>,
): string {
  const identifiers = [...mixedCaseIdentifiers]
    .filter((identifier) => /[A-Z]/.test(identifier))
    .sort((a, b) => b.length - a.length);
  if (identifiers.length === 0) return sql;

  const repairSegment = (segment: string) =>
    identifiers.reduce(
      (repaired, identifier) => replaceBareIdentifier(repaired, identifier),
      segment,
    );

  let output = '';
  let codeStart = 0;
  for (let index = 0; index < sql.length; index++) {
    const dollarTag = readDollarQuoteTag(sql, index);
    if (dollarTag) {
      output += repairSegment(sql.slice(codeStart, index));
      const endIndex = sql.indexOf(dollarTag, index + dollarTag.length);
      const literalEnd = endIndex === -1 ? sql.length : endIndex + dollarTag.length;
      output += sql.slice(index, literalEnd);
      index = literalEnd - 1;
      codeStart = literalEnd;
      continue;
    }

    const quote = sql[index];
    if (quote !== "'" && quote !== '"') continue;

    output += repairSegment(sql.slice(codeStart, index));
    const literalEnd = readQuotedLiteralEnd(sql, index, quote);
    output += sql.slice(index, literalEnd);
    index = literalEnd - 1;
    codeStart = literalEnd;
  }

  return output + repairSegment(sql.slice(codeStart));
}

function replaceBareIdentifier(sql: string, identifier: string): string {
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_$"])${escapeRegExp(identifier)}(?![A-Za-z0-9_$"])`,
    'g',
  );
  return sql.replace(pattern, `"${identifier.replace(/"/g, '""')}"`);
}

function readQuotedLiteralEnd(sql: string, startIndex: number, quote: string): number {
  for (let index = startIndex + 1; index < sql.length; index++) {
    if (sql[index] !== quote) continue;
    if (sql[index + 1] === quote) {
      index++;
      continue;
    }
    return index + 1;
  }
  return sql.length;
}

function readDollarQuoteTag(sql: string, startIndex: number): string | null {
  if (sql[startIndex] !== '$') return null;
  return /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(startIndex))?.[0] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFinalAssistantText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    const typed = message as unknown as { _getType?: () => string };
    const type = typed._getType?.();
    if (type !== 'ai' && type !== 'assistant') continue;
    const content = (message as AIMessage).content;
    const text = stringifyContent(content);
    if (text.trim().length > 0) return text.trim();
  }
  return '';
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (
          block &&
          typeof block === 'object' &&
          'text' in block &&
          typeof (block as { text: unknown }).text === 'string'
        ) {
          return (block as { text: string }).text;
        }
        return '';
      })
      .filter((t) => t.length > 0)
      .join('\n');
  }
  return '';
}
