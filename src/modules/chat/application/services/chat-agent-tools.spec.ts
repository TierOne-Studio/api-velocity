import { jest } from '@jest/globals';
import {
  createSearchKnowledgeBaseTool,
  dedupeAndCapSources,
} from './chat-agent-tools';
import type {
  AirweaveSearchResponse,
  AirweaveSearchResultSummary,
} from '../../../airweave/application/services/airweave.service';
import type { ProjectDataSource } from '../../../projects/api/dto/project.dto';
import type { DataSourceRegistry } from '../../../projects/application/providers/data-source.registry';
import type { DataSourceProvider } from '../../../projects/application/providers/data-source-provider.interface';

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

function makeAirweaveSource(
  overrides: Partial<
    Extract<ProjectDataSource, { kind: 'airweave_collection' }>
  > = {},
): ProjectDataSource {
  return {
    id: 'src-1',
    projectId: 'proj-1',
    kind: 'airweave_collection',
    name: 'Main collection',
    config: {
      collectionReadableId: 'col-1',
      collectionName: 'Main collection',
    },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('createSearchKnowledgeBaseTool', () => {
  let searchMock: jest.Mock<
    (
      source: ProjectDataSource,
      query: string,
      opts: Parameters<DataSourceProvider['search']>[2],
    ) => Promise<AirweaveSearchResponse>
  >;
  let registry: DataSourceRegistry;
  let sourcesSink: AirweaveSearchResultSummary[];
  let sources: ProjectDataSource[];

  function makeToolParams(
    overrides: Partial<
      Parameters<typeof createSearchKnowledgeBaseTool>[0]
    > = {},
  ) {
    return {
      projectId: 'proj-1',
      sources,
      registry,
      sourcesSink,
      resultLimit: 12,
      resultCharCap: 3000,
      searchTier: 'classic' as const,
      ...overrides,
    };
  }

  beforeEach(() => {
    searchMock =
      jest.fn<
        (
          source: ProjectDataSource,
          query: string,
          opts: Parameters<DataSourceProvider['search']>[2],
        ) => Promise<AirweaveSearchResponse>
      >();
    const provider: DataSourceProvider = {
      kind: 'airweave_collection',
      search: searchMock as unknown as DataSourceProvider['search'],
    };
    registry = {
      get: jest.fn((_kind) => provider),
      kinds: jest.fn(() => ['airweave_collection']),
    } as unknown as DataSourceRegistry;
    sourcesSink = [];
    sources = [makeAirweaveSource()];
  });

  it('declares the expected name and description', () => {
    const tool = createSearchKnowledgeBaseTool(makeToolParams());

    expect(tool.name).toBe('search_knowledge_base');
    expect(tool.description).toContain('MULTIPLE');
    expect(tool.description).toContain("user's original question verbatim");
  });

  it('does not advertise an entityType parameter (regression: client-side filter caused zero-result bug)', () => {
    const tool = createSearchKnowledgeBaseTool(makeToolParams());

    expect(tool.description).not.toContain('entityType');
  });

  it('forwards the query through the registry to the matching provider', async () => {
    searchMock.mockResolvedValue({ results: [] });
    const tool = createSearchKnowledgeBaseTool(makeToolParams());

    await tool.invoke({ query: 'deploy flow' });

    expect(registry.get).toHaveBeenCalledWith('airweave_collection');
    expect(searchMock).toHaveBeenCalledWith(sources[0], 'deploy flow', {
      tier: 'classic',
      limit: 12,
      offset: 0,
      retrievalStrategy: undefined,
    });
  });

  it('pushes all retrieved results into the shared sources sink', async () => {
    const results = [
      makeResult({ entityId: 'a', name: 'A' }),
      makeResult({ entityId: 'b', name: 'B' }),
    ];
    searchMock.mockResolvedValue({ results });
    const tool = createSearchKnowledgeBaseTool(makeToolParams());

    await tool.invoke({ query: 'anything' });

    expect(sourcesSink).toHaveLength(2);
    expect(sourcesSink.map((r) => r.entityId)).toEqual(['a', 'b']);
  });

  it('returns all results regardless of their Airweave entity_type values (regression for ConfluencePageEntity bug)', async () => {
    const results = [
      makeResult({ entityId: 'a', entityType: 'ConfluencePageEntity' }),
      makeResult({ entityId: 'b', entityType: 'GithubFileEntity' }),
      makeResult({ entityId: 'c', entityType: 'JiraIssueEntity' }),
    ];
    searchMock.mockResolvedValue({ results });
    const tool = createSearchKnowledgeBaseTool(makeToolParams());

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
      searchMock.mockResolvedValue({
        results: [
          makeResult({ entityId: 'a', name: 'Deploy Guide' }),
          makeResult({ entityId: 'b', name: 'Release Notes' }),
        ],
      });
      const tool = createSearchKnowledgeBaseTool(makeToolParams());

      await tool.invoke({ query: 'deploy flow' });

      expect(infoSpy).toHaveBeenCalledWith(
        '[chat-agent-tools] search_knowledge_base called',
        expect.objectContaining({
          projectId: 'proj-1',
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
    searchMock.mockResolvedValue({ results });
    const tool = createSearchKnowledgeBaseTool(makeToolParams());

    const raw = await tool.invoke({ query: 'pages' });
    const parsed = JSON.parse(raw) as {
      results: Array<{ name: string; excerpt: string; relevanceScore: number }>;
    };

    expect(parsed.results).toHaveLength(3);
    const pageA = parsed.results.find((r) => r.name === 'Page A');
    expect(pageA?.excerpt).toContain('higher relevance chunk');
    expect(pageA?.relevanceScore).toBe(0.9);
    expect(parsed.results.map((r) => r.name)).toEqual([
      'Page A',
      'Page B',
      'Page C',
    ]);

    expect(sourcesSink).toHaveLength(5);
  });

  it('truncates long result text to the configured char cap', async () => {
    const longText = 'x'.repeat(5000);
    searchMock.mockResolvedValue({
      results: [makeResult({ text: longText })],
    });
    const tool = createSearchKnowledgeBaseTool(
      makeToolParams({ resultCharCap: 200 }),
    );

    const raw = await tool.invoke({ query: 'anything' });
    const parsed = JSON.parse(raw) as {
      results: Array<{ excerpt: string }>;
    };

    expect(parsed.results[0].excerpt).toHaveLength(200);
    expect(parsed.results[0].excerpt.endsWith('...')).toBe(true);
  });

  it('returns a helpful empty-results note when the search yields nothing', async () => {
    searchMock.mockResolvedValue({ results: [] });
    const tool = createSearchKnowledgeBaseTool(makeToolParams());

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
    searchMock.mockResolvedValue({ results: [] });
    const tool = createSearchKnowledgeBaseTool(
      makeToolParams({ resultLimit: 3 }),
    );

    await tool.invoke({ query: 'anything' });

    expect(searchMock).toHaveBeenCalledWith(
      sources[0],
      'anything',
      expect.objectContaining({ limit: 3 }),
    );
  });

  it('aggregates results across multiple sources and logs per-source failures without failing the whole call', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const secondSource = makeAirweaveSource({
        id: 'src-2',
        config: {
          collectionReadableId: 'col-2',
          collectionName: 'Second collection',
        },
      });
      sources = [makeAirweaveSource(), secondSource];

      searchMock
        .mockResolvedValueOnce({
          results: [makeResult({ entityId: 'a', name: 'A' })],
        })
        .mockRejectedValueOnce(new Error('boom'));

      const tool = createSearchKnowledgeBaseTool(makeToolParams());
      const raw = await tool.invoke({ query: 'anything' });
      const parsed = JSON.parse(raw) as { results: Array<{ name: string }> };

      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].name).toBe('A');
      expect(warnSpy).toHaveBeenCalledWith(
        '[chat-agent-tools] source search failed, skipping',
        expect.objectContaining({
          projectId: 'proj-1',
          sourceId: 'src-2',
          kind: 'airweave_collection',
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
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
    expect(result[0].entityId).toBe('e19');
  });
});
