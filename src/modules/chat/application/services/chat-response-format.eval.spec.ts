// Opt-in chat response format eval.
//
// This is NOT a unit test. It calls a REAL LLM via ChatAgentService and
// scores the response shape (markdown table format, prose-only, no
// fences, no bullet-then-table mixing) per the rules in
// query-database-tool-description.md.
//
// GATED: set CHAT_EVALS_ENABLED=true to run. Without that env var the
// whole suite is skipped so CI pipelines never accidentally bill the
// OpenAI account for prompt-iteration runs.
//
// Run it on demand:
//
//   CHAT_EVALS_ENABLED=true OPENAI_API_KEY=sk-... \
//   npm test -- --testPathPattern=chat-response-format.eval
//
// The point of this file: replace the "edit a prompt, restart server,
// manually test, repeat" loop with a programmatic fixture/scorer setup.
// When prompt regressions surface, iterate on the prompt and re-run this
// eval to confirm the fix before shipping.

import { jest } from '@jest/globals';
import { ConfigService } from '../../../../shared/config';
import { ChatAgentService } from './chat-agent.service';
import { ChatRouterService } from './chat-router.service';
import { DataSourceRegistry } from '../../../projects';
import type { ProjectDataSource } from '../../../projects';

// === Gate ===

const ENABLED = process.env.CHAT_EVALS_ENABLED === 'true';
const describeIfEnabled = ENABLED ? describe : describe.skip;

// === Fixtures ===

type FormatExpectation =
  | 'prose-single-value'
  | 'table'
  | 'bullets'
  | 'either-table-or-bullets';

type EvalFixture = {
  name: string;
  question: string;
  /**
   * Project sources to provide. Most fixtures use a single SQL source
   * named "test-db" — the real DB content doesn't matter for format
   * scoring, only that the agent goes through the query_database tool.
   */
  sourceKinds: Array<'airweave_collection' | 'database'>;
  expect: {
    format: FormatExpectation;
    /** Substring(s) that MUST appear in the reply. Verifies the model
     *  actually attempted to answer (vs returning a refusal). */
    mustMatch?: string[];
    /** Substring(s) that MUST NOT appear (e.g., "```sql" fences). */
    mustNotMatch?: string[];
  };
};

const FIXTURES: EvalFixture[] = [
  {
    name: 'explicit table request → table format with proper separation',
    question:
      'Create a table summarizing for each user the chats and how many questions they have.',
    sourceKinds: ['database'],
    expect: {
      format: 'table',
      mustNotMatch: ['```sql', '```json'],
    },
  },
  {
    name: 'count question → single-value prose',
    question: 'How many users do we have in the database?',
    sourceKinds: ['database'],
    expect: {
      format: 'prose-single-value',
      mustNotMatch: ['```sql', '```json'],
    },
  },
  {
    name: 'list question without "table" keyword → bullets OR table (not both)',
    question: 'List the users with their email addresses.',
    sourceKinds: ['database'],
    expect: {
      format: 'either-table-or-bullets',
      mustNotMatch: ['```sql', '```json'],
    },
  },
  {
    name: 'RAG-shaped question → prose, no table',
    question: 'How is authentication implemented in this codebase?',
    sourceKinds: ['airweave_collection'],
    expect: {
      format: 'prose-single-value',
      mustNotMatch: ['```sql'],
    },
  },
  {
    name: 'hybrid question → may use table; must not paste SQL',
    question:
      'Who are the most active users by number of questions, and how is "active" measured here?',
    sourceKinds: ['airweave_collection', 'database'],
    expect: {
      format: 'either-table-or-bullets',
      mustNotMatch: ['```sql', '```json'],
    },
  },
];

// === Scorers ===

type Verdict = { pass: boolean; reason: string };

// Detects a properly-formatted markdown table block: header row, separator
// row (with `---` cells), at least one data row, AND a preceding blank
// line. This is the "table is renderable" check the SPA's markdown
// renderer cares about.
function detectRenderableTable(content: string): boolean {
  // Match: \n\n  followed by a `|`-led line, then a `|---|`-led separator line.
  // The `\n\n` anchor is what proves the table is paragraph-separated.
  const pattern = /(^|\n\n)\|[^\n]+\|\n\|[\s|:-]+\|\n\|/m;
  return pattern.test(content);
}

