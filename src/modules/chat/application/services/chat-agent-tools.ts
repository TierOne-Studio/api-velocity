import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type {
  AirweaveService,
  AirweaveSearchResultSummary,
} from '../../../airweave/application/services/airweave.service';

const DEFAULT_TOOL_RESULT_CHAR_CAP = 3000;
const DEFAULT_TOOL_RESULT_LIMIT = 8;

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
 * The LLM is expected to call this tool multiple times with different
 * natural-language queries to assemble whole-picture context before answering.
 * Each call's results are pushed into `sourcesSink` so the caller can aggregate
 * and dedupe across all tool calls at the end of the request.
 *
 * Important: this tool does NOT accept an `entityType` filter. A previous
 * version did, with fake example values ("file", "doc", "spec") that never
 * matched Airweave's real entity_type strings (e.g. `ConfluencePageEntity`,
 * `GithubFileEntity`). The agent happily passed the fake values and every tool
 * call returned zero results because the client-side filter stripped
 * everything. The feature was pure harm and has been removed. If Airweave
 * later exposes a server-side filter API with documented type values, we can
 * reintroduce it properly.
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
      const { query } = input;

      const response = await airweaveService.searchCollection(collectionId, {
        query,
        tier: 'classic',
        limit: resultLimit,
        offset: 0,
      });

      const results = response.results;

      // Push raw (un-deduped) results into the sink so cross-tool-call
      // metadata aggregation in the service layer sees every chunk Airweave
      // returned. Dedup for the LLM is done separately below.
      sourcesSink.push(...results);

      // Airweave often returns multiple chunks of the same entity (e.g. a
      // long Confluence page split into 4 chunks, or a space overview that
      // matches a query 5 different ways). When that happens the top-k
      // gets dominated by 1-2 entities and individual sibling pages get
      // pushed out, which makes the agent describe a container instead of
      // its contents. Dedupe by entityId before handing results to the LLM
      // so each entity gets exactly one slot, and the agent can see more
      // distinct material in the same call.
      const dedupedForLlm = dedupeAndCapSources(results, results.length);

      console.info('[chat-agent-tools] search_knowledge_base called', {
        collectionId,
        query,
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
