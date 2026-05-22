import { Injectable, Optional } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createAgent } from 'langchain';
import { ConfigService } from '../../../../shared/config';
import type { AirweaveSearchResultSummary } from '../../../airweave/application/services/airweave.service';
// Phase 4-lite: imports from the projects MODULE BARREL (projects/index.ts)
// instead of deep paths into projects/application/providers/...
// Fixes the chat → projects directional smell (proposal §3.4's goal) without
// requiring a full file move. The barrel is the public surface; deep imports
// were a coupling smell. See Phase 4-lite commit message for the deviation
// from the proposal's literal "move to data-sources/" plan.
import type {
  AgentToolContext,
  AgentToolEvent,
  AgentToolPersistedCall,
  ProjectDataSource,
} from '../../../projects';
import { DataSourceRegistry } from '../../../projects';
import {
  createSearchKnowledgeBaseTool,
  dedupeAndCapSources,
} from './chat-agent-tools';
import { ChatRouterService } from './chat-router.service';

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
  // Phase 3b (R / §3.6): fire BEFORE sql_executed during SQL turns. Both
  // are additive — older SPA consumers ignore unknown event types
  // (verified during P0.5 spa-velocity audit at chatService.ts:88-115).
  | {
      type: 'sql_planning';
      connectionId: string;
      connectionName: string;
    }
  | {
      type: 'sql_executing';
      connectionId: string;
      connectionName: string;
      sql: string;
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

// Phase 3b (R / SSoT): the routing TAXONOMY (which buckets exist, what
// counts as SQL vs RAG vs Ambiguous) now lives in
// `src/modules/chat/prompts/chat-routing-rules.md` as the single source
// of truth (consumed by BOTH ChatRouterService and the agent prompt
// builder below — see `buildAgentRoutingProtocol`). The agent-specific
// tool-use directives that the previous inline constant carried
// (verbatim-question, cite-numbers, follow-up-on-empty, fences-in-tool-
// description) are now composed around the loaded taxonomy at runtime.
//
// Why the rules file and not the constant: with the router on (P3b
// dispatcher) the classifier needs the same bucket definitions, written
// as taxonomy not as tool-use prose. One file, two consumers, one set
// of bucket definitions — SSoT.
//
// The "Answer format after query_database" guidance (prose only, no SQL
// fences, no meta-commentary) lives in
// `src/modules/chat/prompts/query-database-tool-description.md`. The LLM
// sees that text every time it considers calling the tool. The
// streaming-fence sanitizer in this file is the belt; the tool-
// description rule is the suspenders.

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
// first non-whitespace token inside the block is one of the UNAMBIGUOUS
// SQL DML/DDL keywords below. Ambiguous keywords (BEGIN, COMMIT, ROLLBACK)
// overlap with Pascal / Plpgsql / Ada code-block bodies, so we require
// them to be followed by SQL-shaped syntax to count as SQL (M3 tighten).
//
// Specifically:
//   - `BEGIN` matches only when followed by TRANSACTION|WORK|`;` (the
//     SQL-shape) — `\`\`\`pascal\nBEGIN someVar := 1` no longer false-
//     positives.
//   - `COMMIT`/`ROLLBACK` likewise allow optional TRANSACTION|WORK|`;`.
//   - SELECT / INSERT / UPDATE / DELETE / WITH / CREATE / ALTER / DROP /
//     TRUNCATE / MERGE / EXPLAIN / SHOW / USE / GRANT / REVOKE are
//     considered uniquely SQL; matching is unconditional.
const SQL_UNAMBIGUOUS =
  '(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|TRUNCATE|MERGE|EXPLAIN|SHOW|USE|GRANT|REVOKE)';
const SQL_AMBIGUOUS_WITH_SHAPE =
  '(?:BEGIN|COMMIT|ROLLBACK)\\b\\s*(?:TRANSACTION|WORK|;)';
const SQL_KEYWORDS = `(?:${SQL_UNAMBIGUOUS}|${SQL_AMBIGUOUS_WITH_SHAPE})`;
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

// Models sometimes paste ```json ... ``` with the tool's row payload even though
// the client already renders SQL + structured results. Strip json-tagged fences
// only on replies that followed a DB query (see callers), analogous to SQL fences.
const JSON_FENCE_CLOSED = /\`\`\`json\b[\s\S]*?\`\`\`/gi;
const JSON_FENCE_UNCLOSED = /\`\`\`json\b[\s\S]*$/i;

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

export function stripJsonFencesFromReply(content: string): string {
  if (!content) return content;
  let out = content.replace(JSON_FENCE_CLOSED, '');
  out = out.replace(JSON_FENCE_UNCLOSED, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

// LLMs occasionally emit a markdown table immediately after prose without
// the blank-line separator GitHub-flavored-markdown requires for the table
// to render as a table. The result on the SPA is the table syntax getting
// absorbed into the preceding paragraph as inline text — e.g.
//
//   "...45 questions.| User | Email |"   (no \n at all)
//   "...45 questions.\n| User | Email |" (single \n, also not enough)
//
// Both should render as a table; the second one is what the markdown spec
// SHOULD recognize but most renderers (including remark/rehype with their
// default settings) require a true paragraph break (\n\n) before a table
// header to treat it as a fresh block.
//
// Prompt-tuning this is unreliable — the model emits these patterns at
// random token boundaries regardless of how loud the system prompt is.
// The mechanical guarantee is to insert the missing blank line as a
// post-processing pass on the assembled content.
//
// Implementation: line-based, NOT regex-only. An earlier regex-only
// version over-matched the header-separator → data-row boundary in real
// tables (e.g. `:|---|` would match as "prose char `:` then table line")
// and inserted blank lines INSIDE tables, breaking them apart.
//
// Two passes:
//   1. PRE-SPLIT mixed lines: any line containing "prose-text then
//      table-syntax" (e.g. "foo.| User |") splits at the boundary
//      into ["foo.", "| User |"].
//   2. LINE WALK: ensure a blank line precedes any table line that
//      follows a non-table, non-empty line. Consecutive table lines
//      (header → separator → rows) are left glued together.
//
// Heuristic for "table line": trimmed line starts with `|` AND has at
// least TWO pipes total. Avoids over-matching ordinary prose like
// "Hello | World" (only one pipe).

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return false;
  return (trimmed.match(/\|/g)?.length ?? 0) >= 2;
}

// "foo.| User | Email |" → ["foo.", "| User | Email |"]
// "| header | only |"   → ["| header | only |"]  (unchanged)
// "no table here"       → ["no table here"]      (unchanged)
function splitLineAtTableStart(line: string): string[] {
  // Match: non-pipe prose ($1) followed by a pipe segment containing
  // at least two pipes ($2). Anchored to the start so we only split
  // at the FIRST prose→table boundary in the line.
  const m = line.match(/^([^|]+?)(\|[^\n]*\|)$/);
  if (!m) return [line];
  if ((m[2].match(/\|/g)?.length ?? 0) < 2) return [line];
  if (m[1].trim() === '') return [line];
  return [m[1], m[2]];
}

export function normalizeMarkdownTables(content: string): string {
  if (!content) return content;
  // Pass 1: split prose-then-table lines.
  const split = content.split('\n').flatMap(splitLineAtTableStart);
  // Pass 2: insert blank lines before new table blocks.
  const out: string[] = [];
  for (const line of split) {
    if (isTableLine(line)) {
      const prev = out[out.length - 1];
      if (prev !== undefined && prev !== '' && !isTableLine(prev)) {
        out.push('');
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

function sanitizeDbAssistantReplyText(
  raw: string,
  hadPersistedSqlCalls: boolean,
): string {
  let out = stripSqlFencesFromReply(raw);
  if (hadPersistedSqlCalls) {
    out = stripJsonFencesFromReply(out);
  }
  // Table normalization runs LAST so it operates on the final, fence-
  // stripped content. Always runs (not gated on hadPersistedSqlCalls) —
  // models sometimes emit tables in non-DB responses too (e.g.
  // search_knowledge_base summaries that list results in a table).
  out = normalizeMarkdownTables(out);
  return out;
}

function createStreamingDbReplyFenceStripper(ctx: {
  persistedCalls: unknown[];
}): {
  push(chunk: string): string;
  flush(): string;
} {
  return createStreamingSqlFenceStripper({
    stripJsonWhen: () => ctx.persistedCalls.length > 0,
  });
}

export type StreamingSqlFenceStripperOptions = {
  /**
   * When true, ```json … ``` fences are stripped like ```sql — evaluated on
   * every chunk so JSON opens after `persistedCalls` fills mid-stream still work.
   * Must be integrated into this stripper (not chained afterward): the SQL
   * branch otherwise emits lone "```" while disambiguating, which flashes raw
   * fences to the client token-by-token.
   */
  stripJsonWhen?: () => boolean;
};

