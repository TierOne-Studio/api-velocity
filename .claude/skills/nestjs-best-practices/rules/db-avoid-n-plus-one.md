---
title: Avoid N+1 Query Problems
impact: HIGH
impactDescription: N+1 queries are one of the most common performance killers
tags: database, n-plus-one, queries, performance
---

## Avoid N+1 Query Problems

When fetching a list and then loading related data per item, batch into a single query (or join). Never make N additional queries inside a loop.

> ⚠️ **Approach gate (per `nestjs-best-practices/SKILL.md` "How rules are structured"):** The "use eager-loading and joins" parts of this rule are pure ORM/SQL — no dep needed. The DataLoader-based batching pattern has two implementations. **Before adopting DataLoader, ASK the user which approach they prefer:**
>
> > "Per-request batching can be implemented two ways:
> > - **Approach A — Custom abstraction (no new deps):** A `Loader<K, V>` class with a Map cache + batch function, scoped per request via `AsyncLocalStorage`.
> > - **Approach B — Library:** install `dataloader` (Facebook's) for the canonical implementation with cache + dedup + scheduling.
> >
> > Which approach should I use?"
>
> Wait for explicit response. Do NOT silently choose. **Most N+1 problems are solved by eager-loading or joins (no new dep) — DataLoader is only needed for GraphQL-style nested resolution.**

## Outcome

- One query per logical fetch — never N+1.
- Eager-load relations when you know you'll use them.
- For GraphQL-style nested resolution, batch sibling lookups within a single request.
- Detect N+1 via query logging in development.

## First-pass: eager-load with relations or joins (no new dep)

Most N+1 problems are solved here. No DataLoader needed.

```ts
// Use relations option for eager loading
@Injectable()
export class OrdersService {
  async getOrdersWithItems(userId: string): Promise<Order[]> {
    return this.orderRepo.find({
      where: { userId },
      relations: ['items', 'items.product'],
    });
  }
}

// Use QueryBuilder for complex joins
@Injectable()
export class UsersService {
  async getUsersWithPostCounts(): Promise<UserWithPostCount[]> {
    return this.userRepo
      .createQueryBuilder('user')
      .leftJoin('user.posts', 'post')
      .select('user.id', 'id')
      .addSelect('user.name', 'name')
      .addSelect('COUNT(post.id)', 'postCount')
      .groupBy('user.id')
      .getRawMany();
  }
}

// For raw-SQL repositories: use a JOIN
async getOrdersWithItems(userId: string, organizationId: string) {
  return this.db.query(
    `SELECT o.*, json_agg(i.*) AS items
     FROM orders o
     LEFT JOIN order_items i ON i.order_id = o.id
     WHERE o.user_id = $1 AND o.organization_id = $2
     GROUP BY o.id`,
    [userId, organizationId],
  );
}
```

## Approach A — Custom abstraction (no new deps): `Loader<K, V>`

When eager-loading isn't possible (e.g., GraphQL field resolvers fired N times for N parent objects), build a per-request batching loader.

```ts
// src/shared/utils/loader.ts
export class Loader<K, V> {
  private readonly batch: K[] = [];
  private readonly cache = new Map<K, Promise<V | null>>();
  private flushPromise: Promise<void> | null = null;

  constructor(
    private readonly batchFn: (keys: K[]) => Promise<Map<K, V>>,
  ) {}

  async load(key: K): Promise<V | null> {
    if (this.cache.has(key)) return this.cache.get(key)!;

    const p = new Promise<V | null>((resolve) => {
      this.batch.push(key);
      // Schedule a microtask to flush after sync code runs
      if (!this.flushPromise) {
        this.flushPromise = Promise.resolve().then(() => this.flush());
      }
      this.flushPromise.then(() => {
        const value = this.cache.get(key);
        Promise.resolve(value).then(resolve);
      });
    });

    this.cache.set(key, p);
    return p;
  }

  private async flush() {
    const keys = [...this.batch];
    this.batch.length = 0;
    this.flushPromise = null;
    const result = await this.batchFn(keys);
    for (const key of keys) {
      this.cache.set(key, Promise.resolve(result.get(key) ?? null));
    }
  }
}
```

Wire one loader instance per request via `AsyncLocalStorage`:

```ts
// src/modules/posts/posts.loader.ts
import { Injectable, Scope } from '@nestjs/common';
import { Loader } from '../../shared/utils/loader';

@Injectable({ scope: Scope.REQUEST })
export class PostsLoader {
  readonly batchPosts: Loader<string, Post[]>;

  constructor(private readonly postsService: PostsService) {
    this.batchPosts = new Loader(async (userIds) => {
      const posts = await this.postsService.findByUserIds([...userIds]);
      const grouped = new Map<string, Post[]>();
      for (const p of posts) {
        const list = grouped.get(p.userId) ?? [];
        list.push(p);
        grouped.set(p.userId, list);
      }
      return grouped as any; // Loader expects Map<K, V>; here V = Post[]
    });
  }
}

// Usage in a resolver/service
@Injectable()
export class UsersService {
  constructor(private readonly loader: PostsLoader) {}

  async getUserWithPosts(userId: string) {
    const user = await this.userRepo.findOne(userId);
    user.posts = await this.loader.batchPosts.load(userId);
    return user;
  }
}
```

**Limitations:** simpler than `dataloader` (no min-batch-size scheduling, no max-batch-size cap, no abort-aware caching). Sufficient for basic batching; if you need more sophisticated scheduling, propose Approach B.

**Anti-patterns regardless of approach:**

```ts
// ❌ Lazy loading in loops causes N+1
for (const order of orders) {
  order.items = await this.itemRepo.find({ where: { orderId: order.id } }); // N additional queries!
}

// ❌ Accessing lazy relations without loading
const users = await this.userRepo.find();
return users; // Each user.posts access during JSON serialization = 1 query
```

## Approach B — Library: `dataloader` ⚠️ Adoption-gated

> ⚠️ Adopting this approach adds `dataloader` to `package.json`. **Do NOT implement this section without explicit user approval.** DataLoader is the canonical Facebook implementation with battle-tested scheduling, caching, and abort handling. Worth adopting if you have many GraphQL field resolvers.

```typescript
// Use DataLoader for GraphQL to batch and cache queries
import DataLoader from 'dataloader';

@Injectable({ scope: Scope.REQUEST })
export class PostsLoader {
  constructor(private postsService: PostsService) {}

  readonly batchPosts = new DataLoader<string, Post[]>(async (userIds) => {
    // Single query for all users' posts
    const posts = await this.postsService.findByUserIds([...userIds]);

    // Group by userId
    const postsMap = new Map<string, Post[]>();
    for (const post of posts) {
      const userPosts = postsMap.get(post.userId) || [];
      userPosts.push(post);
      postsMap.set(post.userId, userPosts);
    }

    // Return in same order as input
    return userIds.map((id) => postsMap.get(id) || []);
  });
}

// In resolver
@ResolveField()
async posts(@Parent() user: User): Promise<Post[]> {
  // DataLoader batches multiple calls into single query
  return this.postsLoader.batchPosts.load(user.id);
}

// Enable query logging in development to detect N+1
TypeOrmModule.forRoot({
  logging: ['query', 'error'],
  logger: 'advanced-console',
});
```

Reference: [TypeORM Relations](https://typeorm.io/relations)
