---
id: SPEC-003
title: "SPEC-003: Public web chat widget (anonymous, ask-only)"
status: Draft
layer: contract
owner: Maxi Schvindt
created: 2026-06-19
updated: 2026-06-19
feature_paths:
  - src/modules/chat
  - src/modules/embed-sites
related_adrs: [ADR-018, ADR-019]
related_specs: [SPEC-001, SPEC-002]
counterpart_spec: ""
coordination_doc: ""
---

# SPEC-003: Public web chat widget (anonymous, ask-only)

> Drafted alongside `feature/proposals/embeddable-web-chat-widget.md`. All v1
> design TBDs are resolved (§11 records the decisions). This is a high-risk
> surface (public API + new anonymous auth path) — architect review fires early
> per the high-risk workflow chain. The two structural decisions are recorded as
> **ADR-018** (anonymous public-channel auth) and **ADR-019** (per-request
> origin-allowlist CORS), both `Proposed` pending implementation.

## 1. Summary (intended behavior)

An organization can embed a chat widget on its own public websites via a pasted
`<script>` snippet. Anonymous visitors ask questions and receive answers streamed
from the chat agent, grounded on a **single project's** knowledge base (the
SPEC-001 RAG pipeline). The widget authenticates as the **site** (a publishable
per-site key + server-side origin allowlist), never as an end-user. v1 is
**stateless ask-only**: no persisted conversation history, no end-user login.
Every request is re-scoped to the embed site's `{ organizationId, projectId }`
server-side; cross-org/cross-project access is impossible by construction
(SPEC-001 invariant, sourced from the embed credential instead of a session).

## 2. Context & problem

The existing `api/chat` surface is a private, first-party channel: it requires a
better-auth session, RBAC `chat:*` scopes, a mandatory `userId`, and CORS locked
to `trustedOrigins` with credentials. None of that holds for an anonymous widget
running on customer-owned origins. SPEC-003 defines a **separate public channel**
beside the private one, reusing the chat-agent/RAG core with its own auth, CORS,
scoping, and abuse controls. See the proposal for the full rationale table.

## 3. Scope

**In scope (v1):**

- **Embed-site entity** (private, RBAC-gated): org-owned, bound **1:1 to a
  project**, with a publishable `publicKey`, an `allowedOrigins` allowlist,
  `enabled`, and optional theming config. Persistence + migration. _No_ rows for
  conversations/messages (v1 is stateless).
- **Embed-site admin API** `api/embed-sites` (list/get/create/update/delete/rotate-key),
  RBAC-gated by new `embed-site:{read,create,update,delete}` scopes. The admin
  creates the embed site and associates it with the project whose resources it
  answers from — same association model as the internal chat.
- **Public ask endpoint** `POST /api/public/chat/ask/stream`: anonymous,
  key-authenticated, origin-allowlist enforced, per-key + per-IP rate limited;
  streams an SSE answer with org+project resolved from the embed site. Stateless —
  no conversation/message rows. The reused core is
  **`ChatAgentService.generateReplyStreaming`** (it already accepts
  `conversationId: null` and persists nothing), **not** the conversation-bound
  `ChatService.sendMessageStreaming`. `ChatAgentService` is **exported from
  `ChatModule`** and imported by the public module (the cleaner extraction into a
  dedicated `chat-agent` sub-module is deferred — see §10.4, §11). The anonymous
  caller threads a fixed `userId` sentinel (`'anonymous'`) into the agent tool
  context.
- **Public source-kind policy (fail-closed allowlist):** the public channel
  resolves the project's configured data sources but retrieves **only** from a
  fixed allowlist — `PUBLIC_ALLOWED_SOURCE_KINDS = { 'airweave_collection',
  'vector_db' }`. Both the **`database`** (SQL sub-agent) and **`external`** kinds
  are excluded on this channel; any **future source kind is excluded by default**
  until explicitly admitted to the allowlist. The `database`/`external` sources
  are stripped from the `sources` array before it reaches `generateReplyStreaming`
  — which removes the tool, the routing prose, AND the keyless fallback fan-out in
  one move (all keyed on the same `kind` discriminant). The project keeps all its
  resources for the internal chat — the filter applies only on the public ask
  path. (See §6, §9.1, §10.)
- **Public auth guard**: resolves the embed site from the `X-Velocity-Embed-Key`
  header, checks `enabled`, validates request `Origin` against `allowedOrigins`,
  attaches `{ organizationId, projectId }` to the request.
- **Per-request CORS** for the `api/public/*` prefix, allowlist-driven,
  `credentials: false`, independent of `trustedOrigins`.