// Stateful counterpart for streaming. Each chunk is pushed through `push()`
// and the stripper returns only the non-SQL tail it is certain about, keeping
// a small lookahead buffer in case a fence marker straddles a chunk boundary.
// `flush()` returns any remaining safe tail at end of stream.
export function createStreamingSqlFenceStripper(
  options?: StreamingSqlFenceStripperOptions,
): {
  push(chunk: string): string;
  flush(): string;
} {
  const stripJsonWhen = options?.stripJsonWhen;
  const jsonOpen = /^\`\`\`json\b/i;
  let buf = '';
  let inSqlFence = false;
  let inJsonFence = false;
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
        if (inJsonFence) {
          const closeIdx = buf.indexOf('```');
          if (closeIdx < 0) {
            buf = buf.length > 2 ? buf.slice(-2) : buf;
            return out;
          }
          buf = buf.slice(closeIdx + 3);
          inJsonFence = false;
          continue;
        }
        if (inSqlFence) {
          const closeIdx = buf.indexOf('```');
          if (closeIdx < 0) {
            // Keep a small tail in case "```" spans chunks, drop the rest.
            buf = buf.length > 2 ? buf.slice(-2) : buf;
            return out;
          }
          // Skip through the closing fence and any language-tag-like residue.
          buf = buf.slice(closeIdx + 3);
          inSqlFence = false;
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
          inSqlFence = true;
          continue;
        }
        // Tool-result JSON dumps: classify BEFORE emitting a lone "```", which
        // would leak through SSE chunk-by-chunk while the model streams ```json.
        if (stripJsonWhen?.()) {
          const jm = jsonOpen.exec(buf);
          if (jm) {
            buf = buf.slice(jm[0].length);
            inJsonFence = true;
            continue;
          }
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
      if (inSqlFence || inJsonFence) {
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
    // Phase 3b (R): optional injection so existing specs that wire only
    // (registry, configService) keep working. The dispatcher in
    // `dispatchRoute` is the single place that uses it; when missing
    // AND the router flag is on, the dispatcher logs a warning and
    // falls through to the agent path (fail-safe rather than fail-loud
    // because the consequence is "router optimization not applied", not
    // a correctness bug).
    @Optional()
    private readonly chatRouter?: ChatRouterService,
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

  private logReplySummary(
    reply: ChatReply,
    startedAt: number,
    // P3b telemetry fix (Copilot C1): without the explicit `route` arg the
    // router-sql / router-rag paths were tagged route='agent' in the
    // chat.turn event — making the router-win measurement (proposal §3.5)
    // unobservable. Default kept for the agent path so existing callers
    // are unaffected.
    route: 'agent' | 'sql' | 'rag' = 'agent',
  ): void {
    const metadata = reply.metadata;
    const sources = metadata.sources;
    console.info('[ChatAgentService] reply generated', {
      generator: metadata.generator,
      sourceCount: Array.isArray(sources) ? sources.length : 0,
      resultCount: metadata.resultCount,
      toolCallCount: metadata.toolCallCount,
      durationMs: Date.now() - startedAt,
    });
    this.recordTurnMetrics(reply, startedAt, route);
  }

  /**
   * Canonical per-turn telemetry event (per docs/langchain-agent-refactor-proposal.md
   * §3.5). Emitted alongside `logReplySummary` so dashboards can parse a stable
   * shape without depending on the informal operational log above.
   *
   * IMPORTANT (per proposal §3.5 + ISP discipline):
   *   `route` is a LOCAL variable, NOT a field on `AgentToolContext`. The ctx
   *   shape is unchanged by this refactor — see proposal §11 verification log.
   *   For P0 every turn is `'agent'`. P3 (router) will pass the dispatcher's
   *   chosen route at the call site.
   *
   * `llmCalls` is approximated as `toolCallCount + 1` (each tool call implies
   * an outer-agent LLM round-trip; +1 for final synthesis). Sub-agent internal
   * LLM calls are NOT counted here — that requires the progress callback added
   * in P3b. See docs/refactor-baseline-metrics.md for the gap analysis and
   * how P1/P2 wins surface (or don't) in this single metric.
   *
   * `tokensTotal` is the outer agent's final-message `usage_metadata.total_tokens`
   * when available; null otherwise. Same scope caveat as `llmCalls`.
   */
  private recordTurnMetrics(
    reply: ChatReply,
    startedAt: number,
    route: 'agent' | 'sql' | 'rag' = 'agent',
  ): void {
    const metadata = reply.metadata;
    const toolCallCount =
      typeof metadata.toolCallCount === 'number' ? metadata.toolCallCount : 0;
    const tokensTotal =
      typeof metadata.totalTokens === 'number' ? metadata.totalTokens : null;
    console.info('[ChatAgentService] chat.turn', {
      event: 'chat.turn',
      route,
      llmCalls: toolCallCount + 1,
      durationMs: Date.now() - startedAt,
      tokensTotal,
      generator: metadata.generator,
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

      // H2: tightened cap. Was max(10, maxIterations * 4) — let a confused
      // outer agent burn ~32 graph transitions on a typical config. Halved
      // to max(8, maxIterations * 2). The outer agent's job is one or two
      // tool calls plus a synthesis, so 16 transitions is plenty headroom.
      const recursionLimit = Math.max(8, maxIterations * 2);

      const result = await agent.invoke(
        { messages } as Parameters<typeof agent.invoke>[0],
        { recursionLimit },
      );

      const resultMessages = (result?.messages ?? []) as BaseMessage[];
      const rawFinalContent = this.extractFinalAssistantText(resultMessages);
      if (!rawFinalContent) {
        throw new Error('Agent produced no assistant content');
      }
      const finalContent = sanitizeDbAssistantReplyText(
        rawFinalContent,
        ctx.persistedCalls.length > 0,
      );

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

  /**
   * Phase 3b (R) — chooses how this chat turn is executed.
   *
   * Returns `{ kind: 'agent' }` (the legacy agent path) when:
   *   - CHAT_ROUTER_ENABLED is false (default), OR
   *   - ChatRouterService is not wired (e.g. older test fixtures), OR
   *   - the classifier returned route='agent' (genuinely ambiguous), OR
   *   - the classifier returned route='sql'|'rag' but with confidence
   *     below CHAT_ROUTER_CONFIDENCE_PCT, OR
   *   - the classifier threw / returned malformed output (its own safe
   *     fallback maps that to route='agent' with confidence=0).
   *
   * Returns `{ kind: 'sql', decision }` or `{ kind: 'rag', decision }`
   * when the classifier was confident. The streaming entry point then
   * dispatches to `runSqlRoute` / `runRagRoute` which bypass createAgent
   * for the LLM-call reduction.
   *
   * Fail-fast: no retry on classifier failure. The agent path is the
   * safety net for everything below the confidence threshold; double-
   * classifying wastes tokens.
   */
  private async dispatchRoute(
    params: GenerateReplyParams,
    apiKey: string,
  ): Promise<
    | { kind: 'agent' }
    | { kind: 'sql' | 'rag'; decision: import('./chat-router.service').RouterDecision }
  > {
    if (!this.configService.getChatRouterEnabled()) {
      return { kind: 'agent' };
    }
    if (!this.chatRouter) {
      console.warn(
        '[ChatAgentService] CHAT_ROUTER_ENABLED is true but ChatRouterService is not injected; falling through to agent path',
      );
      return { kind: 'agent' };
    }
    const decision = await this.chatRouter.classify({
      question: params.question,
      apiKey,
      sources: params.sources,
    });
    const threshold = this.configService.getChatRouterConfidenceThreshold();
    if (decision.route === 'agent' || decision.confidence < threshold) {
      return { kind: 'agent' };
    }
    return { kind: decision.route, decision };
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
   * Phase 3b (R) — direct route execution for SQL turns. Bypasses
   * `createAgent` (no agent graph, no tool-decision LLM call). Saves
   * ~1 outer-agent LLM call per turn vs the legacy agent path.
   *
   * Sequence:
   *   1. Build ctx, find `query_database` provider tool.
   *   2. Yield `searching` to signal the SPA we're querying.
   *   3. Invoke the tool directly. This populates ctx.eventSink with
   *      `sql_executed` and ctx.persistedCalls with the audit entry,
   *      same side effects as the agent path. Phase 3b's sql_planning /
   *      sql_executing callback events (proposal §3.6) fire from inside
   *      runSqlSubAgent and bubble through ctx.eventSink — drained
   *      below before synthesis chunks start.
   *   4. Drain ctx.eventSink → yield every event in order.
   *   5. Synthesize the answer via llm.stream() — yield chunks.
   *   6. Yield `done` with metadata (generator='router-sql').
   *
   * On tool error: yield a `done` event with an error-shape reply
   * (generator='router-sql-error'). No retry; the agent path is not
   * a fallback here because the router has already committed to SQL —
   * a tool failure is the user's signal that the query path is broken.
   */
  private async *runSqlRoute(
    params: GenerateReplyParams,
    apiKey: string,
    decision: import('./chat-router.service').RouterDecision,
  ): AsyncGenerator<ChatStreamEvent> {
    // Capture turn start at function entry (Copilot C3 / C5 fix). Without
    // this `logReplySummary` ran with Date.now() as startedAt → durationMs
    // always near-zero on router turns, defeating the §3.5 router-win
    // measurement.
    const startedAt = Date.now();
    const ctx = this.buildAgentContext(params);
    try {
      const providerTools = this.registry.getAgentToolsFor(params.sources, ctx);
      const queryDbTool = providerTools.find((t) => t.name === 'query_database');
      if (!queryDbTool) {
        // Router said SQL but no query_database tool was contributed.
        // Possible if sources changed between router classification and
        // execution. Fall back to a plain error reply rather than
        // pretending the route is valid.
        yield {
          type: 'done',
          reply: {
            content:
              'The router selected a SQL route but no database tool is available for this project.',
            metadata: { generator: 'router-sql-error' },
          },
        };
        return;
      }
      yield { type: 'searching', query: params.question };
      try {
        await queryDbTool.invoke({
          question: params.question,
          source_id: decision.sourceId,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        yield {
          type: 'done',
          reply: {
            content: `Sorry — the database query failed: ${msg}`,
            metadata: {
              generator: 'router-sql-error',
              ...(ctx.persistedCalls.length > 0 && {
                sqlCalls: ctx.persistedCalls,
              }),
            },
          },
        };
        return;
      }
      // Drain sql_planning / sql_executing / sql_executed events the tool
      // pushed (sub-agent fires sql_planning + sql_executing via the
      // onSqlProgress callback wired in Phase 3b §3.6).
      for (const ev of this.drainSqlEvents(ctx)) {
        yield ev;
      }
      // Synthesize the prose answer. Build a minimal synthesis prompt
      // around the recorded persistedCalls so the LLM has the SQL +
      // outcome without us re-running the query.
      const synthSystemPrompt = this.buildAgentSystemPrompt(params);
      const llm = this.getOrCreateLlm(apiKey);
      const synthUserMessage = this.buildRouterSqlSynthesisUserMessage(
        params,
        ctx,
      );
      yield { type: 'thinking' };
      let finalContent = '';
      const fenceStripper = createStreamingDbReplyFenceStripper(ctx);
      try {
        // Copilot C2 fix: use SystemMessage + HumanMessage rather than
        // concatenating both into a single HumanMessage. The agent path
        // (createAgent.systemPrompt) materializes the system prompt as a
        // proper system-role message; router-sql synthesis must match
        // that shape or instruction adherence and prompt-cache eligibility
        // diverge between the two paths.
        const stream = await llm.stream([
          new SystemMessage(synthSystemPrompt),
          new HumanMessage(synthUserMessage),
        ]);
        for await (const chunk of stream) {
          const text = this.stringifyMessageContent(chunk.content);
          if (text.length === 0) continue;
          const safe = fenceStripper.push(text);
          if (safe.length === 0) continue;
          finalContent += safe;
          yield { type: 'chunk', content: safe };
        }
        const trailing = fenceStripper.flush();
        if (trailing.length > 0) {
          finalContent += trailing;
          yield { type: 'chunk', content: trailing };
        }
      } catch (error) {
        console.error('[ChatAgentService] router-sql synthesis failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Surface a degraded reply rather than crashing the stream.
        const degraded = ctx.persistedCalls
          .map(
            (call) =>
              `Ran SQL on ${call.connectionName}: ${call.rowCount} row(s).`,
          )
          .join('\n');
        finalContent = degraded || 'The database query ran but synthesis failed.';
        yield { type: 'chunk', content: finalContent };
      }
      // Router-path metadata for telemetry parity with agent path (Copilot
      // C1 + architect M1). recordTurnMetrics reads `toolCallCount` and
      // `totalTokens` from metadata; without them every router turn would
      // log llmCalls=1, tokensTotal=null even when the sub-agent consumed
      // many calls / tokens. We approximate: 1 outer LLM call (synthesis
      // below) + 1 logical "tool call" (the query_database invocation,
      // which itself wraps an entire sub-agent run — sub-agent internal
      // calls are NOT visible here, same limitation as the agent path).
      // For tokens, surface the synthesis call's usage when available;
      // sub-agent token usage requires a separate accounting pass.
      const reply: ChatReply = {
        content: sanitizeDbAssistantReplyText(
          finalContent,
          ctx.persistedCalls.length > 0,
        ),
        metadata: {
          generator: 'router-sql',
          routerConfidence: decision.confidence,
          toolCallCount: 1,
          ...(ctx.persistedCalls.length > 0 && {
            sqlCalls: ctx.persistedCalls,
          }),
        },
      };
      this.logReplySummary(reply, startedAt, 'sql');
      yield { type: 'done', reply };
    } finally {
      await this.runCleanupCallbacks(ctx);
    }
  }

  /**
   * Phase 3b (R) — direct route execution for RAG turns. Bypasses
   * `createAgent`. Same pattern as `runSqlRoute` but invokes the search
   * tool directly and yields `searching` once for the single retrieval.
   *
   * Saves ~1 LLM call vs the agent path (no tool-decision step).
   */
  private async *runRagRoute(
    params: GenerateReplyParams,
    apiKey: string,
    decision: import('./chat-router.service').RouterDecision,
  ): AsyncGenerator<ChatStreamEvent> {
    // Capture turn start at function entry — see runSqlRoute for rationale.
    const startedAt = Date.now();
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
      yield { type: 'searching', query: params.question };
      let searchResult: string;
      try {
        const raw = await searchTool.invoke({ query: params.question });
        searchResult = typeof raw === 'string' ? raw : JSON.stringify(raw);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        yield {
          type: 'done',
          reply: {
            content: `Sorry — the knowledge base search failed: ${msg}`,
            metadata: { generator: 'router-rag-error' },
          },
        };
        return;
      }
      const maxSources = this.configService.getChatAgentMaxSources();
      const uniqueSources = dedupeAndCapSources(collectedSources, maxSources);
      const synthSystemPrompt = this.buildAgentSystemPrompt(params);
      const llm = this.getOrCreateLlm(apiKey);
      const synthUserMessage = this.buildRouterRagSynthesisUserMessage(
        params,
        searchResult,
      );
      yield { type: 'thinking' };
      let finalContent = '';
      try {
        // Copilot C4 fix: SystemMessage + HumanMessage — see runSqlRoute
        // synthesis above for the rationale (agent-path parity).
        const stream = await llm.stream([
          new SystemMessage(synthSystemPrompt),
          new HumanMessage(synthUserMessage),
        ]);
        for await (const chunk of stream) {
          const text = this.stringifyMessageContent(chunk.content);
          if (text.length === 0) continue;
          finalContent += text;
          yield { type: 'chunk', content: text };
        }
      } catch (error) {
        console.error('[ChatAgentService] router-rag synthesis failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        finalContent =
          uniqueSources.length > 0
            ? `Found ${uniqueSources.length} relevant source(s) but synthesis failed.`
            : 'No relevant sources were found and synthesis failed.';
        yield { type: 'chunk', content: finalContent };
      }
      // Router-path metadata for telemetry parity — see runSqlRoute.
      const reply: ChatReply = {
        content: finalContent,
        metadata: {
          generator: 'router-rag',
          routerConfidence: decision.confidence,
          toolCallCount: 1,
          sources: this.mapSources(uniqueSources),
          resultCount: uniqueSources.length,
        },
      };
      this.logReplySummary(reply, startedAt, 'rag');
      yield { type: 'done', reply };
    } finally {
      await this.runCleanupCallbacks(ctx);
    }
  }

  private buildRouterSqlSynthesisUserMessage(
    params: GenerateReplyParams,
    ctx: AgentToolContext,
  ): string {
    const callsSummary = ctx.persistedCalls
      .map(
        (call) =>
          `- Connection: ${call.connectionName} (id=${call.connectionId})\n  SQL: ${call.sql}\n  Rows: ${call.rowCount}${call.truncated ? ' (truncated)' : ''}`,
      )
      .join('\n');
    return [
      `User question: ${params.question}`,
      '',
      'Database query was executed. Results:',
      callsSummary,
      '',
      'The full result rows are also available via the executed SQL (the SPA renders them in a structured panel). Provide a concise prose answer to the user that cites the numbers from the results. Do NOT restate the SQL; do NOT include code fences.',
    ].join('\n');
  }

  private buildRouterRagSynthesisUserMessage(
    params: GenerateReplyParams,
    searchResult: string,
  ): string {
    return [
      `User question: ${params.question}`,
      '',
      'Knowledge base search results:',
      searchResult,
      '',
      'Synthesize a concise expert answer grounded only in the search results above. If the results are insufficient, say so plainly.',
    ].join('\n');
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

    // Phase 3b (R): dispatcher branch. When the router is off or
    // unconfident, this returns { kind: 'agent' } and the existing
    // streaming flow below runs unchanged (zero-risk for the default
    // path). When the router classifies confidently, dispatch to the
    // direct-route handler which bypasses createAgent and saves one
    // outer-agent LLM call.
    const dispatch = await this.dispatchRoute(params, apiKey);
    if (dispatch.kind === 'sql') {
      yield* this.runSqlRoute(params, apiKey, dispatch.decision);
      return;
    }
    if (dispatch.kind === 'rag') {
      yield* this.runRagRoute(params, apiKey, dispatch.decision);
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
    const fenceStripper = createStreamingDbReplyFenceStripper(ctx);

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
      content: sanitizeDbAssistantReplyText(
        finalContent,
        ctx.persistedCalls.length > 0,
      ),
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
      // H2: structural capabilities chip — concrete tool menu with attached
      // DB names enumerated, so the LLM routes off a named menu rather than
      // pure intent classification under a prose-rules conflict. Goes BEFORE
      // the routing protocol so the model has the chip in mind when reading
      // the rules. Only emitted when a DB source is attached so the
      // zero-DB-project prompt remains byte-identical to the pre-H2 version.
      sections.push(this.buildCapabilitiesChip(params));
      // Phase 3b (R / SSoT): replaces the inline AGENT_DATABASE_ROUTING_PROTOCOL
      // constant. Loads the SSoT taxonomy from chat-routing-rules.md and
      // wraps it with the agent-specific tool-use directives.
      sections.push(this.buildAgentRoutingProtocol());
    }
    sections.push(
      `## Context\n\nYou are answering questions for the organization: ${params.organizationName}, scoped to the project: ${params.projectName}. Every question is implicitly scoped to that project's configured data sources.`,
    );

    return sections.join('\n\n');
  }

  /**
   * H2: structural capability menu. Generates a one-liner per capability
   * with concrete data (DB names) so the LLM has a named menu to route
   * off, not just prose rules.
   */
  private buildCapabilitiesChip(params: GenerateReplyParams): string {
    const dbSources = params.sources.filter(
      (s): s is Extract<typeof s, { kind: 'database' }> =>
        s.kind === 'database',
    );
    const dbNames = dbSources
      .map((s) => s.config?.connectionName || s.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    const dbList = dbNames.length > 0 ? dbNames.join(', ') : '(unnamed)';
    return [
      '## Available capabilities',
      '',
      'You have these tools at your disposal for this conversation:',
      '',
      '- `search_knowledge_base` — semantic search over the project\'s indexed documents and code (Airweave-backed).',
      `- \`query_database\` — natural-language read-only queries against the attached SQL database(s): ${dbList}.`,
      '',
      'Use the tool that fits the *shape of the answer* the user wants. The rules below detail when each applies; this menu is the concrete list of what you can call.',
    ].join('\n');
  }

  /**
   * Phase 3b (R / SSoT) — agent-specific wrapper around the
   * classifier-neutral routing taxonomy loaded from
   * `chat-routing-rules.md`. Combines:
   *
   *   1. A short heading framing the bucket choice as a tool-call decision.
   *   2. The taxonomy verbatim (SSoT — same text loaded by
   *      ChatRouterService for the classifier prompt; drift is
   *      asserted-against in chat-agent.dispatch.spec.ts).
   *   3. Agent-only tool-use directives that translate each bucket into
   *      a concrete tool call. These rules used to live inside the
   *      AGENT_DATABASE_ROUTING_PROTOCOL constant in this file — moving
   *      them here keeps them next to the wrapper that uses them
   *      without polluting the rules file (which has to stay
   *      consumer-neutral so the router can use it too).
   *
   * If any tool-use rule from the original constant is dropped during a
   * future edit, the SSoT spec (chat-agent.dispatch.spec.ts) catches the
   * regression because it enumerates each behavioral assertion as a
   * fixture.
   */
  private buildAgentRoutingProtocol(): string {
    const rules = this.configService.getChatRoutingRules();
    return [
      '## When the project has an attached database',
      '',
      'You have a `query_database` tool in addition to `search_knowledge_base`. Route each question per the taxonomy below.',
      '',
      rules,
      '',
      '## Tool-use directives (agent-specific)',
      '',
      '- For **SQL bucket** questions, call `query_database` FIRST (before `search_knowledge_base`). Pass the user\'s question verbatim as the `question` argument — the inner sub-agent will inspect the schema and write the SQL. Do not pre-translate to SQL yourself; do not ask the user for clarification before trying.',
      '- For **RAG bucket** questions, call `search_knowledge_base`.',
      '- For the **Ambiguous bucket**, try `query_database` first; if results are empty, follow up with `search_knowledge_base` for a complementary view.',
      '',
      'When you call `query_database`, cite the numbers you got back; never reshape them. When results are empty or the tool returns an error, say so plainly and consider falling back to `search_knowledge_base` for a complementary view.',
    ].join('\n');
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
        // Defensive: a provider returning undefined or an object without
        // `.results` shouldn't crash the whole fallback path — treat it as
        // an empty result set and continue.
        results.push(...(outcome.value?.results ?? []));
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
