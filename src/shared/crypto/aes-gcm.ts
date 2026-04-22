import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface AesGcmCiphertext {
  ciphertext: string;
  iv: string;
  tag: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

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
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptAesGcm(
  payload: AesGcmCiphertext,
  base64Key: string,
): string {
  const key = decodeKey(base64Key);
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES}`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Invalid auth tag length: expected ${TAG_BYTES}`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

export function assertValidBase64Key(base64Key: string): void {
  decodeKey(base64Key);
}
