---
title: Use Message Queues for Background Jobs
impact: MEDIUM-HIGH
impactDescription: Queues enable reliable background processing
tags: microservices, queues, bullmq, background-jobs
---

## Use Message Queues for Background Jobs

For long-running tasks, retries with backoff, scheduled jobs, and decoupling from HTTP request lifecycles, use a message queue.

> ⚠️ **Approach gate (per `nestjs-best-practices/SKILL.md` "How rules are structured"):** **Tier 3 — no clean abstraction exists.** A real queue requires infrastructure (Redis or equivalent) plus battle-tested job-management code that's not feasible to implement manually. **Before adopting any queue dependency, ASK the user:**
>
> > "Background queueing requires installing the `@nestjs/bullmq` library plus Redis as infrastructure. There's no clean abstraction-only alternative — implementing a queue manually is non-trivial and error-prone (retry semantics, job persistence, distribution, monitoring).
> >
> > Options:
> > - **(A)** Install `@nestjs/bullmq` (transitively `bullmq`) and require Redis infrastructure. Optionally `@bull-board/api` + `@bull-board/nestjs` for a UI.
> > - **(B)** Skip the queue. Use simple in-process async (`setImmediate`, fire-and-forget) for non-critical work — accept that errors are silently lost.
> > - **(C)** Defer the work — keep it synchronous in the request, accept the latency.
> >
> > For this change, do you want a real queue (A), simple async (B), or to keep it sync (C)?"
>
> Wait for explicit response. Do NOT silently choose A. **In api-velocity, no queue infrastructure exists today** — adopting a queue is a deliberate infrastructure-and-dep decision.

## Outcome

The team has chosen one of:
- A real queue with retries, scheduling, monitoring (BullMQ + Redis).
- Simple in-process async for best-effort work, with explicit acceptance of "errors may be silently lost."
- Synchronous handling, accepting the request-latency cost.

The choice is documented in the PR/issue and matches the workload's reliability needs.

## Why no abstraction?

A queue's value is in:
1. **Job persistence** across restarts — requires durable storage (Redis, a DB).
2. **Retry semantics** — exponential backoff, max attempts, dead-letter queues.
3. **Distribution** — multiple workers consuming from the same queue without conflicts.
4. **Scheduling** — cron-style repeated jobs, delayed execution.
5. **Monitoring** — visibility into job state (waiting, active, failed).

You can write a thin "in-process queue" using `setImmediate` + a Map of pending jobs, but it doesn't have any of the above. That's not really a queue — it's just async-with-extra-steps. If reliability matters at all, BullMQ or equivalent is the answer.

## When you genuinely don't need a queue

- The "background work" is really fire-and-forget (e.g., metrics emission to an external service that has its own buffering). Write a try/catch that logs failures and moves on.
- The work is short enough that it can stay in the request synchronously (under ~500ms).
- You can defer the work entirely (no actual urgency).

In these cases, **don't add a queue dep** — call the existing async code and let it complete in-process.

```ts
// Acceptable for true fire-and-forget where errors don't matter
@Injectable()
export class AnalyticsService {
  trackEvent(name: string, payload: object) {
    // No await; failures logged but ignored.
    this.client.send(name, payload).catch((err) => {
      this.logger.warn('analytics.send.failed', { err: err.message, name });
    });
  }
}
```

## When you DO need a queue (Approach B — `@nestjs/bullmq`) ⚠️ Adoption-gated

> ⚠️ Adopting this approach adds `@nestjs/bullmq` (transitively `bullmq`, `ioredis`) and optionally `@bull-board/api` + `@bull-board/nestjs` to `package.json`. **AND requires running Redis as infrastructure.** **Do NOT implement this section without explicit user approval covering both the package install AND the infrastructure decision.**

```typescript
// Configure BullMQ
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: 'localhost',
        port: 6379,
      },
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    }),
    BullModule.registerQueue(
      { name: 'email' },
      { name: 'reports' },
      { name: 'notifications' },
    ),
  ],
})
export class QueueModule {}

// Producer: Add jobs to queue
@Injectable()
export class ReportsService {
  constructor(
    @InjectQueue('reports') private reportsQueue: Queue,
  ) {}

  async requestReport(dto: GenerateReportDto): Promise<{ jobId: string }> {
    const job = await this.reportsQueue.add('generate', dto, {
      priority: dto.urgent ? 1 : 10,
      delay: dto.scheduledFor ? Date.parse(dto.scheduledFor) - Date.now() : 0,
    });
    return { jobId: job.id };
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    const job = await this.reportsQueue.getJob(jobId);
    return {
      status: await job.getState(),
      progress: job.progress,
      result: job.returnvalue,
    };
  }
}

// Consumer: Process jobs
@Processor('reports')
export class ReportsProcessor {
  private readonly logger = new Logger(ReportsProcessor.name);

  @Process('generate')
  async generateReport(job: Job<GenerateReportDto>): Promise<Report> {
    this.logger.log(`Processing report job ${job.id}`);
    await job.updateProgress(10);
    const data = await this.fetchData(job.data);
    await job.updateProgress(50);
    const report = await this.processData(data);
    await job.updateProgress(90);
    await this.saveReport(report);
    await job.updateProgress(100);
    return report;
  }

  @OnQueueActive()
  onActive(job: Job) { this.logger.log(`Processing job ${job.id}`); }

  @OnQueueCompleted()
  onCompleted(job: Job) { this.logger.log(`Job ${job.id} completed`); }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }
}

// Scheduled jobs
@Injectable()
export class ScheduledJobsService implements OnModuleInit {
  constructor(@InjectQueue('maintenance') private queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'cleanup',
      {},
      {
        repeat: { cron: '0 0 * * *' },
        jobId: 'daily-cleanup',
      },
    );
  }
}

// Queue monitoring with Bull Board (optional, additional deps)
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'email',
      adapter: BullMQAdapter,
    }),
  ],
})
export class AdminModule {}
```

**Anti-patterns regardless of approach:**

```ts
// ❌ Long-running tasks blocking HTTP requests
@Post()
async generate(@Body() dto: GenerateReportDto): Promise<Report> {
  const data = await this.fetchLargeDataset(dto);
  const report = await this.processData(data); // Slow!
  await this.sendEmail(dto.email, report);     // Can fail!
  return report; // Client times out
}

// ❌ Fire-and-forget without retry on important work
@Injectable()
export class EmailService {
  async sendWelcome(email: string): Promise<void> {
    await this.mailer.send({ to: email, template: 'welcome' });
    // No retry, no tracking — important emails silently lost
  }
}

// ❌ setInterval for scheduled tasks
setInterval(async () => {
  await cleanupOldRecords();
}, 60000); // No error handling, memory leaks, runs in every replica
```

Reference: [NestJS Queues](https://docs.nestjs.com/techniques/queues)
