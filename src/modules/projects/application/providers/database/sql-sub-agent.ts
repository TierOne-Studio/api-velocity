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

type SqlToolkitTool = ReturnType<SqlToolkit['getTools']>[number];

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
  const tools = rawTools.map((sqlTool) =>
    wrapSqlToolWithIdentifierRepair(sqlTool, identifierRepair),
  );

  const agent = createAgent({
    model: llm as unknown as BaseChatModel,
    tools,
    systemPrompt: config.systemPrompt,
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
