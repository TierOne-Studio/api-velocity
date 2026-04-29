# NestJS Factory Providers

When `useClass:` (or just constructor injection) is not enough — because creation needs runtime values, awaited setup, or composition of other providers — NestJS gives you `useFactory:`. This file encodes the decision points and the failure modes the model commonly trips on.

## When this pattern applies

- A provider's concrete type is selected at runtime (env var, feature flag, tenant config).
- A provider needs `await` during construction (DB pool, Redis client, secret-manager fetch).
- One provider value is computed from several others (e.g., a config object built from `ConfigService` + `EncryptionService`).
- A third-party SDK requires options that are themselves derived from injected services.

## When this pattern does NOT apply

- Plain class with constructor-injected deps → use `useClass:` (or omit and let Nest infer):
  ```ts
  // Just register the class. No factory needed.
  providers: [MyService]
  ```
- Static config object known at module-definition time → use `useValue:`:
  ```ts
  providers: [{ provide: 'API_BASE_URL', useValue: 'https://api.example.com' }]
  ```
- Method-level parameterization → that's a function argument, not a provider.

## The four `use*` forms (decision tree)

| Form | When | Output |
|---|---|---|
| `useClass:` | Class with constructor-injected deps; no special construction | Nest instantiates the class |
| `useValue:` | Static value known at module-definition time | The value is the provider |
| **`useFactory:`** | **Anything dynamic, async, or composed** | The function's return value is the provider |
| `useExisting:` | Alias one token to another existing provider | Same instance, different token |

## Canonical patterns

### 1. Env-driven concrete selection (sync)

```ts
// src/modules/email/email.module.ts
@Module({
  providers: [
    {
      provide: 'EMAIL_SENDER',
      useFactory: (cfg: ConfigService): EmailSender =>
        cfg.get('NODE_ENV') === 'production'
          ? new ResendEmailSender(cfg.get('RESEND_API_KEY')!)
          : new ConsoleEmailSender(),
      inject: [ConfigService],
    },
  ],
  exports: ['EMAIL_SENDER'],
})
export class EmailModule {}
```

**Anti-pattern (model often writes this):**
```ts
// Hand-rolled — bypasses DI; ConfigService is read at module-load time, not at injection time
const sender = process.env.NODE_ENV === 'production'
  ? new ResendEmailSender(process.env.RESEND_API_KEY!)
  : new ConsoleEmailSender()

@Module({ providers: [{ provide: 'EMAIL_SENDER', useValue: sender }] })
```

### 2. Async initialization

```ts
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: async (cfg: ConfigService): Promise<RedisClient> => {
        const client = createClient({ url: cfg.get('REDIS_URL') })
        await client.connect()  // fail fast at module bootstrap, not on first use
        return client
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
```

`useFactory` accepts an `async` function. Nest awaits it during application bootstrap — if it throws, the app fails to start (fail-fast, per CLAUDE.md P5).

### 3. Composition of multiple providers

```ts
{
  provide: 'STRIPE_CLIENT',
  useFactory: (cfg: ConfigService, logger: AuditLogger): Stripe => {
    const stripe = new Stripe(cfg.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-11-20.acacia' })
    stripe.on('request', e => logger.info('stripe.request', { id: e.request_id }))
    return stripe
  },
  inject: [ConfigService, AuditLogger],
}
```

The `inject:` array order MUST match the factory's parameter order. Off-by-one here means undefined deps at runtime — a common LLM mistake.

### 4. Combining factory with dynamic-module `forRootAsync` (consumer-controlled)

When *you* are the module author and want the consumer to provide config:

```ts
// In your library/module:
export class FeatureModule {
  static forRootAsync(opts: {
    useFactory: (...args: any[]) => FeatureConfig | Promise<FeatureConfig>
    inject?: any[]
  }): DynamicModule {
    return {
      module: FeatureModule,
      providers: [{ provide: 'FEATURE_CONFIG', useFactory: opts.useFactory, inject: opts.inject ?? [] }],
      exports: ['FEATURE_CONFIG'],
    }
  }
}

// Consumer:
FeatureModule.forRootAsync({
  useFactory: (cfg: ConfigService) => ({ apiUrl: cfg.get('FEATURE_URL') }),
  inject: [ConfigService],
})
```

(See [dynamic-modules.md](dynamic-modules.md) for the full dynamic-module pattern.)

## Common LLM mistakes (catch these in `code-reviewer`)

1. **Forgetting `inject:`** — silently passes `undefined` for every parameter.
   ```ts
   // ❌ deps are undefined at call time
   { provide: 'X', useFactory: (cfg: ConfigService) => new X(cfg.get('Y')) }
   // ✅
   { provide: 'X', useFactory: (cfg: ConfigService) => new X(cfg.get('Y')), inject: [ConfigService] }
   ```

2. **Using `useFactory` for static values** — over-engineering.
   ```ts
   // ❌ a useFactory that takes no inject and returns a literal is just useValue
   { provide: 'TIMEOUT_MS', useFactory: () => 30000 }
   // ✅
   { provide: 'TIMEOUT_MS', useValue: 30000 }
   ```

3. **Reading `process.env` inside the factory** — works but bypasses `ConfigService`'s validation/typing.
   ```ts
   // ❌ no validation, no typing, untestable
   { provide: 'X', useFactory: () => new X(process.env.URL!) }
   // ✅
   { provide: 'X', useFactory: (cfg: ConfigService) => new X(cfg.get('URL')!), inject: [ConfigService] }
   ```

4. **Sync `useFactory` returning a Promise** — works but obscures the async-bootstrap dependency. Use an `async` factory so it's explicit.

5. **Side-effect-only factory** — if the factory's purpose is bootstrapping and there's no useful return value, that work belongs in `OnModuleInit`, not in a provider. (The repo's migration services use `OnModuleInit` correctly — see `*.migration.ts` files.)

## Cross-references

- [dynamic-modules.md](dynamic-modules.md) — for `forRoot`/`forRootAsync` consumer APIs.
- [provider-scopes.md](provider-scopes.md) — factories return per-resolution values when scope is non-default.
- `repo-conventions` § "Stack at a glance" — uses `ConfigService` for env var access.
- `nestjs-best-practices` § DI rules (`di-prefer-constructor-injection`, `di-use-interfaces-tokens`).
- `CLAUDE.md` P5 fail-fast — async factories should throw on bad config rather than defer.
