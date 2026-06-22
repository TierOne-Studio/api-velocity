import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { PublicCorsMiddleware } from './public-cors.middleware';

function makeRes(): Response & { headers: Record<string, string>; statusCode: number; ended: boolean } {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    statusCode: 0,
    ended: false,
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res as unknown as Response & {
    headers: Record<string, string>;
    statusCode: number;
    ended: boolean;
  };
}

function makeReq(method: string, origin?: string): Request {
  return {
    method,
    header: (name: string) =>
      name.toLowerCase() === 'origin' ? origin : undefined,
  } as unknown as Request;
}

describe('PublicCorsMiddleware', () => {
  const middleware = new PublicCorsMiddleware();

  it('answers preflight OPTIONS with 204 and non-credentialed CORS, without calling next', () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware.use(makeReq('OPTIONS', 'https://customer.com'), res, next);

    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(res.headers['Access-Control-Allow-Origin']).toBe(
      'https://customer.com',
    );
    expect(res.headers['Access-Control-Allow-Credentials']).toBe('false');
    expect(res.headers['Access-Control-Allow-Headers']).toContain(
      'X-Velocity-Embed-Key',
    );
    expect(res.headers['Access-Control-Max-Age']).toBe('600');
    expect(res.headers['Vary']).toBe('Origin');
  });

  it('sets NO CORS header on an actual request and calls next (the guard owns actual-request CORS)', () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware.use(makeReq('POST', 'https://customer.com'), res, next);

    // The middleware must not reflect the origin on actual requests — that would
    // grant reflected-origin CORS on any non-guarded route (ADR-019).
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not advertise GET in the preflight (only POST is served)', () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware.use(makeReq('OPTIONS', 'https://customer.com'), res, next);

    expect(res.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
  });
});
