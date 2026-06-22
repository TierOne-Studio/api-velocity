import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExecutionContext, HttpException } from '@nestjs/common';
import type { Request } from 'express';
import type { ConfigService } from '../../../../shared/config';
import { PublicRateLimitGuard } from './public-rate-limit.guard';

function makeConfig(perIp: number, perKey: number): ConfigService {
  return {
    getEmbedPublicRateLimitTtlSeconds: () => 60,
    getEmbedPublicRateLimitPerIp: () => perIp,
    getEmbedPublicRateLimitPerKey: () => perKey,
  } as unknown as ConfigService;
}

function makeContext(ip: string, key?: string): ExecutionContext {
  const headers: Record<string, string | undefined> = key
    ? { 'x-velocity-embed-key': key }
    : {};
  const request = {
    ip,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('PublicRateLimitGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resets the window after the TTL elapses, allowing requests again', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const guard = new PublicRateLimitGuard(makeConfig(1, 1000));
    const context = makeContext('5.5.5.5', 'wgt_pub_a');

    expect(guard.canActivate(context)).toBe(true); // count 1
    expect(() => guard.canActivate(context)).toThrow(HttpException); // count 2 > 1

    // Advance past the 60s TTL → bucket window resets.
    nowSpy.mockReturnValue(1_000_000 + 61_000);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows exactly up to the limit at the boundary', () => {
    const guard = new PublicRateLimitGuard(makeConfig(3, 1000));
    const context = makeContext('6.6.6.6', 'wgt_pub_a');
    expect(guard.canActivate(context)).toBe(true); // 1
    expect(guard.canActivate(context)).toBe(true); // 2
    expect(guard.canActivate(context)).toBe(true); // 3 == limit, allowed
    expect(() => guard.canActivate(context)).toThrow(HttpException); // 4 > limit
  });

  it('allows requests up to the per-IP limit and rejects beyond it', () => {
    const guard = new PublicRateLimitGuard(makeConfig(2, 1000));
    const context = makeContext('1.1.1.1', 'wgt_pub_a');

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });

  it('rejects beyond the per-key limit even across different IPs', () => {
    const guard = new PublicRateLimitGuard(makeConfig(1000, 2));

    expect(guard.canActivate(makeContext('1.1.1.1', 'wgt_pub_shared'))).toBe(
      true,
    );
    expect(guard.canActivate(makeContext('2.2.2.2', 'wgt_pub_shared'))).toBe(
      true,
    );
    expect(() =>
      guard.canActivate(makeContext('3.3.3.3', 'wgt_pub_shared')),
    ).toThrow(HttpException);
  });

  it('tracks separate IPs independently', () => {
    const guard = new PublicRateLimitGuard(makeConfig(1, 1000));
    expect(guard.canActivate(makeContext('1.1.1.1', 'wgt_pub_a'))).toBe(true);
    expect(guard.canActivate(makeContext('2.2.2.2', 'wgt_pub_b'))).toBe(true);
  });

  it('throws a 429 HttpException when the limit is exceeded', () => {
    const guard = new PublicRateLimitGuard(makeConfig(1, 1000));
    const context = makeContext('9.9.9.9', 'wgt_pub_a');
    guard.canActivate(context);
    try {
      guard.canActivate(context);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });
});
