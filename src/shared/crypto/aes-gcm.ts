import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface AesGcmCiphertext {
  /**
   * Wire-versioned ciphertext.
   *
   * Two forms are accepted on decrypt:
   *   - v1 (current): "v1:" + base64(ciphertext_body)
   *   - v0 (legacy):  base64(ciphertext_body) — no prefix
   *
   * `encryptAesGcm` always emits the v1 form. Legacy rows persisted
   * before C3a remain decryptable through the v0 fallback below; they
   * upgrade to v1 lazily on next read (see C3b for the lazy-upgrade
   * hook in sql-connections.service).
   */
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface DecryptOptions {
  /**
   * Previous key, used to decrypt rows written before the current key
   * was rotated in. If the current key fails authentication, the
   * implementation retries once with `previousKey`. Successful decrypt
   * with the previous key signals to the caller that the row needs
   * to be re-encrypted with the current key (lazy upgrade — C3b).
   */
  previousKey?: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const V1_PREFIX = 'v1:';

function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Invalid AES-256-GCM key length: expected ${KEY_BYTES} bytes (base64), got ${key.length}`,
    );
  }
  return key;
}

export function encryptAesGcm(
  plaintext: string,
  base64Key: string,
): AesGcmCiphertext {
  const key = decodeKey(base64Key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    // C3a: always emit v1 wire format. Stored value is "v1:<base64>".
    ciphertext: V1_PREFIX + ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function runDecrypt(
  cipherBytes: Buffer,
  iv: Buffer,
  tag: Buffer,
  base64Key: string,
): string {
  const key = decodeKey(base64Key);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(cipherBytes),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

export function assertValidBase64Key(base64Key: string): void {
  decodeKey(base64Key);
}

/**
 * Decrypts a v0 (legacy, unprefixed) or v1 ciphertext using the current key
 * first, falling back to `options.previousKey` on auth-tag failure.
 *
 * Returns `{ plaintext, needsUpgrade }`. `needsUpgrade` is the hint callers
 * use to fire a lazy re-encrypt (C3b): true when the row was in v0 wire
 * format, or when the previous key was needed to decrypt.
 *
 * This is the single decrypt entry point on the public API — the earlier
 * `decryptAesGcm` and `isV1Ciphertext` exports were retired because the
 * upgrade-hint shape strictly subsumes both (post-review cleanup, code-
 * reviewer MED-2).
 */
export function decryptAesGcmWithUpgradeHint(
  payload: AesGcmCiphertext,
  base64Key: string,
  options: DecryptOptions = {},
): { plaintext: string; needsUpgrade: boolean } {
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES}`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Invalid auth tag length: expected ${TAG_BYTES}`);
  }
  const wireIsV1 = payload.ciphertext.startsWith(V1_PREFIX);
  const body = wireIsV1
    ? payload.ciphertext.slice(V1_PREFIX.length)
    : payload.ciphertext;
  const cipherBytes = Buffer.from(body, 'base64');

  try {
    const plaintext = runDecrypt(cipherBytes, iv, tag, base64Key);
    // Wire was v0 → upgrade needed (rewrites the row to v1 next time).
    // Wire was v1 + current key worked → no upgrade.
    return { plaintext, needsUpgrade: !wireIsV1 };
  } catch (currentErr) {
    if (!options.previousKey) throw currentErr;
    try {
      const plaintext = runDecrypt(cipherBytes, iv, tag, options.previousKey);
      // Decrypt only worked under the previous key → upgrade needed.
      return { plaintext, needsUpgrade: true };
    } catch {
      throw currentErr;
    }
  }
}