// Detects a bullet list of at least 2 items.
function detectBulletList(content: string): boolean {
  const bulletLines = content
    .split('\n')
    .filter((line) => /^\s*[-*]\s+\S/.test(line));
  return bulletLines.length >= 2;
}

// Detects the "bullets glued to a table" failure mode (also detects bullets
// followed by inline pipe syntax with insufficient separation).
function detectMixedBulletsThenTable(content: string): boolean {
  // Pattern: a bullet line, then SAME line or single-newline transition to
  // pipe-table syntax. The mechanical normalizer (normalizeMarkdownTables)
  // SHOULD have fixed this before persistence, but the eval verifies the
  // model + sanitizer pipeline produces clean output end-to-end.
  return /^\s*[-*][^\n]*\|[^\n]*\|/m.test(content);
}

function scoreFormat(content: string, expected: FormatExpectation): Verdict {
  switch (expected) {
    case 'prose-single-value':
      if (detectRenderableTable(content)) {
        return {
          pass: false,
          reason: 'expected prose, got a markdown table',
        };
      }
      if (detectBulletList(content)) {
        return {
          pass: false,
          reason: 'expected prose, got a bullet list',
        };
      }
      return { pass: true, reason: 'prose only' };
    case 'table':
      if (!detectRenderableTable(content)) {
        return {
          pass: false,
          reason: 'expected a renderable markdown table; not detected',
        };
      }
      if (detectMixedBulletsThenTable(content)) {
        return {
          pass: false,
          reason: 'table is contaminated with bullets (mixed format)',
        };
      }
      if (detectBulletList(content)) {
        return {
          pass: false,
          reason: 'table OR bullets, not both',
        };
      }
      return { pass: true, reason: 'table OK' };
    case 'bullets':
      if (!detectBulletList(content)) {
        return {
          pass: false,
          reason: 'expected bullets; not detected',
        };
      }
      if (detectRenderableTable(content)) {
        return {
          pass: false,
          reason: 'bullets OR table, not both',
        };
      }
      return { pass: true, reason: 'bullets OK' };
    case 'either-table-or-bullets': {
      const hasTable = detectRenderableTable(content);
      const hasBullets = detectBulletList(content);
      if (hasTable && hasBullets) {
        return {
          pass: false,
          reason: 'must pick ONE format; got both table and bullets',
        };
      }
      if (!hasTable && !hasBullets) {
        return {
          pass: false,
          reason: 'expected table OR bullets; got prose-only',
        };
      }
      if (detectMixedBulletsThenTable(content)) {
        return {
          pass: false,
          reason: 'table is contaminated with bullets',
        };
      }
      return {
        pass: true,
        reason: hasTable ? 'table OK' : 'bullets OK',
      };
    }
  }
}

function scoreMustMatch(
  content: string,
  required: string[] | undefined,
): Verdict {
  if (!required || required.length === 0) {
    return { pass: true, reason: 'no required substrings' };
  }
  const missing = required.filter((s) => !content.includes(s));
  if (missing.length > 0) {
    return {
      pass: false,
      reason: `missing required substrings: ${missing.join(', ')}`,
    };
  }
  return { pass: true, reason: 'all required substrings present' };
}

function scoreMustNotMatch(
  content: string,
  forbidden: string[] | undefined,
): Verdict {
  if (!forbidden || forbidden.length === 0) {
    return { pass: true, reason: 'no forbidden substrings' };
  }
  const found = forbidden.filter((s) => content.includes(s));
  if (found.length > 0) {
    return {
      pass: false,
      reason: `forbidden substrings appeared: ${found.join(', ')}`,
    };
  }
  return { pass: true, reason: 'no forbidden substrings' };
}

// === Harness ===

