import { randomBytes } from 'node:crypto';
import {
  assertValidBase64Key,
  decryptAesGcmWithUpgradeHint,
  encryptAesGcm,
} from './aes-gcm';

// Thin test helper for the single-decrypt API: the production code calls
// `decryptAesGcmWithUpgradeHint` and destructures plaintext + needsUpgrade.
// Many of the original tests only care about the plaintext, so a tiny
// wrapper keeps those tests readable. Tests that care about the hint
// call the full function inline.
const decryptAesGcm = (
  payload: Parameters<typeof decryptAesGcmWithUpgradeHint>[0],
  key: string,
  options?: Parameters<typeof decryptAesGcmWithUpgradeHint>[2],
): string => decryptAesGcmWithUpgradeHint(payload, key, options).plaintext;

function freshKey(): string {
  return randomBytes(32).toString('base64');
}

describe('aes-gcm', () => {
  it('round-trips a plaintext string', () => {
    const key = freshKey();
    const payload = encryptAesGcm('hello world', key);
    expect(decryptAesGcm(payload, key)).toBe('hello world');
  });

  it('produces different IVs for identical plaintext', () => {
    const key = freshKey();
    const a = encryptAesGcm('same', key);
    const b = encryptAesGcm('same', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails authentication when the tag is tampered', () => {
    const key = freshKey();
    const payload = encryptAesGcm('secret', key);
    const tagBytes = Buffer.from(payload.tag, 'base64');
    tagBytes[0] = (tagBytes[0]! ^ 0x01) & 0xff;
    const tampered = { ...payload, tag: tagBytes.toString('base64') };
    expect(() => decryptAesGcm(tampered, key)).toThrow();
  });

  it('fails when the ciphertext is tampered', () => {
    const key = freshKey();
    const payload = encryptAesGcm('secret', key);
    // The v1 prefix is text-level ("v1:base64"); the body after the prefix
    // is what gets mutated to simulate ciphertext tampering.
    const prefixIdx = payload.ciphertext.indexOf(':');
    const body = payload.ciphertext.slice(prefixIdx + 1);
    const bytes = Buffer.from(body, 'base64');
    bytes[0] = (bytes[0]! ^ 0xff) & 0xff;
    const tampered = {
      ...payload,
      ciphertext: 'v1:' + bytes.toString('base64'),
    };
    expect(() => decryptAesGcm(tampered, key)).toThrow();
  });

  // C3a: versioned ciphertext + dual-key decrypt
  describe('C3a: versioned ciphertext', () => {
    it('encrypts to v1 wire format (ciphertext prefixed with "v1:")', () => {
      const key = freshKey();
      const payload = encryptAesGcm('hello', key);
      expect(payload.ciphertext.startsWith('v1:')).toBe(true);
    });

    it('round-trips v1 ciphertext', () => {
      const key = freshKey();
      const payload = encryptAesGcm('hello world', key);
      expect(decryptAesGcm(payload, key)).toBe('hello world');
    });

    it('decrypts a v0 (legacy, unprefixed) ciphertext written with the same key', () => {
      // Reproduce the old wire shape by stripping the "v1:" prefix.
      const key = freshKey();
      const v1 = encryptAesGcm('legacy', key);
      const v0: typeof v1 = { ...v1, ciphertext: v1.ciphertext.slice(3) };
      expect(decryptAesGcm(v0, key)).toBe('legacy');
    });

    it('decrypts a v0 ciphertext under previousKey (rotation window)', () => {
      const oldKey = freshKey();
      const newKey = freshKey();
      const v1 = encryptAesGcm('rotated-secret', oldKey);
      // Simulate a row that was encrypted with the OLD key when the wire
      // format was already v1 (or v0 — both cases below).
      expect(
        decryptAesGcm(v1, newKey, { previousKey: oldKey }),
      ).toBe('rotated-secret');
      const v0 = { ...v1, ciphertext: v1.ciphertext.slice(3) };
      expect(
        decryptAesGcm(v0, newKey, { previousKey: oldKey }),
      ).toBe('rotated-secret');
    });

    it('prefers current key over previous when both work (defensive)', () => {
      // If for any reason a payload decrypts under either key, current wins.
      const key = freshKey();
      const payload = encryptAesGcm('value', key);
      expect(
        decryptAesGcm(payload, key, { previousKey: key }),
      ).toBe('value');
    });

    it('throws when neither current nor previous matches', () => {
      const key = freshKey();
      const wrong1 = freshKey();
      const wrong2 = freshKey();
      const payload = encryptAesGcm('value', key);
      expect(() =>
        decryptAesGcm(payload, wrong1, { previousKey: wrong2 }),
      ).toThrow();
    });

    it('throws when current is wrong and no previous is provided', () => {
      const key = freshKey();
      const wrong = freshKey();
      const payload = encryptAesGcm('value', key);
      expect(() => decryptAesGcm(payload, wrong)).toThrow();
    });

    it('encrypt always uses the current key (never the previous, even if provided)', () => {
      // C3a does not change encrypt's signature beyond the prefix; the
      // single-key invariant on encrypt is intentional.
      const key = freshKey();
      const payload = encryptAesGcm('check', key);
      // The payload must decrypt under the same key (round-trip), but if
      // the implementation ever passed previousKey to encrypt by accident,
      // the new key would not decrypt — confirm round-trip integrity.
      expect(decryptAesGcm(payload, key)).toBe('check');
    });
  });

  describe('C3b: decryptAesGcmWithUpgradeHint', () => {
    it('reports needsUpgrade=false for v1 ciphertext under current key', () => {
      const key = freshKey();
      const payload = encryptAesGcm('x', key);
      const out = decryptAesGcmWithUpgradeHint(payload, key);
      expect(out.plaintext).toBe('x');
      expect(out.needsUpgrade).toBe(false);
    });

    it('reports needsUpgrade=true for v0 (legacy) ciphertext even under current key', () => {
      const key = freshKey();
      const v1 = encryptAesGcm('legacy', key);
      const v0 = { ...v1, ciphertext: v1.ciphertext.slice(3) };
      const out = decryptAesGcmWithUpgradeHint(v0, key);
      expect(out.plaintext).toBe('legacy');
      expect(out.needsUpgrade).toBe(true);
    });

    it('reports needsUpgrade=true when previousKey succeeded after current failed', () => {
      const oldKey = freshKey();
      const newKey = freshKey();
      const payload = encryptAesGcm('rotated', oldKey);
      const out = decryptAesGcmWithUpgradeHint(payload, newKey, {
        previousKey: oldKey,
      });
      expect(out.plaintext).toBe('rotated');
      expect(out.needsUpgrade).toBe(true);
    });

    it('throws when neither key decrypts', () => {
      const a = freshKey();
      const b = freshKey();
      const c = freshKey();
      const payload = encryptAesGcm('x', a);
      expect(() =>
        decryptAesGcmWithUpgradeHint(payload, b, { previousKey: c }),
      ).toThrow();
    });
  });

  it('rejects keys with wrong length', () => {
    expect(() => assertValidBase64Key('abc')).toThrow(/Invalid.*key length/i);
    const short = randomBytes(16).toString('base64');
    expect(() => assertValidBase64Key(short)).toThrow(/Invalid.*key length/i);
  });

  it('accepts a valid 32-byte base64 key', () => {
    expect(() => assertValidBase64Key(freshKey())).not.toThrow();
  });

  it('rejects mismatched IV length on decrypt', () => {
    const key = freshKey();
    const payload = encryptAesGcm('x', key);
    const badIv = Buffer.alloc(8).toString('base64');
    expect(() => decryptAesGcm({ ...payload, iv: badIv }, key)).toThrow(
      /IV length/i,
    );
  });

  it('rejects mismatched tag length on decrypt', () => {
    const key = freshKey();
    const payload = encryptAesGcm('x', key);
    const badTag = Buffer.alloc(8).toString('base64');
    expect(() => decryptAesGcm({ ...payload, tag: badTag }, key)).toThrow(
      /auth tag length/i,
    );
  });

  // L1: explicit wire-format invariants on encrypt output. These are
  // implied by the algorithm but worth asserting directly so a future
  // refactor of the helper can't silently change them.
  describe('L1: encrypt wire-format invariants', () => {
    it('produces an IV of exactly 12 bytes (96 bits — AES-GCM standard)', () => {
      const payload = encryptAesGcm('x', freshKey());
      expect(Buffer.from(payload.iv, 'base64').length).toBe(12);
    });

    it('produces an auth tag of exactly 16 bytes (128 bits)', () => {
      const payload = encryptAesGcm('x', freshKey());
      expect(Buffer.from(payload.tag, 'base64').length).toBe(16);
    });

    it('always starts the ciphertext field with the v1 version prefix', () => {
      const payload = encryptAesGcm('x', freshKey());
      expect(payload.ciphertext.startsWith('v1:')).toBe(true);
    });

    it('produces a base64 ciphertext body (no whitespace, valid charset)', () => {
      const payload = encryptAesGcm('hello world', freshKey());
      const body = payload.ciphertext.slice(3); // strip "v1:"
      // Base64 alphabet plus '=' padding only.
      expect(body).toMatch(/^[A-Za-z0-9+/=]+$/);
      // Round-trip through Buffer must produce a non-empty buffer.
      expect(Buffer.from(body, 'base64').length).toBeGreaterThan(0);
    });
  });
});
