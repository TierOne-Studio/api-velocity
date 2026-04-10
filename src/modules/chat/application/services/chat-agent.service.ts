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

export type ChatStreamEvent =
  | { type: 'thinking' }
  | { type: 'searching'; query: string }
  | { type: 'chunk'; content: string }
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
    const collectedSources: AirweaveSearchResultSummary[] = [];
    const searchTool = createSearchKnowledgeBaseTool({
      collectionId: params.collectionId,
      airweaveService: this.airweaveService,
      sourcesSink: collectedSources,
      resultLimit: this.configService.getChatAgentToolResultLimit(),
      resultCharCap: this.configService.getChatAgentToolResultCharCap(),
      searchTier: this.configService.getChatAgentSearchTier(),
      retrievalStrategy: this.configService.getChatAgentRetrievalStrategy(),
    });

    const systemPrompt = this.buildAgentSystemPrompt(params);
    const maxIterations = this.configService.getChatAgentMaxIterations();

    const agent = createAgent({
      model: this.getOrCreateLlm(apiKey) as BaseChatModel,
      tools: [searchTool],
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
    const maxSources = this.configService.getChatAgentMaxSources();
    const uniqueSources = dedupeAndCapSources(collectedSources, maxSources);

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

    const collectedSources: AirweaveSearchResultSummary[] = [];
    const searchTool = createSearchKnowledgeBaseTool({
      collectionId: params.collectionId,
      airweaveService: this.airweaveService,
      sourcesSink: collectedSources,
      resultLimit: this.configService.getChatAgentToolResultLimit(),
      resultCharCap: this.configService.getChatAgentToolResultCharCap(),
      searchTier: this.configService.getChatAgentSearchTier(),
      retrievalStrategy: this.configService.getChatAgentRetrievalStrategy(),
    });

    const systemPrompt = this.buildAgentSystemPrompt(params);
    const maxIterations = this.configService.getChatAgentMaxIterations();

    const agent = createAgent({
      model: this.getOrCreateLlm(apiKey) as BaseChatModel,
      tools: [searchTool],
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
    let emittedThinking = false;
    let finalContent = '';
    let toolCallCount = 0;

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

        // Tool messages = search tool completed
        if (messageType === 'tool') {
          toolCallCount++;
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
              // In messages mode, each chunk is a single message with the new content
              finalContent = text;
              yield { type: 'chunk', content: text };
            }
          }
        }
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

    const reply: ChatReply = {
      content: finalContent,
      metadata: {
        generator: 'langchain-agent',
        sources: this.mapSources(uniqueSources),
        resultCount: uniqueSources.length,
        toolCallCount,
      },
    };

    this.logReplySummary(reply, Date.now());
    yield { type: 'done', reply };
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
   * Keyless fallback path. Retrieves once, emits raw search summary if
   * results exist, or an explicit no-results message if not.
   */
  private async generateKeylessFallback(
    params: GenerateReplyParams,
  ): Promise<ChatReply> {
    const response = await this.airweaveService.searchCollection(
      params.collectionId,
      {
        query: params.question,
        tier: 'classic',
        limit: 5,
        offset: 0,
      },
    );
    const results = response.results;

    if (results.length === 0) {
      return {
        content: [
          '## Answer',
          '',
          `I could not find relevant indexed material for this question in ${params.organizationName} yet.`,
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
