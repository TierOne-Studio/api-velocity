import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createAgent } from 'langchain';
import { ConfigService } from '../../../../shared/config';
import type { AirweaveSearchResultSummary } from '../../../airweave/application/services/airweave.service';
import { DataSourceRegistry } from '../../../projects/application/providers/data-source.registry';
import type {
  AgentToolContext,
  AgentToolEvent,
  AgentToolPersistedCall,
} from '../../../projects/application/providers/data-source-provider.interface';
import type { ProjectDataSource } from '../../../projects/api/dto/project.dto';
import {
  createSearchKnowledgeBaseTool,
  dedupeAndCapSources,
} from './chat-agent-tools';

type GenerateReplyParams = {
  organizationName: string;
  projectName: string;
  projectId: string;
  orgId: string | null;
  userId: string;
  conversationId: string | null;
  sources: ProjectDataSource[];
  question: string;
  previousMessages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  /**
   * Optional abort signal from the HTTP transport. Forwarded to every
   * provider tool via `AgentToolContext.signal` so long-running work
   * (notably the SQL sub-agent) can cancel when the client disconnects.
   */
  signal?: AbortSignal;
};

type ChatReply = {
  content: string;
  metadata: Record<string, unknown>;
};

export type ChatStreamEvent =
  | { type: 'thinking' }
  | { type: 'searching'; query: string }
  | { type: 'chunk'; content: string }
  | {
      type: 'sql_executed';
      connectionId: string;
      connectionName: string;
      sql: string;
      rowCount: number;
      rows: unknown[];
      truncated: boolean;
      durationMs: number;
    }
  | { type: 'done'; reply: ChatReply };

// Appended to the configured expert-persona system prompt only in the agent
// path. Lives inline (rather than in the markdown prompt file) because it is
// tightly coupled to the `search_knowledge_base` tool schema defined in
// chat-agent-tools.ts — editing one without the other would be a bug.
const AGENT_TOOL_USAGE_PROTOCOL = `

## Tool usage protocol

You have access to a \`search_knowledge_base\` tool that queries this organization's indexed sources via Airweave. Use it aggressively before answering any non-trivial question.

1. **Always start with the user's original question verbatim as your first \`search_knowledge_base\` call.** The retrieval model is tuned for natural-language phrasing, and short keyword decompositions ("projects", "deploy", "auth") often return worse results than the full question. Do not skip this step.
2. After the first call, decide whether the results cover the question. If they do, synthesize the answer.
3. If coverage is incomplete, issue follow-up searches that rephrase or focus on specific aspects of the question. Prefer natural-language phrases over short keywords. Do not repeat a query you have already issued.
4. Synthesize a single coherent expert answer grounded only in the tool results you received.
5. If after several varied queries the information is still insufficient, follow the "When context is insufficient" protocol from the section above — say so explicitly, describe what you did find, and suggest what additional source material would answer the question.

Do not answer non-trivial organization-specific questions from memory — the tool is your only authoritative source for facts about this organization's code, docs, specs, and other indexed material.
`.trim();

