import { jest } from '@jest/globals';

jest.mock('jose', () => {
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  return {
    SignJWT: class {
      private _p: Record<string, unknown>;
      private _h: Record<string, unknown> = { alg: 'HS256' };
      private _iat = 0;
      private _expiresIn = 3600;
      constructor(payload: Record<string, unknown>) {
        this._p = payload;
      }
      setProtectedHeader(h: Record<string, unknown>) {
        this._h = h;
        return this;
      }
      setIssuedAt() {
        this._iat = Math.floor(Date.now() / 1000);
        return this;
      }
      setExpirationTime(e: string) {
        this._expiresIn = parseInt(e, 10);
        return this;
      }
      async sign(_secret: unknown): Promise<string> {
        const iat = this._iat;
        const exp = iat + this._expiresIn;
        const hdr = b64url(JSON.stringify(this._h));
        const pl = b64url(JSON.stringify({ ...this._p, iat, exp }));
        return `${hdr}.${pl}.fakesig`;
      }
    },
    decodeJwt: (token: string) => {
      const [, p] = token.split('.');
      return JSON.parse(Buffer.from(p, 'base64url').toString());
    },
  };
});

import { decodeJwt } from 'jose';
import {
  buildVerificationToken,
  buildVerificationUrl,
} from './verification.utils';

describe('verification.utils', () => {
  describe('buildVerificationToken', () => {
    const VALID_SECRET = 'a'.repeat(32);

    it('should return a valid HS256 JWT string (three dot-separated segments)', async () => {
      const token = await buildVerificationToken(
        'user@example.com',
        VALID_SECRET,
        3600,
      );
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('should lowercase the email in the token payload', async () => {
      const token = await buildVerificationToken(
        'USER@Example.COM',
        VALID_SECRET,
      );
      const payload = decodeJwt(token);
      expect(payload.email).toBe('user@example.com');
    });

    it('should use provided expiresInSeconds in the expiry claim', async () => {
      const token = await buildVerificationToken('a@b.com', VALID_SECRET, 7200);
      const payload = decodeJwt(token);
      const delta = payload.exp - payload.iat;
      expect(delta).toBe(7200);
    });

    it('should default expiresInSeconds to 3600', async () => {
      const token = await buildVerificationToken('a@b.com', VALID_SECRET);
      const payload = decodeJwt(token);
      const delta = payload.exp - payload.iat;
      expect(delta).toBe(3600);
    });

    it('should throw when secret is empty', async () => {
      await expect(buildVerificationToken('a@b.com', '', 3600)).rejects.toThrow(
        'Secret must be a non-empty string of at least 32 characters',
      );
    });

    it('should throw when secret is shorter than 32 characters', async () => {
      await expect(
        buildVerificationToken('a@b.com', 'short', 3600),
      ).rejects.toThrow(
        'Secret must be a non-empty string of at least 32 characters',
      );
    });

    it('should throw when expiresInSeconds is zero', async () => {
      await expect(
        buildVerificationToken('a@b.com', VALID_SECRET, 0),
      ).rejects.toThrow(
        'expiresInSeconds must be a positive integer of at least 60',
      );
    });

    it('should throw when expiresInSeconds is negative', async () => {
      await expect(
        buildVerificationToken('a@b.com', VALID_SECRET, -1),
      ).rejects.toThrow(
        'expiresInSeconds must be a positive integer of at least 60',
      );
    });

    it('should throw when expiresInSeconds is not an integer', async () => {
      await expect(
        buildVerificationToken('a@b.com', VALID_SECRET, 3600.5),
      ).rejects.toThrow(
        'expiresInSeconds must be a positive integer of at least 60',
      );
    });

    it('should throw when expiresInSeconds is below minimum (< 60)', async () => {
      await expect(
        buildVerificationToken('a@b.com', VALID_SECRET, 59),
      ).rejects.toThrow(
        'expiresInSeconds must be a positive integer of at least 60',
      );
    });
  });

  describe('buildVerificationUrl', () => {
    it('should build verification URL with encoded callbackURL', () => {
      const url = buildVerificationUrl(
        'tok123',
        'http://api.test',
        'http://fe.test',
      );
      expect(url).toBe(
        'http://api.test/api/auth/verify-email?token=tok123&callbackURL=http%3A%2F%2Ffe.test',
      );
    });

    it('should include the token in the URL', () => {
      const url = buildVerificationUrl(
        'abc.def.ghi',
        'http://api',
        'http://fe',
      );
      expect(url).toContain('token=abc.def.ghi');
    });

    it('should encode special characters in feUrl', () => {
      const url = buildVerificationUrl(
        'tok',
        'http://api',
        'http://fe/path?q=1',
      );
      expect(url).toContain(encodeURIComponent('http://fe/path?q=1'));
    });
  });
});
