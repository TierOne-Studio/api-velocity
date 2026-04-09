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
    expect(tool.description).toContain('entityType');
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

  it('filters results by entityType when the agent passes that argument', async () => {
    const results = [
      makeResult({ entityId: 'a', entityType: 'file' }),
      makeResult({ entityId: 'b', entityType: 'doc' }),
      makeResult({ entityId: 'c', entityType: 'doc' }),
    ];
    airweaveService.searchCollection.mockResolvedValue({ results });
    const tool = createSearchKnowledgeBaseTool({
      collectionId: 'col-1',
      airweaveService: airweaveService as never,
      sourcesSink,
    });

    const raw = await tool.invoke({
      query: 'policy',
      entityType: 'doc',
    });
    const parsed = JSON.parse(raw) as {
      query: string;
      results: Array<{ name: string; entityType: string }>;
    };

    expect(parsed.results).toHaveLength(2);
    expect(parsed.results.map((r) => r.entityType)).toEqual(['doc', 'doc']);
    // Sink is still populated from filtered results so metadata.sources stays accurate.
    expect(sourcesSink).toHaveLength(2);
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
