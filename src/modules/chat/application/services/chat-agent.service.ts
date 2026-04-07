import { Injectable } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '../../../../shared/config';
import {
  AirweaveService,
  type AirweaveSearchResultSummary,
} from '../../../airweave/application/services/airweave.service';

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
    const searchResponse = await this.airweaveService.searchCollection(
      params.collectionId,
      {
        query: params.question,
        tier: 'classic',
        limit: 5,
        offset: 0,
      },
    );

    const results = searchResponse.results;
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

    const apiKey = this.configService.getOpenAiApiKey();
    if (!apiKey) {
      return this.buildFallbackReply(params.question, results);
    }

    try {
      const openAiReply = await this.generateLangChainReply(
        apiKey,
        params,
        results,
      );
      return {
        content: openAiReply,
        metadata: {
          generator: 'langchain-openai',
          sources: this.mapSources(results),
          resultCount: results.length,
        },
      };
    } catch (error) {
      console.error('[ChatAgentService] Failed to generate LangChain reply', {
        error: error instanceof Error ? error.message : String(error),
      });

      return this.buildFallbackReply(params.question, results);
    }
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
      [
        'system',
        this.configService.getChatSystemPrompt(),
      ],
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
    return results.slice(0, 5).map((result) => ({
      name: result.name,
      webUrl: result.webUrl,
      sourceName: result.sourceName,
      entityType: result.entityType,
    }));
  }
}
