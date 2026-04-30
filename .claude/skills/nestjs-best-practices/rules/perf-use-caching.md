---
title: Use Caching Strategically
impact: HIGH
impactDescription: Dramatically reduces database load and response times
tags: performance, caching, redis, optimization
---

## Use Caching Strategically

Implement caching for expensive operations, frequently accessed data, and external API calls. Use appropriate TTLs and explicit invalidation. Don't cache everything — focus on high-impact areas.

> ⚠️ **Skill-vs-repo conflict resolution (per `CLAUDE.md` P3.5):** This rule's library-backed approach (`KeyvRedis`, `@nestjs/cache-manager`) requires installing dependencies that **are NOT in this repo's `package.json`** AND requires Redis infrastructure the repo doesn't currently run.
>
> **Default for the current PR:** follow Approach A (in-memory cache, no new deps). Don't introduce Redis as a side-effect of unrelated work.
>
> **If the change is explicitly about adopting distributed caching**, that's a deliberate structural decision — switch to Approach B and ASK the user first.

## Outcome

- Expensive computations and frequently-accessed reads are served from cache, not recomputed per request.
- Cache invalidation happens on the write paths that affect the cached data — not via blanket TTLs that hide stale state.
- The cache layer is testable: a unit test can verify cache-hit and cache-miss paths.
- The implementation matches the repo's deployment shape: in-memory for single-instance dev, distributed only when explicitly adopted.

## Approach gate (ASK FIRST)

> Before writing any code, ASK the user:
>
> > "This change adds caching. The api-velocity repo currently has no caching layer and Redis is not provisioned for this service.
> >
> > Options:
> > - **(A) In-process cache (no new deps)** — a small Map-backed `CacheService` with TTL eviction. Works for one instance; cache is per-process (warm-up on restart, not shared across replicas). Sufficient for non-clustered deployments and for caches whose stale tolerance is short.
> > - **(B) Distributed cache (`@nestjs/cache-manager` + `@keyv/redis` + Redis infra)** — shared across replicas, survives restarts. Requires installing two npm packages AND provisioning a Redis instance + `REDIS_URL` env var. Structural change.
> >
> > Which approach?"
>
> Wait for explicit response. Default to (A) unless the user says (B).

## Approach A — In-process `CacheService` (no new deps, repo-fit)

A simple TTL-aware cache as a NestJS service. Works for any single-instance deployment and for caches that tolerate per-replica drift.

**Anti-pattern (no caching, OR caching everything by default):**

```typescript
@Injectable()
export class ProductsService {
  async getPopular(): Promise<Product[]> {
    return this.productsRepo.createQueryBuilder('p')
      .leftJoin('p.orders', 'o').select('p.*, COUNT(o.id) as orderCount')
      .groupBy('p.id').orderBy('orderCount', 'DESC').limit(20).getMany();
  }
}
```

**Correct (explicit caching with explicit invalidation, no deps):**

```typescript
// src/shared/cache/cache.service.ts
import { Injectable } from '@nestjs/common';

interface Entry<V> { value: V; expiresAt: number }

@Injectable()
export class CacheService {
  private readonly store = new Map<string, Entry<unknown>>();

  get<V>(key: string): V | undefined {
    const entry = this.store.get(key) as Entry<V> | undefined;
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<V>(key: string, value: V, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  del(key: string): void { this.store.delete(key); }

  // Pattern delete for invalidating a key family.
  delByPrefix(prefix: string): void {
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }
}
```

```typescript
// usage
@Injectable()
export class ProductsService {
  constructor(
    private readonly cache: CacheService,
    private readonly productsRepo: ProductRepository,
  ) {}

  async getPopular(): Promise<Product[]> {
    const key = 'products:popular';
    const cached = this.cache.get<Product[]>(key);
    if (cached) return cached;

    const products = await this.fetchPopularProducts();
    this.cache.set(key, products, 5 * 60 * 1000); // 5 min
    return products;
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.productsRepo.save({ id, ...dto });
    this.cache.delByPrefix('products:'); // explicit invalidation
    return product;
  }
}
```

**Caveats of Approach A** (call them out in the PR description so the user knows what they're trading):
- Cache is per-process. Multiple replicas → each has its own cache → consistency window = TTL.
- Cache is lost on process restart. First request after deploy hits the database.
- No size cap in this minimal implementation; add an eviction policy (LRU) if the cache could grow unbounded.

If any of those caveats is unacceptable for the use case, the answer is Approach B — surface that to the user, don't silently accept the limitation.

## Approach B — Distributed cache via `@nestjs/cache-manager` + `@keyv/redis` ⚠️ Structural — adoption-gated

> ⚠️ **This adds two npm dependencies and requires Redis.** Per `CLAUDE.md` P0.2/P0.3, package installation requires explicit user approval. Per `repo-conventions`, infrastructure changes (new external service) are NOT in scope for unrelated PRs. **Ask first.**

**Adoption checklist (when the user approves Approach B):**

1. Confirm Redis is provisioned for the target environment (local dev, staging, prod). Add `REDIS_URL` to env config + secrets.
2. Install: `npm install @nestjs/cache-manager cache-manager @keyv/redis keyv`. The `Awaiting approval` line for the install MUST appear in the commit/PR trail (the security-reviewer's dep-gate audit checks this).
3. Wire the module:

   ```typescript
   import { CacheModule } from '@nestjs/cache-manager';
   import KeyvRedis from '@keyv/redis';

   @Module({
     imports: [
       CacheModule.registerAsync({
         imports: [ConfigModule],
         inject: [ConfigService],
         useFactory: (config: ConfigService) => ({
           stores: [new KeyvRedis(config.get('REDIS_URL'))],
           ttl: 60 * 1000,
         }),
       }),
     ],
   })
   export class AppModule {}
   ```

4. Replace `CacheService` usages with the `CACHE_MANAGER` token where Redis-backing is needed; keep the `CacheService` for cases where in-process is fine to avoid Redis chatter on hot paths.
5. Add tests that exercise Redis (integration, with a real container or testcontainer) AND fallback behavior (Redis down → cache miss, not 500).
6. Update `CLAUDE.md` P2 + `repo-conventions` to record the new infrastructure dependency.

```typescript
// Decorator-based caching (only available under Approach B)
@Controller('categories')
@UseInterceptors(CacheInterceptor)
export class CategoriesController {
  @Get()
  @CacheTTL(30 * 60 * 1000)
  findAll(): Promise<Category[]> { return this.categoriesService.findAll(); }
}
```

Reference: [NestJS Caching](https://docs.nestjs.com/techniques/caching)
