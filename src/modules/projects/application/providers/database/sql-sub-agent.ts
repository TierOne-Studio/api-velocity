import { ChatOpenAI } from '@langchain/openai';
import { SqlToolkit } from '@langchain/classic/agents/toolkits/sql';
import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ReadOnlySqlDatabase } from './read-only-sql-database';

export type SubAgentConfig = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxIterations: number;
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

  const agent = createAgent({
    model: llm as unknown as BaseChatModel,
    tools: toolkit.getTools(),
    systemPrompt: config.systemPrompt,
  });

  const messages: BaseMessage[] = [new HumanMessage(question)];
  const recursionLimit = Math.max(10, config.maxIterations * 4);

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
