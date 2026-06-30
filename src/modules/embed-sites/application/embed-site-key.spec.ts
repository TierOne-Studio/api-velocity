import { describe, expect, it } from '@jest/globals';
import { generateEmbedSiteKey } from './embed-site-key';

// The key is a publishable identifier, but its UNGUESSABILITY is load-bearing:
// it resolves org/project on the anonymous public channel (ADR-018, SPEC-003 §4),
// so a guessable/low-entropy key would be a cross-tenant data-access vector.
// These assertions pin the entropy/format contract directly (qa-validator MED).
describe('generateEmbedSiteKey', () => {
  const BASE62 = /^[0-9A-Za-z]+$/;

  it('always carries the wgt_pub_ prefix', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateEmbedSiteKey()).toMatch(/^wgt_pub_/);
    }
  });

  it('encodes ≥128 bits as a base62 body of at least 22 chars', () => {
    for (let i = 0; i < 100; i++) {
      const body = generateEmbedSiteKey().slice('wgt_pub_'.length);
      // 128 bits → ⌈128 / log2(62)⌉ = 22 base62 chars (padStart floor).
      expect(body.length).toBeGreaterThanOrEqual(22);
      expect(body).toMatch(BASE62);
    }
  });

  it('draws from a CSPRNG — no collisions across a large volume', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      seen.add(generateEmbedSiteKey());
    }
    // A biased/low-entropy generator would collide well before 20k draws.
    expect(seen.size).toBe(20_000);
  });
});
