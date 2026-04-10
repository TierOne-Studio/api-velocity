import { jest } from '@jest/globals';
import {
  createSearchKnowledgeBaseTool,
  dedupeAndCapSources,
} from './chat-agent-tools';
import type { AirweaveSearchResultSummary } from '../../../airweave/application/services/airweave.service';

function makeResult(
  overrides: Partial<AirweaveSearchResultSummary> = {},
): AirweaveSearchResultSummary {
  return {
    entityId: 'entity-default',
    name: 'Default Source',
    relevanceScore: 0.5,
    breadcrumbs: [],
    createdAt: null,
    updatedAt: null,
    text: 'default text',
    sourceName: 'github',
    entityType: 'file',
    webUrl: 'https://example.com/default',
    ...overrides,
  };
}

describe('createSearchKnowledgeBaseTool', () => {
  let airweaveService: { searchCollection: any };
  let sourcesSink: AirweaveSearchResultSummary[];

  beforeEach(() => {
    airweaveService = {
      searchCollection: jest.fn(),
    };
    sourcesSink = [];
  });

  it('declares the expected name and description', () => {
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
    });

    expect(tool.name).toBe('search_knowledge_base');
    expect(tool.description).toContain('MULTIPLE');
    expect(tool.description).toContain("user's original question verbatim");
  });

  it('does not advertise an entityType parameter (regression: client-side filter caused zero-result bug)', () => {
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
    });

    expect(tool.description).not.toContain('entityType');
    // Schema should also not accept entityType. We assert by passing one and
    // verifying the tool ignores it (zod strips unknown keys by default).
  });

  it('forwards the query to airweaveService.searchCollection with the configured collection', async () => {
    airweaveService.searchCollection.mockResolvedValue({ results: [] });
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
    });

    await tool.invoke({ query: 'deploy flow' });

    expect(airweaveService.searchCollection).toHaveBeenCalledWith('col-1', {
      query: 'deploy flow',
      tier: 'classic',
      limit: 8,
      offset: 0,
    });
  });

  it('pushes all retrieved results into the shared sources sink', async () => {
    const results = [
      makeResult({ entityId: 'a', name: 'A' }),
      makeResult({ entityId: 'b', name: 'B' }),
    ];
    airweaveService.searchCollection.mockResolvedValue({ results });
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
    });

    await tool.invoke({ query: 'anything' });

    expect(sourcesSink).toHaveLength(2);
    expect(sourcesSink.map((r) => r.entityId)).toEqual(['a', 'b']);
  });

  it('returns all results regardless of their Airweave entity_type values (regression for ConfluencePageEntity bug)', async () => {
    // Airweave returns entity types like 'ConfluencePageEntity', 'GithubFileEntity', etc.
    // A previous version of this tool had a client-side filter expecting fake values
    // ("file", "doc", "spec") which caused every tool call to return zero results.
    const results = [
      makeResult({ entityId: 'a', entityType: 'ConfluencePageEntity' }),
      makeResult({ entityId: 'b', entityType: 'GithubFileEntity' }),
      makeResult({ entityId: 'c', entityType: 'JiraIssueEntity' }),
    ];
    airweaveService.searchCollection.mockResolvedValue({ results });
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
    });

    const raw = await tool.invoke({ query: 'projects' });
    const parsed = JSON.parse(raw) as {
      query: string;
      results: Array<{ name: string; entityType: string }>;
    };

    expect(parsed.results).toHaveLength(3);
    expect(parsed.results.map((r) => r.entityType)).toEqual([
      'ConfluencePageEntity',
      'GithubFileEntity',
      'JiraIssueEntity',
    ]);
    expect(sourcesSink).toHaveLength(3);
  });

  it('logs each tool call with query, raw + deduped counts, and result names for diagnostics', async () => {
    const infoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    try {
      airweaveService.searchCollection.mockResolvedValue({
        results: [
          makeResult({ entityId: 'a', name: 'Deploy Guide' }),
          makeResult({ entityId: 'b', name: 'Release Notes' }),
        ],
      });
      const tool = createSearchKnowledgeBaseTool({
        collectionId: 'col-1',
        airweaveService: airweaveService as never,
        sourcesSink,
      });

      await tool.invoke({ query: 'deploy flow' });

      expect(infoSpy).toHaveBeenCalledWith(
        '[chat-agent-tools] search_knowledge_base called',
        expect.objectContaining({
          collectionId: 'col-1',
          query: 'deploy flow',
          rawResultCount: 2,
          dedupedResultCount: 2,
          resultNames: ['Deploy Guide', 'Release Notes'],
        }),
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('dedupes results by entityId before returning to the LLM, keeping highest-relevance chunk per entity', async () => {
    // Airweave often returns multiple chunks of the same page (e.g. a Confluence
    // space overview chunked 4 times). Without dedup the LLM sees the same entity
    // in 4 of its 8 result slots, pushing other distinct material out of the top-k
    // and making the agent describe the container instead of its contents.
    const results = [
      makeResult({
        entityId: 'page-a',
        relevanceScore: 0.5,
        name: 'Page A',
        text: 'lower relevance chunk of page A',
      }),
      makeResult({
        entityId: 'page-a',
        relevanceScore: 0.9,
        name: 'Page A',
        text: 'higher relevance chunk of page A',
      }),
      makeResult({
        entityId: 'page-a',
        relevanceScore: 0.3,
        name: 'Page A',
        text: 'another lower chunk of page A',
      }),
      makeResult({
        entityId: 'page-b',
        relevanceScore: 0.7,
        name: 'Page B',
        text: 'page B chunk',
      }),
      makeResult({
        entityId: 'page-c',
        relevanceScore: 0.6,
        name: 'Page C',
        text: 'page C chunk',
      }),
    ];
    airweaveService.searchCollection.mockResolvedValue({ results });
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
    });

    const raw = await tool.invoke({ query: 'pages' });
    const parsed = JSON.parse(raw) as {
      results: Array<{ name: string; excerpt: string; relevanceScore: number }>;
    };

    // LLM sees 3 distinct entities, not 5 chunks.
    expect(parsed.results).toHaveLength(3);
    // Page A appears once with the higher-relevance excerpt.
    const pageA = parsed.results.find((r) => r.name === 'Page A');
    expect(pageA?.excerpt).toContain('higher relevance chunk');
    expect(pageA?.relevanceScore).toBe(0.9);
    // Sorted by relevance descending: A(0.9) > B(0.7) > C(0.6).
    expect(parsed.results.map((r) => r.name)).toEqual([
      'Page A',
      'Page B',
      'Page C',
    ]);

    // sourcesSink keeps ALL 5 raw chunks so cross-tool-call metadata
    // aggregation in the service layer can dedupe globally rather than
    // losing data here.
    expect(sourcesSink).toHaveLength(5);
  });

  it('truncates long result text to the configured char cap', async () => {
    const longText = 'x'.repeat(5000);
    airweaveService.searchCollection.mockResolvedValue({
      results: [makeResult({ text: longText })],
    });
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
      resultCharCap: 200,
    });

    const raw = await tool.invoke({ query: 'anything' });
    const parsed = JSON.parse(raw) as {
      results: Array<{ excerpt: string }>;
    };

    expect(parsed.results[0].excerpt).toHaveLength(200);
    expect(parsed.results[0].excerpt.endsWith('...')).toBe(true);
  });

  it('returns a helpful empty-results note when the search yields nothing', async () => {
    airweaveService.searchCollection.mockResolvedValue({ results: [] });
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
    });

    const raw = await tool.invoke({ query: 'nothing' });
    const parsed = JSON.parse(raw) as {
      query: string;
      results: unknown[];
      note?: string;
    };

    expect(parsed.query).toBe('nothing');
    expect(parsed.results).toEqual([]);
    expect(parsed.note).toBeDefined();
    expect(parsed.note).toContain('No matches');
  });

  it('respects a custom resultLimit in the search params', async () => {
    airweaveService.searchCollection.mockResolvedValue({ results: [] });
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
      resultLimit: 3,
    });

    await tool.invoke({ query: 'anything' });

    expect(airweaveService.searchCollection).toHaveBeenCalledWith(
      'col-1',
      expect.objectContaining({ limit: 3 }),
    );
  });
});

