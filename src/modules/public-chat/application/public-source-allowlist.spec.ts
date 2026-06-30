import { describe, expect, it } from '@jest/globals';
import { filterPublicSources } from './public-source-allowlist';

describe('filterPublicSources (fail-closed public source allowlist)', () => {
  const sourcesOfKinds = (...kinds: string[]) =>
    kinds.map((kind, i) => ({ kind, id: `src-${i}` }));

  it('keeps airweave_collection and vector_db sources', () => {
    const sources = sourcesOfKinds('airweave_collection', 'vector_db');
    expect(filterPublicSources(sources)).toEqual(sources);
  });

  it('excludes database (SQL) sources', () => {
    const result = filterPublicSources(
      sourcesOfKinds('airweave_collection', 'database'),
    );
    expect(result.map((s) => s.kind)).toEqual(['airweave_collection']);
  });

  it('excludes external sources', () => {
    const result = filterPublicSources(sourcesOfKinds('vector_db', 'external'));
    expect(result.map((s) => s.kind)).toEqual(['vector_db']);
  });

  it('excludes an unknown/future kind by default (fail-closed)', () => {
    const result = filterPublicSources(
      sourcesOfKinds('airweave_collection', 'warehouse'),
    );
    expect(result.map((s) => s.kind)).toEqual(['airweave_collection']);
  });

  it('returns an empty array when no source is allowlisted', () => {
    expect(filterPublicSources(sourcesOfKinds('database', 'external'))).toEqual(
      [],
    );
  });

  it('preserves the order of allowlisted sources', () => {
    const result = filterPublicSources(
      sourcesOfKinds('vector_db', 'database', 'airweave_collection'),
    );
    expect(result.map((s) => s.kind)).toEqual([
      'vector_db',
      'airweave_collection',
    ]);
  });
});
