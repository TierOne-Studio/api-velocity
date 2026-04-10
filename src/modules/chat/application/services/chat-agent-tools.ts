import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type {
  AirweaveService,
  AirweaveSearchResultSummary,
  AirweaveSearchTier,
  AirweaveSearchRetrievalStrategy,
} from '../../../airweave/application/services/airweave.service';

const searchKnowledgeBaseSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "A natural-language search query. Prefer full sentences or phrases over short keywords. On your first call, use the user's original phrasing verbatim.",
    ),
});

export type CreateSearchKnowledgeBaseToolParams = {
  collectionId: string;
  airweaveService: AirweaveService;
  /** Mutated across tool calls. Deduped and capped by the caller. */
  sourcesSink: AirweaveSearchResultSummary[];
  /** Per-call search limit passed to Airweave. */
  resultLimit: number;
  /** Per-chunk character cap before handing text to the LLM. */
  resultCharCap: number;
  /** Airweave search tier: 'classic' (accurate) or 'instant' (fast). */
  searchTier: AirweaveSearchTier;
  /** Airweave retrieval strategy. Undefined = Airweave default. */
  retrievalStrategy?: AirweaveSearchRetrievalStrategy;
};

/**
 * Builds a `search_knowledge_base` tool bound to a single chat request.
 *
 * The LLM calls this tool multiple times with different natural-language
 * queries. Each call's results are pushed into `sourcesSink` for cross-call
 * metadata aggregation, then deduped by entityId before being returned to
 * the LLM so each entity gets exactly one slot in the response.
 */
export function createSearchKnowledgeBaseTool(
  params: CreateSearchKnowledgeBaseToolParams,
) {
  const {
    collectionId,
    airweaveService,
    sourcesSink,
    resultLimit,
    resultCharCap,
    searchTier,
    retrievalStrategy,
  } = params;

  return tool(
    async (input) => {
      const { query } = input;

      const response = await airweaveService.searchCollection(collectionId, {
        query,
        tier: searchTier,
        limit: resultLimit,
        offset: 0,
        retrievalStrategy,
      });

      const results = response.results;

      sourcesSink.push(...results);

      const dedupedForLlm = dedupeAndCapSources(results, results.length);

      console.info('[chat-agent-tools] search_knowledge_base called', {
        collectionId,
        query,
        searchTier,
        retrievalStrategy: retrievalStrategy ?? 'default',
        rawResultCount: results.length,
        dedupedResultCount: dedupedForLlm.length,
        resultNames: dedupedForLlm.map((r) => r.name),
        entityTypes: dedupedForLlm.map((r) => r.entityType),
      });

      if (dedupedForLlm.length === 0) {
        return JSON.stringify({
          query,
          results: [],
          note: 'No matches. Try rephrasing with different terminology, or if several varied queries have all been empty, conclude that the indexed sources do not cover this question and report that honestly.',
        });
      }

      const compactResults = dedupedForLlm.map((result) => {
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
        "Search the organization's indexed knowledge base (Airweave) using semantic retrieval.",
        'Call this tool MULTIPLE times with different queries to gather complete context before answering any non-trivial question.',
        "IMPORTANT: your FIRST call should use the user's original question verbatim, because the retrieval model is tuned for natural-language phrasing and short keyword queries often return worse results.",
        "On follow-up calls, rephrase with different terminology or ask about specific aspects of the question — e.g. if the user asks 'how does the invitation flow work', follow-ups might be 'invitation email template' or 'accept invitation endpoint'.",
        'Never repeat a query you have already issued in this conversation.',
        'If several varied queries all return nothing, conclude that the indexed sources do not cover the question and report it honestly instead of guessing.',
      ].join(' '),
      schema: searchKnowledgeBaseSchema,
    },
  );
}

/**
 * Dedupes search results by entityId (highest relevance wins), sorts by
 * relevance descending, and caps at `limit` entries.
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
