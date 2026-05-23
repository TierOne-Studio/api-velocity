import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type {
  AirweaveSearchResultSummary,
  AirweaveSearchTier,
  AirweaveSearchRetrievalStrategy,
} from '../../../airweave/application/services/airweave.service';
import type { DataSourceRegistry, ProjectDataSource } from '../../../projects';

const searchKnowledgeBaseSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "A natural-language search query. Prefer full sentences or phrases over short keywords. On your first call, use the user's original phrasing verbatim.",
    ),
});

export type CreateSearchKnowledgeBaseToolParams = {
  projectId: string;
  sources: ProjectDataSource[];
  registry: DataSourceRegistry;
  /** Mutated across tool calls. Deduped and capped by the caller. */
  sourcesSink: AirweaveSearchResultSummary[];
  /** Per-call search limit passed to each provider. */
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
 * Fans out across every project data source via the DataSourceRegistry.
 * Per-source failures are logged and skipped so one broken source never
 * breaks the whole retrieval step. Results are aggregated, deduped by
 * entityId, and returned to the LLM sorted by relevance.
 */
export function createSearchKnowledgeBaseTool(
  params: CreateSearchKnowledgeBaseToolParams,
) {
  const {
    projectId,
    sources,
    registry,
    sourcesSink,
    resultLimit,
    resultCharCap,
    searchTier,
    retrievalStrategy,
  } = params;

  return tool(
    async (input) => {
      const { query } = input;

      const searches = await Promise.allSettled(
        sources.map(async (source) => {
          const provider = registry.get(source.kind);
          const response = await provider.search(source, query, {
            tier: searchTier,
            limit: resultLimit,
            offset: 0,
            retrievalStrategy,
          });
          return response.results;
        }),
      );

      const aggregated: AirweaveSearchResultSummary[] = [];
      searches.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          aggregated.push(...outcome.value);
        } else {
          console.warn('[chat-agent-tools] source search failed, skipping', {
            projectId,
            sourceId: sources[index]?.id,
            kind: sources[index]?.kind,
            error:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason),
          });
        }
      });

      sourcesSink.push(...aggregated);

      const dedupedForLlm = dedupeAndCapSources(aggregated, aggregated.length);

      console.info('[chat-agent-tools] search_knowledge_base called', {
        projectId,
        sourceCount: sources.length,
        query,
        searchTier,
        retrievalStrategy: retrievalStrategy ?? 'default',
        rawResultCount: aggregated.length,
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
        "Search the project's data sources (Airweave collections and any other configured providers) using semantic retrieval.",
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