- **Embed script**: standalone widget bundle served by the API at a
  version-pinned URL (`/api/public/widget/v1/widget.js`); shadow-DOM UI;
  streaming client; source chips (SPEC-002 dedupe semantics); theming via
  `data-*` attributes on the script tag overriding server defaults from
  `GET /config`.

**Out of scope (v1) → Future:**

- Persisted conversations / message history for anonymous users.
- Signed per-end-user embed tokens (JWT minted by the customer backend).
- `database` (SQL) and `external` data-source access from the public channel.
- One key spanning multiple projects.
- Admin-configurable rate limits and per-site source-kind toggles.
- CDN hosting of `widget.js`.
- End-user authentication of any kind.

## 4. Public API contract

- `POST /api/public/chat/ask/stream`
  - Headers: `X-Velocity-Embed-Key: wgt_pub_…` (required); `Origin` validated
    against the site's `allowedOrigins`.
  - Body: `{ question: string }` — non-empty after trim, **max 2000 characters**.
  - Response: `text/event-stream`. Backed by
    `ChatAgentService.generateReplyStreaming` (stateless), emitting the **same
    event shapes** as `POST /api/chat/conversations/:id/messages/stream` (token
    deltas + terminal sources event), so the widget client mirrors the SPA client.
    No conversation id is involved.
  - Errors: `401` (unknown/disabled key, or missing key header), `403` (origin
    not in `allowedOrigins`), `400` (empty/oversized question), `429` (rate limit
    or org monthly cap exceeded).
- `GET /api/public/chat/config`
  - Headers: `X-Velocity-Embed-Key`; `Origin` validated. **Subject to the same
    per-key throttler** as `ask` — otherwise it is a cheap key-enumeration oracle
    (a valid key resolves a site; an invalid one 401s). The `401` message must not
    distinguish unknown vs disabled (§10.2).
  - Returns the public theming/config (color, position, greeting, …) for the
    widget to self-render. `data-*` attributes on the host `<script>` override
    these values client-side.
- **Key format & generation:** `public_key` is `wgt_pub_` + ≥128 bits of CSPRNG
  entropy, base62-encoded. Generated server-side on create/rotate; on the rare
  `UNIQUE(public_key)` collision, regenerate and retry. High entropy is what makes
  enumeration of the public index infeasible (the abuse vector ADR-018 names).
- `GET /api/public/widget/v1/widget.js`
  - Serves the version-pinned widget bundle. Major version is pinned in the
    path; cache-busted on release.

## 5. Authorization & scoping

- Public endpoints are **not** under `PermissionsGuard`; authorization is the
  embed-site key + origin allowlist.
- `organizationId` and `projectId` are **always** taken from the resolved embed
  site, never from the request body/query.
- Admin `api/embed-sites` endpoints are fully RBAC-gated; key issuance/rotation
  and allowlist edits are privileged (`embed-site:*` scopes).

## 6. Abuse, cost & data handling

- **Rate limits.** The `chat` throttler lives **inside `ChatModule`** and is not
  global, so the public module stands up **its own `ThrottlerModule`** with named
  **per-IP** and **per-key** throttlers and applies its own guard. Per-key
  throttling is **not** the default IP-keyed behaviour — it requires a custom
  `ThrottlerGuard`/`getTracker` that keys on `X-Velocity-Embed-Key`. Fixed v1
  defaults (proposed: ~10 req/min per IP, a higher per-key ceiling; tuned in code
  config). Admin self-service tuning is a Future item.
- **Cost ceiling (non-optional in v1).** The throttler caps **connection opens**,
  not streamed tokens or agent cost — one allowed connection can still drive a
  single expensive LLM call. So v1 ships a **mandatory org-level monthly request
  cap** (not off-by-default), backed by a **durable counter** (`embed_usage_counter`,
  §9.6) so it survives restarts and is correct across instances: once an org
  exceeds the cap, public `ask` returns `429` until the window resets. This is the
  hard backstop on spend; the per-IP/per-key throttlers only shape burst rate.
  (Concurrent-stream limiting per key → Future.)
- The **origin allowlist** is the primary browser-side boundary but is
  **bypassable outside browsers** (Origin is client-set) → rate limits + the
  monthly cap are load-bearing, not the allowlist alone.
- **Source-kind restriction** (fail-closed allowlist `{ airweave_collection,
  vector_db }`; `database` **and** `external` excluded; new kinds excluded by
  default) removes the anonymous-DB-query exfiltration path structurally for v1 —
  the main data-exposure concern on a public channel. See §3, §10.
- **PII:** apply the repo's redaction conventions to logged questions. v1
  persists **no transcript** (zero persistence); only standard request logs
  exist, subject to redaction. Retention follows existing log retention.
