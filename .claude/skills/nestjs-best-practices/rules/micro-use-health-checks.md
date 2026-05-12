---
title: Implement Health Checks for Microservices
impact: MEDIUM-HIGH
impactDescription: Health checks enable orchestrators to manage service lifecycle
tags: microservices, health-checks, terminus, kubernetes
---

## Implement Health Checks for Microservices

Expose `/health/live` (is the service alive?) and `/health/ready` (can it accept traffic?) endpoints. Liveness checks detect crashed processes; readiness checks gate traffic when dependencies are unavailable.

> ⚠️ **Approach gate (per `nestjs-best-practices/SKILL.md` "How rules are structured"):** This rule has two valid implementations. **Before writing any code, ASK the user which approach they prefer:**
>
> > "Health checks can be implemented two ways:
> > - **Approach A — Custom abstraction (no new deps):** Manual `@Get('/health/live')` and `@Get('/health/ready')` endpoints that probe `DatabaseService` and other internal dependencies directly.
> > - **Approach B — Library:** install `@nestjs/terminus` for `HealthCheckService` with built-in indicators for DB / HTTP / disk / memory.
> >
> > Which approach should I use?"
>
> Wait for explicit response. Do NOT silently choose. **For a small/medium app, Approach A is usually sufficient.**

## Outcome

- `/health/live` returns 200 when the process is responsive (liveness — used by orchestrators to decide "restart this pod").
- `/health/ready` returns 200 when the service can accept traffic (readiness — used by load balancers to gate traffic).
- Readiness probes check critical dependencies (DB, etc.) but DON'T cascade failures from non-critical ones.
- Health checks complete fast (no slow downstream calls without timeouts).
- Graceful shutdown returns non-200 from readiness while finishing in-flight requests.

## Approach A — Custom abstraction (no new deps)

Manual health endpoints with direct dependency probes:

```ts
// src/modules/health/health.controller.ts
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../shared/infrastructure/database/database.service';

@Controller('health')
export class HealthController {
  private isShuttingDown = false;
  private readonly startedAt = Date.now();

  constructor(private readonly db: DatabaseService) {}

  @Get('live')
  liveness() {
    // Liveness: is the process responsive?
    // Memory check: refuse if heap is critical (>200MB headroom typical)
    const heap = process.memoryUsage().heapUsed;
    if (heap > 200 * 1024 * 1024) {
      throw new ServiceUnavailableException({ status: 'unhealthy', heap });
    }
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      heap,
    };
  }

  @Get('ready')
  async readiness() {
    if (this.isShuttingDown) {
      throw new ServiceUnavailableException({ status: 'shutting-down' });
    }

    // Probe critical dependencies with a per-check timeout
    const dbCheck = await this.timed(
      'database',
      () => this.db.query('SELECT 1'),
      1000,
    );

    if (!dbCheck.ok) {
      throw new ServiceUnavailableException({
        status: 'not-ready',
        checks: { database: dbCheck },
      });
    }

    return {
      status: 'ok',
      checks: { database: dbCheck },
    };
  }

  private async timed<T>(
    name: string,
    fn: () => Promise<T>,
    timeoutMs: number,
  ): Promise<{ ok: boolean; durationMs: number; error?: string }> {
    const start = Date.now();
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${name} timeout`)), timeoutMs),
        ),
      ]);
      return { ok: true, durationMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  // Called during graceful shutdown
  markShuttingDown() {
    this.isShuttingDown = true;
  }
}
```

Wire shutdown via `OnApplicationShutdown`:

```ts
@Injectable()
export class GracefulShutdownService implements OnApplicationShutdown {
  constructor(private readonly health: HealthController) {}

  async onApplicationShutdown(signal: string): Promise<void> {
    this.health.markShuttingDown();
    // Give load balancers ~5s to notice and stop sending traffic
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
```

For Kubernetes:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

**Limitations:** no built-in disk/memory indicators (you write them manually as needed); no aggregated multi-check response shape; no built-in HTTP-ping-other-service support. Sufficient for most apps; adopt Approach B if those become real needs.

**Anti-patterns regardless of approach:**

```ts
// ❌ Health that doesn't check dependencies
@Get()
check(): string {
  return 'OK'; // Always returns OK even when DB is down
}

// ❌ Health that blocks on slow dependencies without timeout
@Get()
async check(): Promise<string> {
  await this.userRepo.findOne({ where: { id: '1' } });  // Could hang
  await this.redis.ping();                              // Could hang
  await this.externalApi.healthCheck();                 // Definitely could hang
  return 'OK';
}
```

## Approach B — Library: `@nestjs/terminus` ⚠️ Adoption-gated

> ⚠️ Adopting this approach adds `@nestjs/terminus` (transitively `@godaddy/terminus`) to `package.json`. **Do NOT implement this section without explicit user approval.**

```typescript
// Use @nestjs/terminus for comprehensive health checks
import {
  HealthCheckService,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
  HealthCheck,
  DiskHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private db: TypeOrmHealthIndicator,
    private disk: DiskHealthIndicator,
    private memory: MemoryHealthIndicator,
  ) {}

  // Liveness probe - is the service alive?
  @Get('live')
  @HealthCheck()
  liveness() {
    return this.health.check([
      // Basic checks only
      () => this.memory.checkHeap('memory_heap', 200 * 1024 * 1024), // 200MB
    ]);
  }

  // Readiness probe - can the service handle traffic?
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () =>
        this.http.pingCheck('redis', 'http://redis:6379', { timeout: 1000 }),
      () =>
        this.disk.checkStorage('disk', { path: '/', thresholdPercent: 0.9 }),
    ]);
  }

  // Deep health check for debugging
  @Get('deep')
  @HealthCheck()
  deepCheck() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 200 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
      () =>
        this.disk.checkStorage('disk', { path: '/', thresholdPercent: 0.9 }),
      () =>
        this.http.pingCheck('external-api', 'https://api.example.com/health'),
    ]);
  }
}

// Custom indicator for business-specific health
@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  constructor(private queueService: QueueService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const queueStats = await this.queueService.getStats();

    const isHealthy = queueStats.failedCount < 100;
    const result = this.getStatus(key, isHealthy, {
      waiting: queueStats.waitingCount,
      active: queueStats.activeCount,
      failed: queueStats.failedCount,
    });

    if (!isHealthy) {
      throw new HealthCheckError('Queue unhealthy', result);
    }

    return result;
  }
}

// Use custom indicators
@Get('ready')
@HealthCheck()
readiness() {
  return this.health.check([
    () => this.db.pingCheck('database'),
    () => this.queue.isHealthy('job-queue'),
  ]);
}

// Graceful shutdown handling
@Injectable()
export class GracefulShutdownService implements OnApplicationShutdown {
  private isShuttingDown = false;

  isShutdown(): boolean { return this.isShuttingDown; }

  async onApplicationShutdown(signal: string): Promise<void> {
    this.isShuttingDown = true;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
```

### Kubernetes Configuration (same for either approach)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  template:
    spec:
      containers:
        - name: api
          image: api-service:latest
          ports:
            - containerPort: 3000
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 0
            periodSeconds: 5
            failureThreshold: 30
```

Reference: [NestJS Terminus](https://docs.nestjs.com/recipes/terminus)