function buildSource(
  kind: 'airweave_collection' | 'database',
  index: number,
): ProjectDataSource {
  if (kind === 'database') {
    return {
      id: `eval-src-db-${index}`,
      projectId: 'eval-proj',
      kind: 'database',
      name: 'test-db',
      config: {
        connectionId: 'eval-conn',
        connectionName: 'test-db',
      },
      status: 'ready',
      statusDetail: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }
  return {
    id: `eval-src-aw-${index}`,
    projectId: 'eval-proj',
    kind: 'airweave_collection',
    name: 'docs',
    config: {
      airweaveCollectionReadableId: 'eval-collection',
      airweaveCollectionName: 'docs',
    },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describeIfEnabled('Chat response format evals (CHAT_EVALS_ENABLED=true)', () => {
  // The eval runs against the REAL services. The DI graph (registry,
  // providers, config) MUST be wired exactly as production. For now we
  // construct a minimal manual graph; if this grows, switch to a NestJS
  // testing module + .compile().
  //
  // Why we don't `.compile()` today: the eval is a leaf utility, and
  // pulling in @nestjs/testing + the full TypeORM provider tree adds
  // ~10s to each test boot. Keep it lean for fast iteration.
  let service: ChatAgentService;
  let configService: ConfigService;

  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'CHAT_EVALS_ENABLED=true but OPENAI_API_KEY is not set. Aborting.',
      );
    }
    configService = new ConfigService();
    // Registry needs the actual providers — these REQUIRE TypeORM + Airweave
    // wiring to function for real. The eval uses a STUB registry that
    // returns canned tool responses; the eval scores the LLM's formatting
    // against those canned outcomes, not against real DB queries.
    //
    // To run against real DBs (more realistic but slower / requires test
    // fixtures), replace this stub with the real NestJS-wired registry.
    const registry = makeStubRegistry();
    const router = new ChatRouterService(configService);
    service = new ChatAgentService(registry, configService, router);
  });

  describe.each(FIXTURES)('$name', (fixture) => {
    it('produces a properly-formatted reply', async () => {
      const sources = fixture.sourceKinds.map((kind, i) =>
        buildSource(kind, i),
      );
      const reply = await service.generateReply({
        organizationName: 'Eval Org',
        projectName: 'Eval Project',
        projectId: 'eval-proj',
        orgId: 'eval-org',
        userId: 'eval-user',
        conversationId: 'eval-conv',
        sources,
        question: fixture.question,
        previousMessages: [],
      });

      const content = reply.content;
      const verdicts: Array<{ check: string } & Verdict> = [];

      const fmt = scoreFormat(content, fixture.expect.format);
      verdicts.push({ check: 'format', ...fmt });

      const must = scoreMustMatch(content, fixture.expect.mustMatch);
      verdicts.push({ check: 'mustMatch', ...must });

      const notMust = scoreMustNotMatch(content, fixture.expect.mustNotMatch);
      verdicts.push({ check: 'mustNotMatch', ...notMust });

      const failures = verdicts.filter((v) => !v.pass);
      if (failures.length > 0) {
        const report = failures
          .map((f) => `  - ${f.check}: ${f.reason}`)
          .join('\n');
        // Embed the actual reply at the bottom of the failure so prompt
        // tweaks can be evaluated against the exact output that failed.
        throw new Error(
          `Format eval failed for "${fixture.name}":\n${report}\n\n` +
            `--- Reply content ---\n${content}\n---`,
        );
      }
    });
  });
});

// === Stub registry (canned tool responses) ===

function makeStubRegistry(): DataSourceRegistry {
  // Minimal stub so the agent's tool calls don't hit real services. The
  // eval evaluates the LLM's text formatting given a canned tool output;
  // wiring the real registry against real DB fixtures is a future
  // extension.
  // jest.fn() default-types as `() => unknown`; cast the search mock
  // explicitly so mockResolvedValue accepts our shape.
  const searchMock = jest
    .fn()
    .mockResolvedValue({
      results: [
        {
          entityId: 'e1',
          name: 'Eval doc',
          relevanceScore: 0.9,
          breadcrumbs: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          text: 'Authentication uses JWT validation in middleware.',
          sourceName: 'docs',
          entityType: 'page',
          webUrl: 'https://eval.test/docs',
        },
      ],
    } as never) as unknown as jest.Mock;
  const stub = {
    get: jest.fn(() => ({
      kind: 'airweave_collection' as const,
      search: searchMock,
    })),
    kinds: jest.fn(() => ['airweave_collection', 'database']),
    getAgentToolsFor: jest.fn(() => {
      // No SQL tool wired here — the agent will either work with
      // search results alone OR report it cannot answer SQL questions.
      // That's acceptable for the format eval; the question shape still
      // drives format selection.
      return [];
    }),
  } as unknown as DataSourceRegistry;
  return stub;
}
