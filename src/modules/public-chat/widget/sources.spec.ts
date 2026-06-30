import { describe, expect, it } from '@jest/globals';
import { dedupeSources, isSafeUrl, type WidgetSource } from './sources';

function src(overrides: Partial<WidgetSource> = {}): WidgetSource {
  return {
    name: 'Doc A',
    webUrl: 'https://example.com/a',
    sourceName: 'Confluence',
    entityType: 'page',
    ...overrides,
  };
}

describe('dedupeSources (SPEC-002 semantics)', () => {
  it('collapses entries identical on name|sourceName|webUrl', () => {
    const result = dedupeSources([src(), src(), src()]);
    expect(result).toHaveLength(1);
  });

  it('keeps entries that differ on any keyed field', () => {
    const result = dedupeSources([
      src({ name: 'Doc A' }),
      src({ name: 'Doc B' }),
      src({ sourceName: 'Jira' }),
      src({ webUrl: 'https://example.com/other' }),
    ]);
    expect(result).toHaveLength(4);
  });

  it('preserves first-seen order', () => {
    const result = dedupeSources([
      src({ name: 'First' }),
      src({ name: 'Second' }),
      src({ name: 'First' }),
    ]);
    expect(result.map((s) => s.name)).toEqual(['First', 'Second']);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupeSources([])).toEqual([]);
  });

  it('does not collapse distinct tuples when fields contain "|" characters', () => {
    const result = dedupeSources([
      src({ name: 'a|b', sourceName: 'c', webUrl: 'https://example.com/x' }),
      src({ name: 'a', sourceName: 'b|c', webUrl: 'https://example.com/x' }),
    ]);
    expect(result).toHaveLength(2);
  });
});

describe('isSafeUrl', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com', true],
    ['HTTPS://EXAMPLE.COM', true],
    ['javascript:alert(1)', false],
    ['data:text/html,evil', false],
    ['/relative/path', false],
    ['', false],
  ])('isSafeUrl(%s) === %s', (url, expected) => {
    expect(isSafeUrl(url)).toBe(expected);
  });
});