- **Deployment requirement (`TRUST_PROXY`):** the per-IP limiter keys on
  `request.ip`. Behind a load balancer / reverse proxy, set `TRUST_PROXY` to the
  number of trusted proxy hops so `request.ip` is the real client (and
  `X-Forwarded-For` spoofing is bounded). Default is `false` (direct-connection
  safe); leaving it unset behind a proxy collapses all clients into one IP bucket
  — the durable org monthly cap remains the spend backstop regardless.

## 7. Acceptance criteria

1. A `POST /ask/stream` with a valid key from an allowlisted origin streams a
   grounded answer scoped to the embed site's project; data from another org or
   another project never appears.
2. Retrieval on the public channel draws **only** from the project's
   `airweave_collection` and `vector_db` sources; a project carrying **both** a
   `database` AND an `external` source has **neither** queried via the public
   endpoint (while the internal chat still uses all of them). The allowlist is
   fail-closed: an unrecognised/new source kind is also excluded.
3. Unknown or disabled key, or missing key header → `401` (identical message for
   unknown vs disabled); valid key from a non-allowlisted origin → `403`.
4. Empty/whitespace question → `400`; question > 2000 chars → `400`; exceeding
   the per-IP or per-key rate limit → `429`; exceeding the org monthly cap →
   `429`.
4b. Origin matching is exact on a **normalised** value (scheme lowercased, host
   lowercased, default port elided, no trailing slash) — `https://Customer.com/`
   in the allowlist matches an `Origin: https://customer.com` request, and a
   bare-suffix/substring origin never matches.
5. The public endpoint requires **no** better-auth session and sets **no**
   credentialed CORS (`credentials: false`); responses carry per-request
   allowlist-driven CORS headers.
6. The public stream emits the **same event shapes** as the internal
   `messages/stream` endpoint (token deltas + terminal sources event).
7. `GET /config` returns the site's theming; `data-*` attributes on the script
   tag override the corresponding server values in the rendered widget.
8. Admin `api/embed-sites` CRUD and key rotation are rejected without the
   corresponding `embed-site:*` RBAC scope; `allowedOrigins` and `enabled`
   changes take effect on the next public request.

## 8. Verification notes

- Org/project isolation and the source-exclusion criterion (§7.1, §7.2) are
  data/RBAC-bound → integration tests vs **real Postgres** (per P8.0), plus API
  e2e (supertest) for the auth/CORS/rate-limit/streaming criteria.
- Review gates (P4): this surface touches public API + new anonymous auth + new
  RBAC scopes, so **`security-reviewer`** is mandatory alongside
  `architect-reviewer` (done — REVISE_PLAN), `code-reviewer`, and `qa-validator`.
  `acceptance-verifier` is binding on "done" for this public-API feature.

## 9. Data model & migration sketch (illustrative)

> Illustrative only — no code is shipped by this SPEC. Shapes follow the existing
> `project`/`conversation` DDL and the TypeORM entity pattern from the RBAC
> module (`role.typeorm-entity.ts`). `embed_sites` is a **new** module → TypeORM-
> first repository (ADR-001/ADR-009); DDL still ships as a custom `OnModuleInit`
> tracked migration like every other module here. No persistence of
> conversations/messages — v1 is stateless.

### 9.1 Table: `embed_site`

One row per embed site, **1:1 with a project** (`UNIQUE(project_id)`), org-scoped.
The `public_key` is a publishable **identifier, not a secret** — `wgt_pub_` + ≥128
bits CSPRNG entropy (§4), stored in clear, looked up on every public request
(hence `UNIQUE` + its own index). No secret/hash column. The source-kind allowlist
(`airweave_collection` + `vector_db`; `database`/`external` excluded) is applied at
query time on the public channel, so it needs **no** column in v1.

```sql
CREATE TABLE IF NOT EXISTS embed_site (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES project(id)       ON DELETE CASCADE,
  name            TEXT NOT NULL,
  public_key      TEXT NOT NULL,                 -- publishable site key, e.g. wgt_pub_…
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',  -- origin allowlist, exact-match
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  theme           JSONB,                          -- optional server-side theming defaults
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_embed_site_public_key ON embed_site(public_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_embed_site_project    ON embed_site(project_id);
CREATE INDEX        IF NOT EXISTS idx_embed_site_org        ON embed_site(organization_id);
```

Notes:
- `ON DELETE CASCADE` on `project_id`: deleting the project tears down its embed
  site (the widget has nothing to answer from). Matches `conversation.project_id`.
