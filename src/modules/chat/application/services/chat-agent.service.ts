import { Injectable } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createAgent } from 'langchain';
import { ConfigService } from '../../../../shared/config';
import {
  AirweaveService,
  type AirweaveSearchResultSummary,
} from '../../../airweave/application/services/airweave.service';
import {
  createSearchKnowledgeBaseTool,
  dedupeAndCapSources,
} from './chat-agent-tools';

type GenerateReplyParams = {
  organizationName: string;
  collectionId: string;
  question: string;
  previousMessages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
};

type ChatReply = {
  content: string;
  metadata: Record<string, unknown>;
};

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

@Injectable()
export class ChatAgentService {
  private cachedLlm: ChatOpenAI | null = null;
  private cachedLlmKey = '';

  constructor(
    private readonly airweaveService: AirweaveService,
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
   * Three-tier fallback dispatcher.
   *
   *   1. no OpenAI key              → keyless fallback (raw search summary)
   *   2. agent path (Phase 2)       → multi-retrieval tool-calling agent
   *       on error →
   *   3. single-shot path (Phase 1) → one retrieval + one LLM call
   *           on error →
   *   4. keyless fallback           → raw search summary (last resort)
   *
   * Each tier sets `metadata.generator` to a distinct value so downstream
   * observability can distinguish the healthy agentic path from the
   * degraded paths.
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
      console.warn(
        '[ChatAgentService] Agent path failed, falling back to single-shot',
        {
          error:
            agentError instanceof Error
              ? agentError.message
              : String(agentError),
        },
      );

      try {
        return await this.generateSingleShotReply(apiKey, params);
      } catch (singleShotError) {
        console.error(
          '[ChatAgentService] Single-shot path also failed, falling back to raw search',
          {
            error:
              singleShotError instanceof Error
                ? singleShotError.message
                : String(singleShotError),
          },
        );
        return this.generateKeylessFallback(params);
      }
    }
  }

  /**
   * Phase 2 agent path. Gives the LLM a `search_knowledge_base` tool and
   * lets it drive multiple retrievals, then synthesize a grounded answer.
   */
  async generateAgentReply(
    apiKey: string,
    params: GenerateReplyParams,
  ): Promise<ChatReply> {
    const collectedSources: AirweaveSearchResultSummary[] = [];
    const searchTool = createSearchKnowledgeBaseTool({
      collectionId: params.collectionId,
      airweaveService: this.airweaveService,
      sourcesSink: collectedSources,
      resultCharCap: this.configService.getChatAgentToolResultCharCap(),
    });

    const systemPrompt = this.buildAgentSystemPrompt(params);
    const maxIterations = this.configService.getChatAgentMaxIterations();

    const agent = createAgent({
      model: this.getOrCreateLlm(apiKey) as BaseChatModel,
      tools: [searchTool],
      systemPrompt,
    });

    const historyMessages: BaseMessage[] = params.previousMessages
      .slice(-6)
      .map((message) =>
        message.role === 'assistant'
          ? new AIMessage(message.content)
          : new HumanMessage(message.content),
      );
    const messages: BaseMessage[] = [
      ...historyMessages,
      new HumanMessage(this.buildAgentUserMessage(params)),
    ];

    // Recursion limit is roughly 2 * max iterations + slack (each iteration is
    // a model call node + a tool node in the underlying langgraph). 4x gives a
    // comfortable safety margin for the initial + final model calls.
    const recursionLimit = Math.max(10, maxIterations * 4);

    // langchain v1's createAgent has a very deep generic bag that narrows the
    // `messages` index signature to `never` for consumers without a custom
    // state schema. A narrow cast at the call site is the cleanest escape.
    const result = await agent.invoke(
      { messages } as Parameters<typeof agent.invoke>[0],
      { recursionLimit },
    );

    const resultMessages = (result?.messages ?? []) as BaseMessage[];
    const finalContent = this.extractFinalAssistantText(resultMessages);
    if (!finalContent) {
      throw new Error('Agent produced no assistant content');
    }

    const toolCallCount = this.countToolMessages(resultMessages);
    const uniqueSources = dedupeAndCapSources(collectedSources, 10);

    return {
      content: finalContent,
      metadata: {
        generator: 'langchain-agent',
        sources: this.mapSources(uniqueSources),
        resultCount: uniqueSources.length,
        toolCallCount,
      },
    };
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
    return [
      this.configService.getChatSystemPrompt(),
      AGENT_TOOL_USAGE_PROTOCOL,
      `## Context\n\nYou are answering questions for the organization: ${params.organizationName}. Every question is implicitly scoped to that organization's indexed sources.`,
    ].join('\n\n');
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
   * Phase 1 single-shot path. Kept as a mid-tier fallback when the agent
   * path errors. Does one retrieval with the raw user query, stuffs the
   * top results into a single LLM prompt, returns the response.
   */
  async generateSingleShotReply(
    apiKey: string,
    params: GenerateReplyParams,
  ): Promise<ChatReply> {
    const results = await this.runSingleSearch(
      params.collectionId,
      params.question,
    );

    if (results.length === 0) {
      return this.buildNoResultsReply(params.organizationName);
    }

    const content = await this.generateLangChainReply(apiKey, params, results);

    return {
      content,
      metadata: {
        generator: 'langchain-openai',
        sources: this.mapSources(results),
        resultCount: results.length,
      },
    };
  }

  /**
   * Keyless fallback path. Retrieves once, emits raw search summary if
   * results exist, or an explicit no-results message if not.
   */
  private async generateKeylessFallback(
    params: GenerateReplyParams,
  ): Promise<ChatReply> {
    const results = await this.runSingleSearch(
      params.collectionId,
      params.question,
    );

    if (results.length === 0) {
      return this.buildNoResultsReply(params.organizationName);
    }

    return this.buildFallbackReply(params.question, results);
  }

  private async runSingleSearch(
    collectionId: string,
    query: string,
  ): Promise<AirweaveSearchResultSummary[]> {
    const response = await this.airweaveService.searchCollection(collectionId, {
      query,
      tier: 'classic',
      limit: 5,
      offset: 0,
    });
    return response.results;
  }

  private buildNoResultsReply(organizationName: string): ChatReply {
    return {
      content: [
        '## Answer',
        '',
        `I could not find relevant indexed material for this question in ${organizationName} yet.`,
        '',
        '### Suggested Next Step',
        '',
        '- Try a more specific query, or configure additional indexed sources for this organization.',
      ].join('\n'),
      metadata: {
        generator: 'fallback-no-results',
        sources: [],
        resultCount: 0,
      },
    };
  }

  async generateLangChainReply(
    apiKey: string,
    params: GenerateReplyParams,
    results: AirweaveSearchResultSummary[],
  ): Promise<string> {
    const documents = results.map(
      (result) =>
        new Document({
          pageContent: result.text,
          metadata: {
            name: result.name,
            sourceName: result.sourceName,
            entityType: result.entityType,
            webUrl: result.webUrl,
            relevanceScore: result.relevanceScore,
          },
        }),
    );

    const context = documents
      .map((document, index) => {
        return [
          `Source ${index + 1}: ${String(document.metadata.name ?? 'Unknown source')}`,
          `Type: ${String(document.metadata.entityType ?? 'unknown')}`,
          `Connector: ${String(document.metadata.sourceName ?? 'unknown')}`,
          `URL: ${String(document.metadata.webUrl ?? '')}`,
          `Excerpt: ${document.pageContent}`,
        ].join('\n');
      })
      .join('\n\n');

    const history = params.previousMessages
      .slice(-6)
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', this.configService.getChatSystemPrompt()],
      [
        'human',
        [
          'Organization: {organizationName}',
          'Conversation history:\n{history}',
          'Question: {question}',
          'Source context:\n{context}',
        ].join('\n\n'),
      ],
    ]);

    const chain = RunnableSequence.from([
      prompt,
      this.getOrCreateLlm(apiKey),
      new StringOutputParser(),
    ]);

    const content = await chain.invoke({
      organizationName: params.organizationName,
      history: history || 'none',
      question: params.question,
      context,
    });

    if (!content.trim()) {
      throw new Error('LangChain returned an empty response');
    }

    return content.trim();
  }

  private buildFallbackReply(
    question: string,
    results: AirweaveSearchResultSummary[],
  ): ChatReply {
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
        `Here are the most relevant indexed findings for: ${question}`,
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