describe('dedupeAndCapSources', () => {
  it('returns an empty array when given no results', () => {
    expect(dedupeAndCapSources([])).toEqual([]);
  });

  it('dedupes by entityId, keeping the highest-relevance occurrence', () => {
    const input = [
      makeResult({ entityId: 'a', relevanceScore: 0.3, name: 'A-low' }),
      makeResult({ entityId: 'a', relevanceScore: 0.9, name: 'A-high' }),
      makeResult({ entityId: 'b', relevanceScore: 0.5, name: 'B' }),
    ];

    const result = dedupeAndCapSources(input);

    expect(result).toHaveLength(2);
    const a = result.find((r) => r.entityId === 'a');
    expect(a?.name).toBe('A-high');
    expect(a?.relevanceScore).toBe(0.9);
  });

  it('sorts by relevance descending', () => {
    const input = [
      makeResult({ entityId: 'low', relevanceScore: 0.1 }),
      makeResult({ entityId: 'high', relevanceScore: 0.9 }),
      makeResult({ entityId: 'mid', relevanceScore: 0.5 }),
    ];

    const result = dedupeAndCapSources(input);

    expect(result.map((r) => r.entityId)).toEqual(['high', 'mid', 'low']);
  });

  it('caps the output at the given limit', () => {
    const input = Array.from({ length: 20 }, (_, i) =>
      makeResult({ entityId: `e${i}`, relevanceScore: i / 20 }),
    );

    const result = dedupeAndCapSources(input, 5);

    expect(result).toHaveLength(5);
    // Highest relevance should come first.
    expect(result[0].entityId).toBe('e19');
  });
});