- `allowed_origins` as `TEXT[]`: small, exact-match list; membership check is a
  simple `= ANY(...)`. JSONB would be overkill.

### 9.2 Migration (custom tracked, `OnModuleInit`)

Same shape as `ChatMigrationService` — depends on `ProjectsMigrationService`
running first (FK to `project`), so `EmbedSitesModule` MUST be imported **after**
`ProjectsModule` in `app.module.ts` (the existing module-order coupling, § anti-
patterns).

```ts
// src/modules/embed-sites/embed-sites.migration.ts  (sketch)
@Injectable()
export class EmbedSitesMigrationService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly projectsMigrations: ProjectsMigrationService, // ensure `project` exists first
  ) {}

  async onModuleInit() {
    await this.projectsMigrations.runTrackedMigrations();
    await this.runTrackedMigrations();
  }

  async runTrackedMigrations(): Promise<void> {
    const migrations = [
      {
        name: 'embed_site_001_create_embed_site_table',
        up: () => this.createEmbedSiteTable(), // the DDL in §9.1
      },
    ];
    for (const m of migrations) {
      if (await this.db.hasMigrationRun(m.name)) continue;
      await m.up();
      await this.db.recordMigration(m.name);
    }
  }
}
```

### 9.3 TypeORM entity + domain type + repository port

> **As shipped (Slices 1–2):** the entity sketch below is illustrative; the
> module persists via a **raw-SQL `DatabaseService` adapter**
> (`EmbedSiteDatabaseRepository`), the ADR-001 fallback — justified by the atomic
> `INSERT … ON CONFLICT … RETURNING` usage-counter increment (§9.6) and reuse of
> the raw-SQL testcontainers harness shared with the sibling chat/projects
> modules. The clean-architecture port (`EMBED_SITE_REPOSITORY` Symbol token) is
> preserved exactly as below; only the adapter is raw-SQL rather than TypeORM.
> The port ships the two public-channel methods (Slice 1) plus the org-scoped
> admin CRUD (`findById`/`listByOrg`/`create`/`update`/`rotateKey`/`delete`,
> Slice 2).

