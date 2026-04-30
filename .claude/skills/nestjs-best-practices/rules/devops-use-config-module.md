---
title: Use ConfigModule for Environment Configuration
impact: LOW-MEDIUM
impactDescription: Proper configuration prevents deployment failures
tags: devops, configuration, environment, validation
---

## Use ConfigModule for Environment Configuration

Environment configuration is centralized, validated at startup, and accessed via a typed service rather than raw `process.env` reads scattered through the codebase.

> ⚠️ **Approach gate (per `nestjs-best-practices/SKILL.md` "How rules are structured"):** This rule has two valid implementations. **Before writing any code, ASK the user which approach they prefer:**
>
> > "Environment configuration can be implemented two ways:
> > - **Approach A — Custom abstraction (no new deps; ALREADY in this repo):** A custom `ConfigService` (`src/shared/config/config.service.ts`) that reads `process.env` once at construction and exposes typed getters with validation that throws on missing required vars.
> > - **Approach B — Library:** install `@nestjs/config` + `joi` for `ConfigModule.forRoot({ validationSchema })`, namespaced configs via `registerAs`, and `ConfigService.get()`.
> >
> > Which approach should I use?"
>
> Wait for explicit response. Do NOT silently choose. **In this repo, Approach A already exists** — the typical answer is "use the existing `ConfigService`."

## Outcome

- All env-var reads go through a single typed accessor; no `process.env` scattered through services.
- Required env vars are validated at startup; the app fails fast on misconfiguration.
- Type-safe access from consumers (no `string | undefined` bleeding through).
- Per-environment files supported (`.env`, `.env.test`, etc.).

## Approach A — Custom abstraction (already exists in this repo)

This repo's `ConfigService` (`src/shared/config/config.service.ts`) is the established pattern. Use it.

```ts
// src/shared/config/config.service.ts (already exists)
@Injectable()
export class ConfigService {
  private readonly authSecret: string;
  private readonly databaseUrl: string;
  // ...

  constructor() {
    this.authSecret = this.requireEnv('AUTH_SECRET');
    this.databaseUrl = this.requireEnv('DATABASE_URL');
    // ...
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} environment variable is required`);
    }
    return value;
  }

  getAuthSecret(): string { return this.authSecret; }
  getDatabaseUrl(): string { return this.databaseUrl; }
  // ...
}
```

Consumers:

```ts
@Injectable()
export class DatabaseModuleProvider {
  constructor(private readonly cfg: ConfigService) {}

  createPool(): Pool {
    return new Pool({ connectionString: this.cfg.getDatabaseUrl() });
  }
}
```

**Pros:**
- Zero new deps
- Validation logic is plain TypeScript — easy to read
- Throws on first missing env var at startup (fail-fast)
- Compatible with existing repo patterns (follows the established convention)

**To add a new env var:**
1. Add a `requireEnv(...)` line in the constructor
2. Add a typed getter
3. Add the var to `.env.example`

For optional env vars with defaults:

```ts
private optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

constructor() {
  this.port = parseInt(this.optionalEnv('PORT', '3000'), 10);
}
```

**Anti-patterns regardless of approach:**

```ts
// ❌ process.env scattered through services
@Injectable()
export class DatabaseService {
  constructor() {
    this.connection = new Pool({
      host: process.env.DB_HOST,                  // No validation
      port: parseInt(process.env.DB_PORT),        // NaN if missing
      password: process.env.DB_PASSWORD,          // undefined if missing
    });
  }
}

// ❌ Typo silently fails
const apiKey = process.env.SENDGRID_API_KY || 'default'; // Misspelled, fallback to 'default' in prod
```

## Approach B — Library: `@nestjs/config` + `joi` ⚠️ Adoption-gated

> ⚠️ Adopting this approach adds `@nestjs/config` AND `joi` to `package.json`. **Do NOT implement this section without explicit user approval naming both packages.** This repo already has a working custom `ConfigService` — Approach B is only worth adopting if you need namespaced configs, complex schema validation, or multi-file env loading.

```typescript
// Setup validated configuration
import { ConfigModule, ConfigService, registerAs } from '@nestjs/config';
import * as Joi from 'joi';

// config/database.config.ts
export const databaseConfig = registerAs('database', () => ({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
}));

// config/app.config.ts
export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  environment: process.env.NODE_ENV || 'development',
  apiPrefix: process.env.API_PREFIX || 'api',
}));

// config/validation.schema.ts
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  REDIS_URL: Joi.string().uri().required(),
});

// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Available everywhere without importing
      load: [databaseConfig, appConfig],
      validationSchema,
      validationOptions: {
        abortEarly: true, // Stop on first error
        allowUnknown: true, // Allow other env vars
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get('database.port'),
        username: config.get('database.username'),
        password: config.get('database.password'),
        database: config.get('database.database'),
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class AppModule {}

// Type-safe configuration access
export interface AppConfig {
  port: number;
  environment: 'development' | 'production' | 'test';
  apiPrefix: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

// Type-safe access
@Injectable()
export class AppService {
  constructor(private config: ConfigService) {}

  getPort(): number {
    return this.config.get<number>('app.port');
  }

  getDatabaseConfig(): DatabaseConfig {
    return this.config.get<DatabaseConfig>('database');
  }
}

// Inject namespaced config directly
@Injectable()
export class DatabaseService {
  constructor(
    @Inject(databaseConfig.KEY)
    private dbConfig: ConfigType<typeof databaseConfig>,
  ) {
    const host = this.dbConfig.host; // string
    const port = this.dbConfig.port; // number
  }
}

// Environment files support
ConfigModule.forRoot({
  envFilePath: [
    `.env.${process.env.NODE_ENV}.local`,
    `.env.${process.env.NODE_ENV}`,
    '.env.local',
    '.env',
  ],
});
```

Reference: [NestJS Configuration](https://docs.nestjs.com/techniques/configuration)
