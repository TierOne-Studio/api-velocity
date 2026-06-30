import { randomBytes } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generate a publishable embed-site key: `wgt_pub_` + ≥128 bits of CSPRNG
 * entropy, base62-encoded (SPEC-003 §4). The high entropy is what makes
 * enumeration of the public index infeasible — the key is an identifier, not a
 * secret, but it must be unguessable. Callers retry on the (astronomically
 * unlikely) `UNIQUE(public_key)` collision.
 */
export function generateEmbedSiteKey(): string {
  let value = BigInt('0x' + randomBytes(16).toString('hex'));
  let encoded = '';
  while (value > 0n) {
    encoded = BASE62[Number(value % 62n)] + encoded;
    value /= 62n;
  }
  // 128 random bits encode to ~21–22 base62 chars; pad defensively so a rare
  // leading-zero draw never shortens the key.
  return `wgt_pub_${encoded.padStart(22, '0')}`;
}
