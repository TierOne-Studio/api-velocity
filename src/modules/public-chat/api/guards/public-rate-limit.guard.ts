import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '../../../../shared/config';
import { EMBED_KEY_HEADER } from './public-embed.guard';

/**
 * Per-IP + per-key burst rate limiting for the public ask endpoint (SPEC-003
 * §6). In-memory fixed window — burst shaping is acceptably per-instance; the
 * DURABLE spend backstop is the org monthly cap (DB counter), enforced
 * separately. Runs BEFORE the embed guard so it rejects floods cheaply, using
 * only the request IP and the raw key header (no DB lookup).
 *
 * Memory note: buckets are reclaimed lazily on access after their window
 * expires; a bounded LRU / Redis store is a Future hardening item.
 */
// Bound the in-memory bucket map so a flood of distinct IPs/keys (incl. spoofed
// ones) can't grow it without limit (memory-exhaustion DoS). When exceeded we
// sweep expired windows; a Redis-backed store is the Future scale path.
const MAX_BUCKETS = 50_000;

@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const ttlMs = this.config.getEmbedPublicRateLimitTtlSeconds() * 1000;
    const ip = request.ip ?? 'unknown';
    const key = (request.header(EMBED_KEY_HEADER) ?? '').trim() || 'anonymous';

    this.consume(`ip:${ip}`, this.config.getEmbedPublicRateLimitPerIp(), ttlMs);
    this.consume(
      `key:${key}`,
      this.config.getEmbedPublicRateLimitPerKey(),
      ttlMs,
    );
    return true;
  }

  private consume(bucket: string, limit: number, ttlMs: number): void {
    const now = Date.now();
    const entry = this.buckets.get(bucket);
    if (!entry || now >= entry.resetAt) {
      if (!entry && this.buckets.size >= MAX_BUCKETS) {
        this.sweepExpired(now);
      }
      this.buckets.set(bucket, { count: 1, resetAt: now + ttlMs });
      return;
    }
    entry.count += 1;
    if (entry.count > limit) {
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private sweepExpired(now: number): void {
    for (const [bucket, entry] of this.buckets) {
      if (now >= entry.resetAt) {
        this.buckets.delete(bucket);
      }
    }
  }
}