```ts
// infrastructure/persistence/entities/embed-site.typeorm-entity.ts  (sketch)
@Entity('embed_site')
export class EmbedSiteTypeOrmEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'text' }) organizationId: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ type: 'text' }) name: string;
  @Column({ name: 'public_key', type: 'text' }) publicKey: string;
  @Column({ name: 'allowed_origins', type: 'text', array: true, default: () => "'{}'" })
  allowedOrigins: string[];
  @Column({ type: 'boolean', default: true }) enabled: boolean;
  @Column({ type: 'jsonb', nullable: true }) theme: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

```ts
// domain type (service shape) + repository port  (sketch)
export interface EmbedSite {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  publicKey: string;
  allowedOrigins: string[];
  enabled: boolean;
  theme: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IEmbedSiteRepository {
  // public-channel hot path — by key, no org context (the key resolves the org)
  findByPublicKey(publicKey: string): Promise<EmbedSite | null>;
  // admin CRUD — always org-scoped (defense in depth, per repo conventions)
  findById(id: string, organizationId: string): Promise<EmbedSite | null>;
  listByOrg(organizationId: string): Promise<EmbedSite[]>;
  create(input: CreateEmbedSiteInput): Promise<EmbedSite>;
  update(id: string, organizationId: string, patch: UpdateEmbedSiteInput): Promise<EmbedSite>;
  rotateKey(id: string, organizationId: string, newPublicKey: string): Promise<EmbedSite>;
  delete(id: string, organizationId: string): Promise<void>;
}
```

`findByPublicKey` is intentionally **not** org-scoped — the key *is* the scope
resolver for the public channel; every downstream query then uses the resolved
`organizationId`/`projectId`. All admin methods carry `organizationId` for
defense-in-depth scoping per the repo conventions.

Wire the port via a **`Symbol` injection token** (`EMBED_SITE_REPOSITORY =
Symbol('IEmbedSiteRepository')`), per ADR-009's canonical example — not a string
token. The guard (§10.2) and the admin service both depend on the **interface +
token**, never the concrete `EmbedSiteTypeOrmRepository`.

### 9.4 DTOs (admin write / response; public config)

```ts
// api/dto/embed-site.dto.ts  (sketch — plain types, no class-validator, per ADR-005)
export interface CreateEmbedSiteInput {
  name: string;
  projectId: string;
  allowedOrigins: string[];
  theme?: Record<string, unknown>;
}
export interface UpdateEmbedSiteInput {
  name?: string;
  allowedOrigins?: string[];
  enabled?: boolean;
  theme?: Record<string, unknown> | null;
}
// Admin response includes the publishable key; never any secret.
export interface EmbedSiteSummary {
  id: string; name: string; projectId: string; publicKey: string;
  allowedOrigins: string[]; enabled: boolean; createdAt: Date; updatedAt: Date;
}
// Public GET /config response — only what the widget needs to render.
export interface PublicWidgetConfig {
  theme: Record<string, unknown> | null;
}
```

### 9.5 RBAC scopes (added to the role matrix migration)

New permissions `embed-site:{read,create,update,delete}` registered in the RBAC
migration's permission catalog (`rbac_025_add_embed_site_permissions`, mirroring
the `addVectorDbPermissions` precedent). **Implemented role matrix** (decided per
the §7.8 deferral, following the airweave/vector-db delete-is-admin-only
precedent): **admin** = full CRUD; **manager** = read/create/update (**not**
delete — disposing of a public widget is admin-only); **member** = read.
Custom roles inherit additively: create/update from `organization:update`, read
from `organization:read`; **delete is NOT inheritable** (flows only to
admin/superadmin). `rotate-key` is gated on `embed-site:update` (no separate
action). The public endpoints carry **no** RBAC scope (auth is the key + origin
allowlist).

### 9.6 Table: `embed_usage_counter` (durable monthly cap)

The non-optional org monthly cap (§6) is the load-bearing spend backstop, so its
counter must be **durable and correct across restarts and instances** — an
in-memory counter would reset on every deploy and silently defeat the control.
One row per `(organization_id, window)`; the public `ask` path **atomically
increments** before the LLM call and rejects with `429` once `count >= cap`.

```sql
CREATE TABLE IF NOT EXISTS embed_usage_counter (
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  window_start    DATE NOT NULL,            -- first day of the calendar month (UTC)
  request_count   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, window_start)
);
```

- **Atomic increment** under concurrent SSE opens via upsert:
  `INSERT … ON CONFLICT (organization_id, window_start) DO UPDATE SET request_count = embed_usage_counter.request_count + 1 RETURNING request_count`,
  then compare the returned value to the cap. No read-then-write race.
- **Window reset** is implicit: a new month → a new `window_start` row; old rows
  are inert (a periodic prune is a Future cleanup, not v1-blocking).
- Increment happens at §10.1 step 3, **before** the guard's heavy work and the
  LLM call, so an over-cap org is rejected cheaply.

## 10. Public request flow — guard + CORS (illustrative)

> Illustrative only — no code shipped. Mechanics for ADR-018 (key + origin auth)
> and ADR-019 (per-request CORS). Surfaces the ordering and the preflight nuance
> that bite if left implicit.

### 10.1 Pipeline order on `POST /api/public/chat/ask/stream`

```
request
  │
  ├─ (1) CORS layer (api/public/* prefix)        ── ADR-019
  │        • preflight OPTIONS → answered here, request never reaches the guard
  │        • actual request → compute Access-Control-* from the matched origin
  │
  ├─ (2) Rate limiter (per-IP, then per-key)      ── public module's OWN ThrottlerModule
  │        • per-key tracker = custom getTracker on X-Velocity-Embed-Key
  │        • 429 on exceed; runs before LLM/DB work so abuse is cheap to reject
  │
  ├─ (3) Org monthly cap check                     ── §6 / §9.6 cost ceiling
  │        • atomic increment of embed_usage_counter; 429 once count >= cap,
  │          before any LLM call
  │
  ├─ (4) PublicEmbedGuard                          ── ADR-018
  │        • resolve site by X-Velocity-Embed-Key → enabled? origin allowed?
  │        • attach { organizationId, projectId } to req; 401 / 403 on failure
  │
  └─ (5) Controller → ChatAgentService.generateReplyStreaming
           (sources pre-filtered to {airweave_collection, vector_db}) → SSE stream
```

Why this order: CORS first so even `403/429` responses carry the right
`Access-Control-Allow-Origin` (otherwise the browser hides the error from the
widget). Rate limiting + the monthly-cap check before the guard's DB lookup *and*
before any LLM work so the cheap rejection happens first. The guard is the last
gate before the controller and is the **sole** source of
`{ organizationId, projectId }`. `GET /config` runs the same CORS + per-key
throttler (steps 1–2) so it can't be a key-enumeration oracle (§4).

The public module registers its **own `ThrottlerModule`** — the `chat` throttler
is scoped inside `ChatModule` and is not global. Per-key throttling needs a custom
`ThrottlerGuard`/`getTracker` (the default tracks by IP only).

### 10.2 The guard (sketch)

```ts
// src/modules/public-chat/api/guards/public-embed.guard.ts  (sketch)
// Lives in the public-chat module (channel-specific), not src/shared/guards/.
@Injectable()
export class PublicEmbedGuard implements CanActivate {
  constructor(private readonly embedSites: IEmbedSiteRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    const key = req.header('x-velocity-embed-key')?.trim();
    if (!key) throw new UnauthorizedException('Embed key required');      // 401

    const site = await this.embedSites.findByPublicKey(key);             // not org-scoped: key IS the scope
    if (!site || !site.enabled) throw new UnauthorizedException('Invalid embed key'); // 401, same message either way

    const origin = normalizeOrigin(req.header('origin'));  // lowercase scheme+host, elide default port, strip trailing slash
    if (!origin || !site.allowedOrigins.includes(origin)) { // allowedOrigins stored already-normalized (admin write)
      throw new ForbiddenException('Origin not allowed');                // 403
    }

    // Sole source of scope for everything downstream — never from body/query.
    (req as Request & { embedScope?: EmbedScope }).embedScope = {
      organizationId: site.organizationId,
      projectId: site.projectId,
    };
    return true;
  }
}
```

Notes:
- Unknown key and disabled key return the **same** `401` message — don't leak
  which keys exist.
- `origin` match is **exact string** against `allowed_origins` after both sides
  are normalized (scheme + host lowercased, default port elided, no trailing
  slash) — normalized **on admin write** and on the request. No suffix/substring
  matching — that's a classic CORS-bypass footgun.
- The controller reads `req.embedScope`, never a client-supplied org/project
  (the §5 invariant, enforced here).

### 10.3 Per-request CORS + the preflight nuance (sketch)

The browser's **preflight `OPTIONS`** for `POST …/ask/stream` (triggered by the
`application/json` body and the custom `X-Velocity-Embed-Key` header) **does not
carry the key** — custom headers are never sent on a preflight. So the CORS layer
**cannot resolve the embed site at preflight time**. Handle the two phases
differently:

```ts
// applied to the api/public/* prefix only — separate from main.ts enableCors
function publicCors(req, res, next) {
  const origin = req.header('origin');

  if (req.method === 'OPTIONS') {
    // Preflight: no key available. Advertise the contract; do NOT yet assert the
    // origin is allowlisted — that is enforced on the actual request by the guard.
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Velocity-Embed-Key');
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin); // reflect; omit (not '*') when absent
    res.setHeader('Access-Control-Allow-Credentials', 'false');
    res.setHeader('Access-Control-Max-Age', '600');  // cache preflight; avoid one per request on the hot path
    res.setHeader('Vary', 'Origin');
    return res.sendStatus(204);
  }

  // Actual request: the guard (10.2) is the real allowlist gate. Echo ACAO only
  // for the request's origin so an allowed widget can read the response; a
  // disallowed origin is 403'd by the guard and simply won't receive a matching
  // ACAO. credentials stays false — no cookies on this channel (ADR-019).
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'false');
    res.setHeader('Vary', 'Origin');
  }
  next();
}
```

Key points:
- Preflight is **not** an authorization decision — it only declares which methods
  and headers the actual request may use. Real enforcement is the guard on the
  actual request. A permissive preflight does **not** grant data access.
- The actual response echoes `Access-Control-Allow-Origin: <origin>` so an
  allowlisted widget can read the SSE stream; a non-allowlisted origin gets `403`
  from the guard and (correctly) no usable CORS grant.
- `credentials: false` always — this channel uses no cookies (ADR-019), so the
  dangerous `credentials: true` + reflected-origin combination cannot occur.
- `Vary: Origin` so caches don't serve one origin's CORS headers to another.
- Mechanism (Express middleware on the prefix vs a Nest interceptor/controller
  handler) is the ADR-019 follow-up, decided at implementation.

### 10.4 Reused agent core + sub-module boundary

- The streaming core is **`ChatAgentService.generateReplyStreaming`**, which
  already accepts `conversationId: null` and persists nothing — **not**
  `ChatService.sendMessageStreaming` (conversation-bound: creates user/assistant
  rows, requires a `userId`). The controller passes the project's **filtered**
  source set (allowlist `{ airweave_collection, vector_db }`) so the agent never
  builds the `query_database` tool, the SQL routing prose, or the keyless fallback
  fan-out (all keyed on the `kind` discriminant).
- To share that core without dragging `ChatController`/`ChatService`/the `chat`
  throttler into the public module, the design intent is a shared
  **`chat-agent` sub-module** that both `ChatModule` and the public module import
  (avoids the ISP violation of importing all of `ChatModule`). **Shipped in Slice
  1:** `ChatModule` simply **exports `ChatAgentService`** and `PublicChatModule`
  imports `ChatModule` — physically relocating the service would churn ~8
  co-located spec files plus `chat.service`, so the extraction is **deferred as a
  follow-up** (P3.5 — structural refactor, repo wins for this PR; rationale pinned
  in `chat.module.ts`). The ISP-cleaner relocation remains a Future task.
- The anonymous caller threads a fixed `userId` sentinel (`'anonymous'`) into the
  `AgentToolContext`. Blast radius is small: it reaches logs and the SQL sub-agent
  ctx, and SQL is excluded on this channel. Do not invent a per-visitor id (no
  persistence in v1).
- **Theme trust boundary:** `theme` (JSONB) is **org-admin-authored** (privileged
  write) and echoed to anonymous clients via `GET /config`. The widget must apply
  it only as **CSS custom properties inside the shadow DOM** — never interpolate a
  theme value into HTML or JS. Stated so the implementer treats theme as
  semi-trusted display config, not arbitrary markup.

## 11. Resolved decisions (v1)

| Topic | Decision |
|---|---|
| Key ↔ project | **Strictly 1:1**. Multi-project per key → Future. |
| Public source kinds | **Fail-closed allowlist `{ airweave_collection, vector_db }`**; `database` (SQL) **and** `external` excluded; new kinds excluded by default. Admin still creates the site and associates the project/resources as today. |
| Transcript persistence | **Zero persistence** (stateless ask-only). |
| `widget.js` hosting | **Served by the API**, version-pinned path (`/api/public/widget/v1/…`). CDN → Future. |
| Rate limits | **Per-key + per-IP** (public module's own `ThrottlerModule` + custom `getTracker` on the key), fixed defaults. Admin-configurable limits → Future. |
| Cost ceiling | **Org monthly request cap is non-optional in v1**, backed by a durable `embed_usage_counter` (§9.6, atomic increment) (`429` on exhaustion). Concurrent-stream limiting → Future. |
| Reused core / wiring | **`ChatAgentService.generateReplyStreaming`** (stateless). **Shipped:** exported from `ChatModule`, imported by `PublicChatModule`; extraction into a dedicated shared **`chat-agent` sub-module** deferred as a Future follow-up (P3.5; see §10.4). Anonymous `userId` sentinel = `'anonymous'`. |
| Theming | **`data-*` attributes + server `GET /config`**, `data-*` overrides. Theme applied as shadow-DOM CSS custom properties only (trust boundary). |
| Stream schema | **Reuse the existing chat stream events.** |
| Answer rendering (widget v1) | **Markdown**, rendered to DOM via `createElement`/`textContent` only (never `innerHTML`); links get an `href` only when `isSafeUrl` (http/https). Subset: headings, bold/italic, inline + fenced code, ordered/unordered lists, links, GFM tables — matching the platform chat. LLM output still cannot inject markup (§10.4 trust boundary holds by construction). Shipped in Slice 3; build = esbuild, browser test = Playwright (ADR-020). |
| Question max length | **2000 characters.** |
| Key format | **`X-Velocity-Embed-Key`** header; value `wgt_pub_` + ≥128-bit CSPRNG (identifier, not secret). |
| Origin matching | **Exact match on normalized origin** (lowercased scheme+host, default port elided, no trailing slash); normalized on admin write + request. |

## 12. Open questions (deferred, not blocking v1)

- Exact rate-limit numeric defaults (per-IP/min, per-key ceiling, monthly cap) —
  tune during implementation/hardening.
- ~~Whether `GET /config` is a real endpoint or inlined into the bundle to save a
  round-trip.~~ **Resolved (Slice 3):** shipped as a **real endpoint**
  (`GET /api/public/chat/config`) on the public-chat controller, behind the same
  per-key throttler + embed guard + per-request CORS as `ask`, so an admin theme
  change takes effect without re-issuing the bundle. See §4, ADR-020.
- ~~The CORS mechanism on the public prefix — scoped middleware/guard vs
  controller-level handler.~~ **Resolved (Slice 1/3):** Express-style
  `PublicCorsMiddleware` on the `api/public/*` prefix for the keyless preflight
  (now advertising `GET, POST, OPTIONS`), with the actual-request `ACAO` emitted by
  `PublicEmbedGuard` only after the origin matches (ADR-019).

## 13. Implementation plan (sliced, risk-first)

> Added per `architect-reviewer` (REVISE_PLAN finding #4): the SPEC is the
> contract; this is the build plan. Each slice ships behind its own P4 gates.

**Slicing strategy:** contract-first (Slice 0 = this SPEC, done) → **risk-first**.
The novel, unproven surface is the anonymous auth + per-request CORS + fail-closed
source filter on a streaming endpoint — prove that end-to-end **first**, before
the low-risk admin CRUD breadth. A vertical-by-feature order (admin CRUD first)
would defer the risk and is explicitly rejected here.

**Mandatory skills for the build turns:** `tdd-workflow`, `failure-mode-analysis`
(before each failing test), `repo-conventions`, `nestjs-clean-architecture` (new
domain module), `async-error-handling` (SSE + external LLM I/O). `database-
transactions` is N/A — admin writes are single-statement.

**Reviewers per PR (P4):** `architect-reviewer` (done) → `code-reviewer` +
`qa-validator` + **`security-reviewer`** (mandatory: anonymous auth + RBAC) →
`acceptance-verifier` (binding). On merge, flip ADR-018/ADR-019 Proposed→Accepted
and update `docs/decisions/README.md`.

### Dependency graph

```
embed_site migration ─┬─→ TypeORM entity + repo port/adapter (Symbol token)
                      │        │
                      │        ├─→ EmbedSitesService ─→ admin controller + RBAC scopes (rbac.migration.ts)   [Slice 2]
                      │        │
                      │        └─→ PublicEmbedGuard ─┐
                      │                              ├─→ public controller ─→ ChatAgentService (shared sub-module)  [Slice 1]
       per-request CORS + own ThrottlerModule ───────┘        │
                                                     org monthly-cap check ──┘
export ChatAgentService from ChatModule (relocation deferred, §10.4) ─────────→ (prereq of Slice 1)
widget bundle (standalone build) ────────────────────────────────────────────→ [Slice 3, own PR]
```

### Slices

- **Slice 1 — Public ask channel (the risk).** `embed_site` + `embed_usage_counter`
  migrations + entity + repo (port + Symbol token + `findByPublicKey`); export
  `ChatAgentService` from `ChatModule` for reuse (dedicated `chat-agent` sub-module
  extraction deferred — P3.5, see §10.4); `PublicEmbedGuard`;
  per-request CORS; public module's own `ThrottlerModule` (+ custom per-key
  `getTracker`); durable org monthly-cap (atomic upsert-increment, §9.6);
  `POST /api/public/chat/ask/stream` wired to `generateReplyStreaming` with the
  fail-closed source allowlist.
  - `files:` `src/modules/embed-sites/**` (entities, migrations incl.
    `embed_usage_counter`, repo), `src/modules/chat/chat.module.ts` (export
    `ChatAgentService`; relocation deferred per §10.4), `src/modules/public-chat/**` (guard in `api/guards/`, cors,
    throttler, controller), `app.module.ts` (import order after Projects).
  - `verify:` integration vs real Postgres — (a) valid key + allowlisted origin
    streams a project-scoped answer; (b) project with `database`+`external` sources
    has neither queried (§7.2); (c) cross-org/cross-project never leaks; (d) **cap
    holds across a simulated restart and under a concurrent burst** — the counter is
    durable (§9.6) and the atomic increment has no read-then-write race; e2e
    (supertest) — 401/403/400/429 matrix (§7.3–7.4, incl. over-cap 429), no-session +
    `credentials:false` (§7.5), same stream events (§7.6), normalized-origin match
    (§7.4b).
  - `slice:` end-to-end vertical through the riskiest surface; no admin UI yet
    (seed an `embed_site` row directly in the test).

- **Slice 2 — Admin surface.** `EmbedSitesService` + `api/embed-sites` CRUD +
  rotate-key (key generation: `wgt_pub_` + ≥128-bit CSPRNG, collision-retry) +
  RBAC scopes `embed-site:{read,create,update,delete}` in `rbac.migration.ts` +
  role-matrix mapping; origin normalization on write.
  - `verify:` e2e — CRUD happy paths; **negative RBAC test** (different-org user →
    403, per repo-conventions §3); rotate-key invalidates the old key on the public
    channel; `enabled:false` → public `ask` 401.
  - `slice:` breadth on the now-proven foundation.

- **Slice 3 — Widget bundle (own PR).** Standalone vanilla-TS build target,
  shadow-DOM UI, streaming client, source chips, `data-*` + `/config` theming
  (CSS-custom-properties only). Served at `/api/public/widget/v1/widget.js`.
  - `verify:` browser/Playwright — snippet renders, asks, streams an answer
    against a seeded embed site from an allowlisted origin; rejected from a
    non-allowlisted origin.
  - `slice:` separate deliverable from the API; does not gate Slice 1/2 reviews.