// Appended AFTER the base tool-usage protocol when the project has at least
// one attached database source. Routes between `search_knowledge_base` and
// `query_database` by the *shape of the answer* the user wants, not by
// keywords. A question like "how many users signed up last week?" must route
// to the DB even though the word "database" never appears.
const AGENT_DATABASE_ROUTING_PROTOCOL = `

## When the project has an attached database

**This section overrides the "always start with \`search_knowledge_base\`" rule above whenever the question is a facts-from-rows question.** You also have a \`query_database\` tool, and for those questions you must call it *first* — not after a round of \`search_knowledge_base\`.

Route by the *shape of the answer* the user wants, not by keywords in the question. The user does NOT need to mention "database", "SQL", or a table name.

**Call \`query_database\` FIRST (before any other tool) when the question is any of:**

- A count, total, or aggregate: "how many users?", "how many orders last week", "total revenue", "average session length".
- A "who / which / when / where" lookup over entities that typically live in tables (users, orders, sessions, events, subscriptions, customers, projects, etc.): "who signed up today?", "which order is largest?", "when was the last payment?".
- A listing or filter: "list users created this month", "show failed payments", "top 10 customers by spend".
- A concrete factual question about entity state: "is user X active?", "does order Y have a refund?".

For any of the above, pass the user's question verbatim as the \`question\` argument — the inner sub-agent will inspect the schema and write the SQL. Do not pre-translate to SQL yourself. Do not ask the user for clarification before trying; the inner agent is good at disambiguating tables and columns.

**Call \`search_knowledge_base\` (not \`query_database\`) when the question is about:**

- How something is built, implemented, or architected.
- What a function / class / module does, or where to find it.
- Why a design choice was made, or what a spec/doc says.
- Onboarding, setup, or operational procedures.

**Ambiguous questions:** if a question could read either way (e.g. "tell me about our users" — overview docs vs. a row summary), try \`query_database\` first. Row counts and concrete values are more useful and more verifiable than doc snippets for most factual asks. You can always follow up with \`search_knowledge_base\` afterward if the rows alone don't cover the question.

When you call \`query_database\`, cite the numbers you got back; never reshape them. When results are empty or the tool returns an error, say so plainly and consider falling back to \`search_knowledge_base\` for a complementary view.

## Answer format after query_database

Reply with **prose only** — 1–3 short sentences that directly answer the question using values from \`rows\`. For multi-row results, a small markdown table is fine.

**Do NOT include the SQL query in your reply.** The application UI renders the executed SQL automatically from tool metadata as a separate, collapsible panel beneath your answer. Repeating the SQL in your text creates duplication and renders poorly.

### Correct example

  There are 4 users in your database.

### Incorrect examples (do NOT do this)

- Pasting a \`\`\`sql fenced block with the query — the UI already shows it.
- Wrapping any part of the reply in a code fence.
- Prefixing the answer with "I ran the query …" or other meta-commentary about tool use.
`.trim();

// LLMs occasionally ignore the "do not include the SQL query" instruction and
// emit a fenced code block containing SQL anyway. In practice the model uses
// either ```sql ... ``` OR a bare ``` ... ``` fence (no language tag). When
// the closing fence lands on the same line as prose (a common LLM bug), the
// markdown parser never closes the fence and the whole rest of the reply
// renders as a single code box with literal **markdown** bleeding through.
// Since the executed SQL is already carried in metadata.sqlCalls and rendered
// deterministically on the client via a dedicated panel, any SQL fence in
// the prose is pure noise. This sanitizer strips it unconditionally but
// leaves non-SQL fences (```js, ```python, etc.) intact.
//
// A fence is treated as SQL if: (a) the language tag is `sql`, OR (b) the
// first non-whitespace token inside the block is a SQL DML/DDL keyword.
const SQL_KEYWORDS =
  '(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|TRUNCATE|MERGE|BEGIN|COMMIT|ROLLBACK|EXPLAIN|SHOW|USE|GRANT|REVOKE)';
// Matches either explicit ```sql or any ``` followed (after whitespace/newlines) by a SQL keyword.
const SQL_FENCE_OPEN = new RegExp(
  `\`\`\`(?:sql\\b|[a-z]*\\s*\\n?\\s*${SQL_KEYWORDS}\\b)`,
  'i',
);
const SQL_FENCE_CLOSED = new RegExp(
  `\`\`\`(?:sql\\b|[a-z]*\\s*\\n?\\s*${SQL_KEYWORDS}\\b)[\\s\\S]*?\`\`\``,
  'gi',
);
const SQL_FENCE_UNCLOSED = new RegExp(
  `\`\`\`(?:sql\\b|[a-z]*\\s*\\n?\\s*${SQL_KEYWORDS}\\b)[\\s\\S]*$`,
  'gi',
);

