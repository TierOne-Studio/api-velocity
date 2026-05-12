---
title: Use Structured Logging
impact: MEDIUM-HIGH
impactDescription: Structured logging enables effective debugging and monitoring
tags: devops, logging, structured-logs, pino
---

## Use Structured Logging

Logs should be parseable, leveled, contextually rich, and aware of redaction for sensitive fields.

> ⚠️ **Approach gate (per `nestjs-best-practices/SKILL.md` "How rules are structured"):** This rule has two valid implementations. **Before writing any code, ASK the user which approach they prefer:**
>
> > "Logging can be implemented two ways:
> > - **Approach A — Custom abstraction (no new deps):** A `LoggerService` wrapping NestJS `Logger` with manual JSON formatting + `AsyncLocalStorage` for request-id correlation.
> > - **Approach B — Library:** install `nestjs-pino` (and optionally `nestjs-cls`) for high-throughput structured logging with built-in transports.
> >
> > Which approach should I use?"
>
> Wait for explicit response. Do NOT silently choose.

## Outcome

- Per-class logger with contextual fields.
- Log levels (`debug`/`log`/`warn`/`error`) used appropriately.
- Sensitive fields (passwords, tokens, PII) redacted before output.
- Request-correlation ID present on log lines for traceability.
- No `console.log` in non-bootstrap code paths.

## Approach A — Custom abstraction (no new deps)

Build a `LoggerService` that owns the policies (JSON formatting, redaction, request-id propagation). Services depend on this abstraction; if the team later adopts pino, the abstraction can swap in pino transparently.

```ts
// src/shared/infrastructure/logging/logger.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage<{ requestId: string; userId?: string }>();
export const RequestContext = requestContext;

const SENSITIVE_KEYS = /password|token|secret|api[_-]?key|authorization|cookie/i;

@Injectable()
export class LoggerService {
  private readonly logger = new Logger();

  info(message: string, ctx?: object) {
    this.logger.log(this.format('info', message, ctx));
  }
  warn(message: string, ctx?: object) {
    this.logger.warn(this.format('warn', message, ctx));
  }
  error(message: string, error: Error, ctx?: object) {
    this.logger.error(this.format('error', message, { ...ctx, stack: error.stack }));
  }
  debug(message: string, ctx?: object) {
    this.logger.debug(this.format('debug', message, ctx));
  }

  private format(level: string, message: string, ctx?: object): string {
    const requestCtx = requestContext.getStore() ?? {};
    return JSON.stringify({
      level,
      timestamp: new Date().toISOString(),
      requestId: requestCtx.requestId,
      userId: requestCtx.userId,
      message,
      ...this.redact(ctx),
    });
  }

  private redact(obj?: object): object {
    if (!obj) return {};
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : v;
    }
    return out;
  }
}
```

Set up the request-id middleware to propagate context (uses Node's built-in `AsyncLocalStorage`, no `nestjs-cls` needed):

```ts
// src/shared/infrastructure/logging/request-context.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestContext } from './logger.service';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    const userId = (req as any).session?.userId;
    res.setHeader('x-request-id', requestId);
    RequestContext.run({ requestId, userId }, () => next());
  }
}
```

Usage in services:

```ts
@Injectable()
export class UsersService {
  constructor(private readonly logger: LoggerService) {}

  async createUser(input: CreateUserInput): Promise<User> {
    this.logger.info('user.create.started', { email: input.email });
    try {
      const user = await this.repo.save(input);
      this.logger.info('user.create.success', { userId: user.id });
      return user;
    } catch (err) {
      this.logger.error('user.create.failed', err as Error, { email: input.email });
      throw err;
    }
  }
}
```

**Limitations:** no async-batched output, no pluggable transports, no measured perf gains over Logger. If those become real needs, propose Approach B.

**Anti-patterns regardless of approach:**

```ts
// ❌ console.log in production
console.log('Creating user:', dto);  // not structured, no levels, no redaction

// ❌ logging sensitive data
console.log('Login attempt:', { email, password }); // SECURITY RISK

// ❌ string concatenation
logger.log('User ' + userId + ' created at ' + new Date()); // unparseable
```

## Approach B — Library: `nestjs-pino` + `nestjs-cls` ⚠️ Adoption-gated

> ⚠️ Adopting this approach adds `nestjs-pino` (transitively `pino`) AND `nestjs-cls` (transitively `cls-hooked` or AsyncLocalStorage) to `package.json`. **Do NOT implement this section without explicit user approval naming both packages.**

```ts
// Configure logger in main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
}

// Use NestJS Logger with context
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  async createUser(dto: CreateUserDto): Promise<User> {
    this.logger.log('Creating user', { email: dto.email });

    try {
      const user = await this.repo.save(dto);
      this.logger.log('User created', { userId: user.id });
      return user;
    } catch (error) {
      this.logger.error('Failed to create user', error.stack, {
        email: dto.email,
      });
      throw error;
    }
  }
}

// Custom logger for JSON output
@Injectable()
export class JsonLogger implements LoggerService {
  log(message: string, context?: object): void {
    console.log(
      JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        message,
        ...context,
      }),
    );
  }

  error(message: string, trace?: string, context?: object): void {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        message,
        trace,
        ...context,
      }),
    );
  }

  warn(message: string, context?: object): void {
    console.warn(
      JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        message,
        ...context,
      }),
    );
  }

  debug(message: string, context?: object): void {
    console.debug(
      JSON.stringify({
        level: 'debug',
        timestamp: new Date().toISOString(),
        message,
        ...context,
      }),
    );
  }
}

// Request context logging with ClsModule
import { ClsModule, ClsService } from 'nestjs-cls';

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
      },
    }),
  ],
})
export class AppModule {}

// Middleware to set request context
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private cls: ClsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = req.headers['x-request-id'] || randomUUID();
    this.cls.set('requestId', requestId);
    this.cls.set('userId', req.user?.id);

    res.setHeader('x-request-id', requestId);
    next();
  }
}

// Logger that includes request context
@Injectable()
export class ContextLogger {
  constructor(private cls: ClsService) {}

  log(message: string, data?: object): void {
    console.log(
      JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        requestId: this.cls.get('requestId'),
        userId: this.cls.get('userId'),
        message,
        ...data,
      }),
    );
  }

  error(message: string, error: Error, data?: object): void {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        requestId: this.cls.get('requestId'),
        userId: this.cls.get('userId'),
        message,
        error: error.message,
        stack: error.stack,
        ...data,
      }),
    );
  }
}

// Pino integration for high-performance logging
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty' }
            : undefined,
        redact: ['req.headers.authorization', 'req.body.password'],
        serializers: {
          req: (req) => ({
            method: req.method,
            url: req.url,
            query: req.query,
          }),
          res: (res) => ({
            statusCode: res.statusCode,
          }),
        },
      },
    }),
  ],
})
export class AppModule {}

// Usage with Pino
@Injectable()
export class UsersService {
  constructor(private logger: PinoLogger) {
    this.logger.setContext(UsersService.name);
  }

  async findOne(id: string): Promise<User> {
    this.logger.info({ userId: id }, 'Finding user');
    // Pino uses first arg for data, second for message
  }
}
```

Reference: [NestJS Logger](https://docs.nestjs.com/techniques/logger)
