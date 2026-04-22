import { randomBytes } from 'node:crypto';
import {
  assertValidBase64Key,
  decryptAesGcm,
  encryptAesGcm,
} from './aes-gcm';

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
    const bytes = Buffer.from(payload.ciphertext, 'base64');
    bytes[0] = (bytes[0]! ^ 0xff) & 0xff;
    const tampered = { ...payload, ciphertext: bytes.toString('base64') };
    expect(() => decryptAesGcm(tampered, key)).toThrow();
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
});