export function stripSqlFencesFromReply(content: string): string {
  if (!content) return content;
  let out = content;
  // 1. Properly closed SQL fence (non-greedy so we stop at the FIRST closing
  //    fence — this also catches the "closing fence glued to prose" bug.)
  out = out.replace(SQL_FENCE_CLOSED, '');
  // 2. Unclosed fence running to the end of the reply (defensive).
  out = out.replace(SQL_FENCE_UNCLOSED, '');
  // 3. Collapse the blank-line gaps left behind by the removed blocks.
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

// Stateful counterpart for streaming. Each chunk is pushed through `push()`
// and the stripper returns only the non-SQL tail it is certain about, keeping
// a small lookahead buffer in case a fence marker straddles a chunk boundary.
// `flush()` returns any remaining safe tail at end of stream.
export function createStreamingSqlFenceStripper(): {
  push(chunk: string): string;
  flush(): string;
} {
  let buf = '';
  let inFence = false;
  // When we see a bare ``` we must buffer enough to decide whether it opens
  // a SQL block (language tag "sql" OR first keyword inside is a SQL verb).
  // ``` + optional tag + whitespace + longest SQL keyword ("ROLLBACK") easily
  // fits in 40 chars. Keep generous headroom for models that indent the body.
  const SQL_DECISION_WINDOW = 64;
  // The anchored open regex: either ```sql, or ``` followed (optionally by a
  // lowercase tag and whitespace) by an uppercase SQL keyword.
  const anchoredOpen = new RegExp(
    `^\`\`\`(?:sql\\b|[a-z]*\\s*\\n?\\s*${SQL_KEYWORDS}\\b)`,
    'i',
  );

  return {
    push(chunk: string): string {
      buf += chunk;
      let out = '';
      while (buf.length > 0) {
        if (inFence) {
          const closeIdx = buf.indexOf('```');
          if (closeIdx < 0) {
            // Keep a small tail in case "```" spans chunks, drop the rest.
            buf = buf.length > 2 ? buf.slice(-2) : buf;
            return out;
          }
          // Skip through the closing fence and any language-tag-like residue.
          buf = buf.slice(closeIdx + 3);
          inFence = false;
          continue;
        }
        // Find the next ``` (potential fence open) in the buffer.
        const tickIdx = buf.indexOf('```');
        if (tickIdx < 0) {
          // No backticks at all — emit everything except a 2-char tail in case
          // "```" straddles the next chunk.
          if (buf.length > 2) {
            out += buf.slice(0, buf.length - 2);
            buf = buf.slice(buf.length - 2);
          }
          return out;
        }
        // Emit everything BEFORE the backticks immediately.
        if (tickIdx > 0) {
          out += buf.slice(0, tickIdx);
          buf = buf.slice(tickIdx);
        }
        // Now buf starts with "```". Decide whether this opens a SQL block.
        const m = anchoredOpen.exec(buf);
        if (m) {
          // Confirmed SQL fence — swallow the opener and enter fence mode.
          buf = buf.slice(m[0].length);
          inFence = true;
          continue;
        }
        // Not (yet) a SQL fence. If we have enough characters after ``` to
        // know for sure (or a second ``` has arrived), emit the ``` as safe
        // content. Otherwise wait for more chunks.
        const hasSecondFence = buf.indexOf('```', 3) >= 0;
        if (buf.length >= SQL_DECISION_WINDOW || hasSecondFence) {
          // Emit just the first ``` and re-loop; the tail may contain more.
          out += '```';
          buf = buf.slice(3);
          continue;
        }
        // Need more data to decide. Hold buf, return what we have so far.
        return out;
      }
      return out;
    },
    flush(): string {
      if (inFence) {
        // Unclosed fence — drop everything still buffered.
        buf = '';
        return '';
      }
      // At end of stream, if the buffer still starts with ``` that we were
      // undecided about, commit to "not SQL" and emit as-is.
      const tail = buf;
      buf = '';
      return tail;
    },
  };
}

@Injectable()
export class ChatAgentService {
  private cachedLlm: ChatOpenAI | null = null;
  private cachedLlmKey = '';

  constructor(
    private readonly registry: DataSourceRegistry,
    private readonly configService: ConfigService,
  ) {}

  private getOrCreateLlm(apiKey: string): ChatOpenAI {
    const model = this.configService.getOpenAiModel();
    const cacheKey = `${apiKey}:${model}`;

    if (this.cachedLlm && this.cachedLlmKey === cacheKey) {
      return this.cachedLlm;
    }

    this.cachedLlm = new ChatOpenAI({
      apiKey,
      model,
      temperature: 0.2,
    });
    this.cachedLlmKey = cacheKey;
    return this.cachedLlm;
  }

  async generateReply(params: GenerateReplyParams): Promise<ChatReply> {
    const startedAt = Date.now();
    try {
      const reply = await this.generateReplyInternal(params);
      this.logReplySummary(reply, startedAt);
      return reply;
    } catch (error) {
      console.error('[ChatAgentService] generateReply threw', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  private logReplySummary(reply: ChatReply, startedAt: number): void {
    const metadata = reply.metadata;
    const sources = metadata.sources;
    console.info('[ChatAgentService] reply generated', {
      generator: metadata.generator,
      sourceCount: Array.isArray(sources) ? sources.length : 0,
      resultCount: metadata.resultCount,
      toolCallCount: metadata.toolCallCount,
      durationMs: Date.now() - startedAt,
    });
  }

  /**
   * Two-tier dispatcher.
   *
   *   1. no OpenAI key  → keyless fallback (raw search summary)
   *   2. agent path     → multi-retrieval tool-calling agent
   *       on error      → keyless fallback (raw search summary)
   *
   * Each tier sets `metadata.generator` to a distinct value so downstream
   * observability can distinguish the healthy agentic path from the
   * degraded fallback.
   */
  private async generateReplyInternal(
    params: GenerateReplyParams,
  ): Promise<ChatReply> {
    const apiKey = this.configService.getOpenAiApiKey();

    if (!apiKey) {
      return this.generateKeylessFallback(params);
    }

    try {
      return await this.generateAgentReply(apiKey, params);
    } catch (agentError) {
      console.error(
        '[ChatAgentService] Agent path failed, falling back to raw search',
        {
          error:
            agentError instanceof Error
              ? agentError.message
              : String(agentError),
        },
      );
      return this.generateKeylessFallback(params);
    }
  }

  /**
   * Agent path. Gives the LLM a `search_knowledge_base` tool and lets it
   * drive multiple retrievals, then synthesize a grounded answer.
   */
  async generateAgentReply(
    apiKey: string,
    params: GenerateReplyParams,
  ): Promise<ChatReply> {
    const ctx = this.buildAgentContext(params);
    try {
      const collectedSources: AirweaveSearchResultSummary[] = [];
      const searchTool = createSearchKnowledgeBaseTool({
        projectId: params.projectId,
        sources: params.sources,
        registry: this.registry,
        sourcesSink: collectedSources,
        resultLimit: this.configService.getChatAgentToolResultLimit(),
        resultCharCap: this.configService.getChatAgentToolResultCharCap(),
        searchTier: this.configService.getChatAgentSearchTier(),
        retrievalStrategy: this.configService.getChatAgentRetrievalStrategy(),
      });

      const providerTools = this.registry.getAgentToolsFor(
        params.sources,
        ctx,
      );

      const systemPrompt = this.buildAgentSystemPrompt(params);
      const maxIterations = this.configService.getChatAgentMaxIterations();

      const agent = createAgent({
        model: this.getOrCreateLlm(apiKey) as BaseChatModel,
        tools: [searchTool, ...providerTools],
        systemPrompt,
      });

      const historyWindow = this.configService.getChatAgentHistoryWindow();
      const historyMessages: BaseMessage[] = params.previousMessages
        .slice(-historyWindow)
        .map((message) =>
          message.role === 'assistant'
            ? new AIMessage(message.content)
            : new HumanMessage(message.content),
        );
      const messages: BaseMessage[] = [
        ...historyMessages,
        new HumanMessage(this.buildAgentUserMessage(params)),
      ];

      const recursionLimit = Math.max(10, maxIterations * 4);

      const result = await agent.invoke(
        { messages } as Parameters<typeof agent.invoke>[0],
        { recursionLimit },
      );

      const resultMessages = (result?.messages ?? []) as BaseMessage[];
      const rawFinalContent = this.extractFinalAssistantText(resultMessages);
      if (!rawFinalContent) {
        throw new Error('Agent produced no assistant content');
      }
      const finalContent = stripSqlFencesFromReply(rawFinalContent);

      const toolCallCount = this.countToolMessages(resultMessages);
      const maxSources = this.configService.getChatAgentMaxSources();
      const uniqueSources = dedupeAndCapSources(collectedSources, maxSources);

      const finalAiMsg = resultMessages
        .filter((m) => m._getType() === 'ai')
        .at(-1) as AIMessage | undefined;
      const usageMeta = finalAiMsg?.usage_metadata as
        | {
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
          }
        | undefined;
      const promptTokens = usageMeta?.input_tokens ?? null;
      const completionTokens = usageMeta?.output_tokens ?? null;
      const totalTokens = usageMeta?.total_tokens ?? null;

      return {
        content: finalContent,
        metadata: {
          generator: 'langchain-agent',
          sources: this.mapSources(uniqueSources),
          resultCount: uniqueSources.length,
          toolCallCount,
          ...(ctx.persistedCalls.length > 0 && {
            sqlCalls: ctx.persistedCalls,
          }),
          ...(totalTokens !== null && {
            promptTokens,
            completionTokens,
            totalTokens,
          }),
        },
      };
    } finally {
      await this.runCleanupCallbacks(ctx);
    }
  }

  private buildAgentContext(params: GenerateReplyParams): AgentToolContext {
    // Caller-provided signal takes precedence so an HTTP client disconnect
    // can cancel in-flight tools. When absent we still expose a never-aborted
    // signal so tool code can rely on the field being present.
    const signal = params.signal ?? new AbortController().signal;
    return {
      orgId: params.orgId,
      userId: params.userId,
      conversationId: params.conversationId,
      projectId: params.projectId,
      signal,
      eventSink: [] as AgentToolEvent[],
      persistedCalls: [] as AgentToolPersistedCall[],
      cleanupCallbacks: [],
    };
  }

  private async runCleanupCallbacks(ctx: AgentToolContext): Promise<void> {
    for (const cb of ctx.cleanupCallbacks) {
      try {
        await cb();
      } catch (error) {
        console.warn('[ChatAgentService] cleanup callback failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private drainSqlEvents(ctx: AgentToolContext): AgentToolEvent[] {
    if (ctx.eventSink.length === 0) return [];
    const drained = ctx.eventSink.splice(0, ctx.eventSink.length);
    return drained;
  }

  /**
   * Streaming version of generateAgentReply. Uses agent.stream() to yield
   * events in real time as the agent reasons, calls tools, and generates
   * the final answer. Falls back to generateAgentReply + fake chunking
   * if streaming fails.
   */
  async *generateReplyStreaming(
    params: GenerateReplyParams,
  ): AsyncGenerator<ChatStreamEvent> {
    const apiKey = this.configService.getOpenAiApiKey();

    if (!apiKey) {
      const fallback = await this.generateKeylessFallback(params);
      for (const chunk of this.fakeChunkContent(fallback.content)) {
        yield { type: 'chunk', content: chunk };
      }
      yield { type: 'done', reply: fallback };
      return;
    }

    const ctx = this.buildAgentContext(params);
    try {
    const collectedSources: AirweaveSearchResultSummary[] = [];
    const searchTool = createSearchKnowledgeBaseTool({
      projectId: params.projectId,
      sources: params.sources,
      registry: this.registry,
      sourcesSink: collectedSources,
      resultLimit: this.configService.getChatAgentToolResultLimit(),
      resultCharCap: this.configService.getChatAgentToolResultCharCap(),
      searchTier: this.configService.getChatAgentSearchTier(),
      retrievalStrategy: this.configService.getChatAgentRetrievalStrategy(),
    });

    const providerTools = this.registry.getAgentToolsFor(params.sources, ctx);
    const systemPrompt = this.buildAgentSystemPrompt(params);
    const maxIterations = this.configService.getChatAgentMaxIterations();

    const agent = createAgent({
      model: this.getOrCreateLlm(apiKey) as BaseChatModel,
      tools: [searchTool, ...providerTools],
      systemPrompt,
    });

    const historyWindow = this.configService.getChatAgentHistoryWindow();
    const historyMessages: BaseMessage[] = params.previousMessages
      .slice(-historyWindow)
      .map((message) =>
        message.role === 'assistant'
          ? new AIMessage(message.content)
          : new HumanMessage(message.content),
      );
    const messages: BaseMessage[] = [
      ...historyMessages,
      new HumanMessage(this.buildAgentUserMessage(params)),
    ];

    const recursionLimit = Math.max(10, maxIterations * 4);
    const startedAt = Date.now();
    let emittedThinking = false;
    let finalContent = '';
    let toolCallCount = 0;
    let streamFinalAiMsg: AIMessage | undefined;
    // Strips any ```sql ... ``` blocks token-by-token before yielding chunks
    // so the live streamed reply never shows the code-block-swallowing bug.
    // Final content is also run through the pure sanitizer below as a
    // belt-and-suspenders against token-boundary edge cases.
    const fenceStripper = createStreamingSqlFenceStripper();

    try {
      const stream = await agent.stream(
        { messages } as Parameters<typeof agent.stream>[0],
        {
          recursionLimit,
          streamMode: 'messages',
        },
      );

      for await (const rawChunk of stream) {
        // stream mode "messages" yields [message, metadata] tuples
        const [message, metadata] = rawChunk as unknown as [
          BaseMessage,
          Record<string, unknown>,
        ];

        if (!message) continue;

        const messageType = this.getMessageType(message);

        // Tool messages = search tool completed; drain any pushed sql events.
        if (messageType === 'tool') {
          toolCallCount++;
          for (const ev of this.drainSqlEvents(ctx)) {
            yield ev;
          }
          continue;
        }

        // AI messages with tool_calls = agent deciding to search
        if (messageType === 'ai' || messageType === 'assistant') {
          const aiMsg = message as AIMessage;

          // Check if this is a tool-calling step
          if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
            for (const toolCall of aiMsg.tool_calls) {
              const input = toolCall.args as { query?: string } | undefined;
              const query = input?.query ?? '';
              yield { type: 'searching', query };
            }
            continue;
          }

          // This is content generation (final synthesis)
          const text = this.stringifyMessageContent(message.content);
          if (text.length > 0) {
            if (!emittedThinking) {
              yield { type: 'thinking' };
              emittedThinking = true;
            }

            // Only yield if this is new content (langgraph can re-emit full state)
            const isLanggraphNode = metadata?.langgraph_node !== undefined;
            if (isLanggraphNode) {
              // In messages streamMode, each chunk is a delta token — accumulate.
              // Route through the SQL-fence stripper so any ```sql ... ``` block
              // is removed from both the streamed chunks and the accumulated
              // final content before it ever reaches the client or DB.
              streamFinalAiMsg = aiMsg;
              const safe = fenceStripper.push(text);
              if (safe.length > 0) {
                finalContent += safe;
                yield { type: 'chunk', content: safe };
              }
            }
          }
        }
      }

      // Flush any remaining non-SQL tail held back by the stripper.
      const trailing = fenceStripper.flush();
      if (trailing.length > 0) {
        finalContent += trailing;
        yield { type: 'chunk', content: trailing };
      }

      // Drain any residual sql events pushed after the final tool message.
      for (const ev of this.drainSqlEvents(ctx)) {
        yield ev;
      }
    } catch (streamError) {
      console.warn(
        '[ChatAgentService] Streaming failed, falling back to invoke',
        {
          error:
            streamError instanceof Error
              ? streamError.message
              : String(streamError),
        },
      );

      // Fall back to non-streaming invoke
      try {
        const fallbackReply = await this.generateAgentReply(apiKey, params);
        for (const chunk of this.fakeChunkContent(fallbackReply.content)) {
          yield { type: 'chunk', content: chunk };
        }
        yield { type: 'done', reply: fallbackReply };
        return;
      } catch (invokeError) {
        console.error('[ChatAgentService] Invoke fallback also failed', {
          error:
            invokeError instanceof Error
              ? invokeError.message
              : String(invokeError),
        });
        const keylessFallback = await this.generateKeylessFallback(params);
        for (const chunk of this.fakeChunkContent(keylessFallback.content)) {
          yield { type: 'chunk', content: chunk };
        }
        yield { type: 'done', reply: keylessFallback };
        return;
      }
    }

    const maxSources = this.configService.getChatAgentMaxSources();
    const uniqueSources = dedupeAndCapSources(collectedSources, maxSources);

    const streamUsageMeta = streamFinalAiMsg?.usage_metadata as
      | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
      | undefined;
    const streamPromptTokens = streamUsageMeta?.input_tokens ?? null;
    const streamCompletionTokens = streamUsageMeta?.output_tokens ?? null;
    const streamTotalTokens = streamUsageMeta?.total_tokens ?? null;

    const reply: ChatReply = {
      // Defensive pass: even though the streaming stripper handles chunks,
      // a whole-string regex cleanup catches any token-boundary artifacts
      // (stray backtick residue, double-blank lines).
      content: stripSqlFencesFromReply(finalContent),
      metadata: {
        generator: 'langchain-agent',
        sources: this.mapSources(uniqueSources),
        resultCount: uniqueSources.length,
        toolCallCount,
        ...(ctx.persistedCalls.length > 0 && {
          sqlCalls: ctx.persistedCalls,
        }),
        ...(streamTotalTokens !== null && {
          promptTokens: streamPromptTokens,
          completionTokens: streamCompletionTokens,
          totalTokens: streamTotalTokens,
        }),
      },
    };

    this.logReplySummary(reply, startedAt);
    yield { type: 'done', reply };
    } finally {
      await this.runCleanupCallbacks(ctx);
    }
  }

  private fakeChunkContent(content: string, chunkSize = 120): string[] {
    if (!content) return [];
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * The system prompt for the agent path. Combines the configured expert
   * persona prompt, the tool usage protocol, and per-request organization
   * context. Org context lives here (not in the human message) so the
   * retrieval tool never sees it: when the agent copies the user's question
   * verbatim into search_knowledge_base, the embedded query is the clean
   * natural-language question rather than `Organization: foo\n\nQuestion: ...`,
   * which dense retrieval models match much better.
   */
  buildAgentSystemPrompt(params: GenerateReplyParams): string {
    const hasDatabaseSource = params.sources.some(
      (source) => source.kind === 'database',
    );

    const sections: string[] = [
      this.configService.getChatSystemPrompt(),
      AGENT_TOOL_USAGE_PROTOCOL,
    ];
    if (hasDatabaseSource) {
      sections.push(AGENT_DATABASE_ROUTING_PROTOCOL);
    }
    sections.push(
      `## Context\n\nYou are answering questions for the organization: ${params.organizationName}, scoped to the project: ${params.projectName}. Every question is implicitly scoped to that project's configured data sources.`,
    );

    return sections.join('\n\n');
  }

  /**
   * The human message handed to the agent. Returns the raw user question
   * with no prefix or wrapper, because the agent is instructed to copy this
   * verbatim into its first `search_knowledge_base` call. Any structural
   * noise here (e.g. "Organization: ..." prefix) gets embedded into the
   * retrieval query and degrades semantic match quality.
   */
  buildAgentUserMessage(params: GenerateReplyParams): string {
    return params.question;
  }

  private extractFinalAssistantText(messages: BaseMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message) continue;
      if (!this.isAssistantMessage(message)) continue;

      const text = this.stringifyMessageContent(message.content);
      if (text.trim().length > 0) {
        return text.trim();
      }
    }
    return '';
  }

  private getMessageType(message: BaseMessage): string | null {
    const typed = message as unknown as { _getType?: () => string };
    if (typeof typed._getType !== 'function') {
      return null;
    }
    const type: string = typed._getType();
    return type;
  }

  private isAssistantMessage(message: BaseMessage): boolean {
    const type = this.getMessageType(message);
    return type === 'ai' || type === 'assistant';
  }

  private countToolMessages(messages: BaseMessage[]): number {
    return messages.filter((message) => this.getMessageType(message) === 'tool')
      .length;
  }

  private stringifyMessageContent(
    content: BaseMessage['content'] | unknown,
  ): string {
    if (typeof content === 'string') {
      return content;
    }
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
        .filter((text) => text.length > 0)
        .join('\n');
    }
    return '';
  }

  /**
   * Keyless fallback path. Retrieves once, emits raw search summary if
   * results exist, or an explicit no-results message if not.
   */
  private async generateKeylessFallback(
    params: GenerateReplyParams,
  ): Promise<ChatReply> {
    if (params.sources.length === 0) {
      return {
        content: [
          '## Answer',
          '',
          `This project has no configured data sources, so I cannot retrieve grounded material for "${params.question}".`,
          '',
          '### Suggested Next Step',
          '',
          '- Add at least one data source to the project, then retry your question.',
        ].join('\n'),
        metadata: {
          generator: 'fallback-no-sources',
          sources: [],
          resultCount: 0,
        },
      };
    }

    const searches = await Promise.allSettled(
      params.sources.map((source) =>
        this.registry.get(source.kind).search(source, params.question, {
          tier: 'classic',
          limit: 5,
          offset: 0,
        }),
      ),
    );

    const results: AirweaveSearchResultSummary[] = [];
    searches.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        results.push(...outcome.value.results);
      } else {
        console.warn('[ChatAgentService] fallback source search failed', {
          sourceId: params.sources[index]?.id,
          kind: params.sources[index]?.kind,
          error:
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason),
        });
      }
    });

    if (results.length === 0) {
      return {
        content: [
          '## Answer',
          '',
          `I could not find relevant indexed material for this question in project ${params.projectName} yet.`,
          '',
          '### Suggested Next Step',
          '',
          '- Try a more specific query, or configure additional indexed sources for this project.',
        ].join('\n'),
        metadata: {
          generator: 'fallback-no-results',
          sources: [],
          resultCount: 0,
        },
      };
    }

    const topResults = results.slice(0, 3);
    const findings = topResults.map((result) => {
      const excerpt = result.text.replace(/\s+/g, ' ').trim();
      const clippedExcerpt =
        excerpt.length > 180 ? `${excerpt.slice(0, 177)}...` : excerpt;
      return `- ${clippedExcerpt}`;
    });

    const sources = topResults.map((result) => {
      return `- [${result.name}](${result.webUrl}) · ${result.sourceName}`;
    });

    return {
      content: [
        '## Answer',
        '',
        `Here are the most relevant indexed findings for: ${params.question}`,
        '',
        '### Key Findings',
        ...findings,
        '',
        '### Sources',
        ...sources,
      ].join('\n'),
      metadata: {
        generator: 'fallback-search-summary',
        sources: this.mapSources(results),
        resultCount: results.length,
      },
    };
  }

  private mapSources(results: AirweaveSearchResultSummary[]) {
    return results.slice(0, 10).map((result) => ({
      name: result.name,
      webUrl: result.webUrl,
      sourceName: result.sourceName,
      entityType: result.entityType,
    }));
  }
}
