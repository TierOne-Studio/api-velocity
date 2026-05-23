import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ConfigService } from '../../../../shared/config';
import type { ProjectDataSource } from '../../../projects/api/dto/project.dto';

/**
 * Fast routing classifier.
 *
 * Decides whether a chat turn is best handled by:
 *   - `sql`   — call `query_database` directly (skip the outer-agent's tool-decision step).
 *   - `rag`   — call `search_knowledge_base` directly.
 *   - `agent` — fall through to the agentic loop (safety net for hard cases).
 *
 * The dispatcher in `ChatAgentService` consumes this when
 * `CHAT_ROUTER_ENABLED=true`. Otherwise the classifier is never invoked.
 *
 * Fail-fast invariants:
 *   - LLM error → safe fallback `{route: 'agent', confidence: 0, reasoning: 'classifier_error'}`.
 *     No retry. The agent fallback is the safety net; double-classifying wastes tokens.
 *   - JSON parse failure → safe fallback (same shape).
 *   - Schema-shape mismatch (missing `route` field, invalid value) → safe fallback.
 *
 * Model selection follows the env-fallback chain
 * `getChatRouterModel() ?? getOpenAiModel()`.
 */

export type RouterRouteName = 'sql' | 'rag' | 'agent';

export type RouterDecision = {
  route: RouterRouteName;
  /** 0.0..1.0. Caller compares against `getChatRouterConfidenceThreshold()`. */
  confidence: number;
  reasoning: string;
  /**
   * Optional. Populated only when `route === 'sql'` AND multiple SQL sources
   * are attached. The dispatcher in P3b uses it to skip the outer-agent's
   * source-selection step.
   */
  sourceId?: string;
};

export type ClassifyInput = {
  question: string;
  /** API key for the OpenAI client. Passed per-call so caching keys stay aligned with the outer agent's pattern. */
  apiKey: string;
  /** Brief summary of the project's attached sources, used in the classifier's user message. */
  sources: ProjectDataSource[];
};

/**
 * Single source of truth for the safe fallback. Used by every error branch
 * so the failure mode is uniform and auditable from logs.
 */
function safeFallback(reasoning: string): RouterDecision {
  return { route: 'agent', confidence: 0, reasoning };
}

@Injectable()
export class ChatRouterService {
  // Per-instance LLM cache keyed on (apiKey, model). Matches the pattern in
  // ChatAgentService.getOrCreateLlm — cheap to construct but cheaper to
  // reuse. The router classifier runs once per chat turn and is the hot
  // path that this caching protects.
  private cachedLlm: ChatOpenAI | null = null;
  private cachedLlmKey = '';

  constructor(private readonly configService: ConfigService) {}

  private getOrCreateLlm(apiKey: string): ChatOpenAI {
    const model =
      this.configService.getChatRouterModel() ??
      this.configService.getOpenAiModel();
    const cacheKey = `${apiKey}:${model}`;
    if (this.cachedLlm && this.cachedLlmKey === cacheKey) {
      return this.cachedLlm;
    }
    this.cachedLlm = new ChatOpenAI({
      apiKey,
      model,
      temperature: 0,
      // JSON mode forces the model to emit valid JSON, which lets the parser
      // below trust the shape (modulo schema-validation we still run).
      modelKwargs: { response_format: { type: 'json_object' } },
    });
    this.cachedLlmKey = cacheKey;
    return this.cachedLlm;
  }

  /**
   * Builds the classifier system prompt by composing the SSoT rules into
   * the wrapper template. The template's `{{ROUTING_RULES}}` placeholder is
   * substituted with the contents of `chat-routing-rules.md`. One rules
   * file, two consumers (router here, agent prompt builder in
   * `ChatAgentService.buildAgentRoutingProtocol`).
   */
  buildClassifierSystemPrompt(): string {
    const template = this.configService.getChatRouterSystemPrompt();
    const rules = this.configService.getChatRoutingRules();
    if (template.includes('{{ROUTING_RULES}}')) {
      // `replaceAll` (not `replace`) so operator-overridden templates
      // that embed the placeholder in multiple positions (e.g. once in
      // the preamble and once near the examples) get full substitution.
      // The string form is safe for `$`-bearing rules content because
      // `replaceAll(string, string)` treats $ literally.
      return template.replaceAll('{{ROUTING_RULES}}', rules);
    }
    // Template author dropped the placeholder — append rules at the end so
    // the classifier still has the taxonomy, but flag in logs so the missing
    // marker can be fixed. Do NOT silently rebuild the prompt; the operator
    // overriding the template probably has a reason.
    console.warn(
      '[ChatRouterService] chat-router-system.md is missing the {{ROUTING_RULES}} placeholder; appending rules at end as a fallback.',
    );
    return `${template}\n\n${rules}`;
  }

  private buildSourceSummary(sources: ProjectDataSource[]): string {
    if (sources.length === 0) return '(no sources attached)';
    return sources
      .map((s) => {
        if (s.kind === 'database') {
          return `- database: id=${s.config.connectionId} name="${s.config.connectionName || s.name}"`;
        }
        if (s.kind === 'airweave_collection') {
          return `- airweave: name="${s.config.collectionName || s.name}"`;
        }
        return `- external: name="${s.name}"`;
      })
      .join('\n');
  }

  async classify(input: ClassifyInput): Promise<RouterDecision> {
    const llm = this.getOrCreateLlm(input.apiKey);
    const systemPrompt = this.buildClassifierSystemPrompt();
    const userMessage =
      `Question: ${input.question}\n\nAttached sources:\n${this.buildSourceSummary(input.sources)}`;

    let rawContent: string;
    try {
      const result = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
      ]);
      rawContent = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);
    } catch (error) {
      console.warn('[ChatRouterService] classifier LLM call failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return safeFallback('classifier_error');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      console.warn('[ChatRouterService] classifier returned non-JSON', {
        rawContentPreview: rawContent.slice(0, 200),
      });
      return safeFallback('classifier_invalid_json');
    }

    return this.validateDecision(parsed);
  }

  /**
   * Validates the LLM's JSON output against the RouterDecision schema.
   * Any deviation → safe fallback (route='agent', confidence=0). Stricter
   * than e.g. zod here because the failure mode is well-defined and the
   * runtime cost of an extra schema lib for one shape isn't worth it.
   */
  private validateDecision(parsed: unknown): RouterDecision {
    if (!parsed || typeof parsed !== 'object') {
      return safeFallback('classifier_invalid_shape');
    }
    const obj = parsed as Record<string, unknown>;
    const route = obj.route;
    if (route !== 'sql' && route !== 'rag' && route !== 'agent') {
      return safeFallback('classifier_invalid_route');
    }
    const confidenceRaw = obj.confidence;
    const confidence =
      typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw))
        : 0;
    const reasoning =
      typeof obj.reasoning === 'string' ? obj.reasoning : 'no reasoning';
    const sourceId = typeof obj.sourceId === 'string' ? obj.sourceId : undefined;
    const base: RouterDecision = { route, confidence, reasoning };
    return sourceId !== undefined ? { ...base, sourceId } : base;
  }
}
