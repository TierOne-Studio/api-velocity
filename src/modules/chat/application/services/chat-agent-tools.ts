import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type {
  AirweaveService,
  AirweaveSearchResultSummary,
} from '../../../airweave/application/services/airweave.service';

const DEFAULT_TOOL_RESULT_CHAR_CAP = 1500;
const DEFAULT_TOOL_RESULT_LIMIT = 8;

const searchKnowledgeBaseSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'A specific, targeted search query. Prefer narrow queries over broad ones. Do not repeat queries you have already issued in this conversation.',
    ),
  entityType: z
    .string()
    .optional()
    .describe(
      'Optional filter to constrain results by entity type (for example "file", "doc", "spec"). Use only when the question clearly targets one type of source.',
    ),
});

export type CreateSearchKnowledgeBaseToolParams = {
  collectionId: string;
  airweaveService: AirweaveService;
  /**
   * Mutated across tool calls. Deduped and capped by the caller before being
   * emitted as response metadata.sources.
   */
  sourcesSink: AirweaveSearchResultSummary[];
  /**
   * Per-call search limit passed to Airweave. Defaults to 8.
   */
  resultLimit?: number;
  /**
   * Per-chunk character cap applied before the text is handed back to the LLM.
   * Prevents a single long chunk from dominating the context window. Defaults
   * to 1500 chars.
   */
  resultCharCap?: number;
};

/**
 * Builds a `search_knowledge_base` tool bound to a single chat request.
 *
 * The LLM is expected to call this tool multiple times with different narrow
 * queries to assemble whole-picture context before answering. Each call's
 * results are pushed into `sourcesSink` so the caller can aggregate and dedupe
 * across all tool calls at the end of the request.
 */
export function createSearchKnowledgeBaseTool(
  params: CreateSearchKnowledgeBaseToolParams,
) {
  const {
    collectionId,
    airweaveService,
    sourcesSink,
    resultLimit = DEFAULT_TOOL_RESULT_LIMIT,
    resultCharCap = DEFAULT_TOOL_RESULT_CHAR_CAP,
  } = params;

  return tool(
    async (input) => {
      const { query, entityType } = input;

      const response = await airweaveService.searchCollection(collectionId, {
        query,
        tier: 'classic',
        limit: resultLimit,
        offset: 0,
      });

      const filtered = entityType
        ? response.results.filter((result) => result.entityType === entityType)
        : response.results;

      sourcesSink.push(...filtered);

      if (filtered.length === 0) {
        return JSON.stringify({
          query,
          results: [],
          note: 'No matches. Try a different query, or if several attempts have all been empty, conclude that the indexed sources do not cover this question and report that honestly.',
        });
      }

      const compactResults = filtered.map((result) => {
        const cappedText =
          result.text.length > resultCharCap
            ? `${result.text.slice(0, resultCharCap - 3)}...`
            : result.text;

        return {
          name: result.name,
          entityType: result.entityType,
          source: result.sourceName,
          url: result.webUrl,
          relevanceScore: result.relevanceScore,
          excerpt: cappedText,
        };
      });

      return JSON.stringify({
        query,
        results: compactResults,
      });
    },
    {
      name: 'search_knowledge_base',
      description: [
        "Search the organization's indexed knowledge base (Airweave).",
        'Call this tool MULTIPLE times with different, specific queries to gather complete context before answering any non-trivial question.',
        'Prefer narrow, targeted queries over broad ones.',
        'Use the optional `entityType` filter when the question clearly targets one type of source (e.g. "file" for code, "doc" for documentation).',
        'Never repeat a query you have already issued in this conversation.',
        'If several queries all return nothing, conclude that the indexed sources do not cover the question and report it honestly instead of guessing.',
      ].join(' '),
      schema: searchKnowledgeBaseSchema,
    },
  );
}

/**
 * Dedupes search results by entityId (highest relevance wins), sorts by
 * relevance descending, and caps at `limit` entries. Used by the agent path
 * to normalize sourcesSink before emitting as response metadata.
 */
export function dedupeAndCapSources(
  results: AirweaveSearchResultSummary[],
  limit = 10,
): AirweaveSearchResultSummary[] {
  const byEntityId = new Map<string, AirweaveSearchResultSummary>();

  for (const result of results) {
    const existing = byEntityId.get(result.entityId);
    if (!existing || result.relevanceScore > existing.relevanceScore) {
      byEntityId.set(result.entityId, result);
    }
  }

  return Array.from(byEntityId.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}
