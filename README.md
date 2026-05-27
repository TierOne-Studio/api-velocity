# api-velocity

A production-ready **NestJS 11** API with **Better Auth**, **RBAC**, **multi-tenant organizations**, **AI chat (LangChain + OpenAI)**, **Airweave knowledge ingestion**, and **PostgreSQL** persistence.

Companion frontend: **[spa-velocity](../spa-velocity)** (sibling directory).

---

## Table of Contents

- [Onboarding](#onboarding)
- [AI Assistant Tooling (Ruler)](#ai-assistant-tooling-ruler)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Modules](#modules)
- [Persistence](#persistence)
- [Authentication & RBAC](#authentication--rbac)
- [API Endpoints](#api-endpoints)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [ADRs](#adrs)
- [Companion Frontend](#companion-frontend)
- [Technology Stack](#technology-stack)

---

## Onboarding

This is a **NestJS REST API** that backs the **spa-velocity** React SPA. The two repos are designed to be cloned as siblings:

```
~/Repositories/Github/
├── api-velocity/   ← this repo (backend, port 3000)
└── spa-velocity/   ← React SPA (frontend, port 5173)
```

### What this API gives you

- **Identity** — email/password auth, email verification, password reset, JWT-bearer sessions (no cookies in the SPA path).
- **Authorization** — 3-role platform RBAC (admin / manager / member) + per-resource permissions + org-scoped membership roles.
- **Multi-tenancy** — organizations, members, invitations; admin can impersonate org members.
- **Chat** — org-scoped AI chat backed by LangChain + OpenAI; conversations, messages, streaming.
- **Projects & SQL Connections** — workspace/project CRUD with external SQL datasource references.
- **Airweave** — managed RAG/knowledge ingestion via `@airweave/sdk`; collections + OAuth source connections, ownership locked to org metadata (ADR-011).

### Where to start reading

1. `src/main.ts` — bootstrap, CORS, port.
2. `src/auth.ts` — Better Auth wiring (plugins, hooks, trustedOrigins).
3. `src/modules/<domain>/` — one module per domain; each follows the api → application → domain → infrastructure layering from ADR-009.
4. `docs/decisions/` — load-bearing ADRs (see [ADRs](#adrs)).
5. `.ruler/` — single source of truth for AI-coding-assistant guidance (see [AI Assistant Tooling](#ai-assistant-tooling-ruler)).

---

## AI Assistant Tooling (Ruler)

This repo uses **[Ruler](https://github.com/intellectronica/ruler)** (`@intellectronica/ruler`) as the single source of truth for AI-coding-assistant guidance. The canonical files live in `.ruler/`; the per-assistant files in the repo root (`CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `.codex/config.toml`) are **generated artifacts** — do not hand-edit them.

### Why it matters

Multiple AI assistants are used in this codebase (Claude Code, GitHub Copilot, Codex, Cursor, Windsurf). Ruler keeps their instructions, skills, and review-subagent definitions identical so behavior is reproducible regardless of which tool the contributor is using.

### Layout

```
.ruler/
├── instructions.md     # Master operating profile (priority order P0–P9, skill pointers, workflow chains)
├── ruler.toml          # Which assistants to compile for, agent/skill toggles, MCP servers
├── skills/             # Domain skill bundles (one folder per skill with SKILL.md + helpers)
├── agents/             # Review subagents — architect-reviewer, code-reviewer, qa-validator,
│                       #   security-reviewer, lessons-curator
└── tests/              # Acceptance / simulation scripts that exercise the prompts
```

### Generated outputs

`ruler.toml` declares the compile targets:

| Assistant | Output file(s) |
|---|---|
| Claude Code | `CLAUDE.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| OpenAI Codex CLI | `AGENTS.md` + `.codex/config.toml` |
| Cursor | `AGENTS.md` |
| Windsurf | `AGENTS.md` |

### Regenerate

```bash
npx ruler apply              # rebuild all enabled assistants
npx ruler apply --verbose    # show what changed
```

### Workflow

1. Edit `.ruler/instructions.md`, a skill in `.ruler/skills/<name>/`, or an agent in `.ruler/agents/`.
2. Run `npx ruler apply`.
3. Commit BOTH the `.ruler/` source change AND the regenerated `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` / `.codex/config.toml`. They must stay in sync.

If a PR only shows changes to `CLAUDE.md` (and not the matching `.ruler/` source), it's almost certainly a missed regen — re-run `npx ruler apply` after editing `.ruler/`.

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20.x
- **npm** ≥ 10.x
- **PostgreSQL** ≥ 14.x

### 1. Clone both repos as siblings

```bash
cd ~/Repositories/Github
git clone <api-velocity-url> api-velocity
git clone <spa-velocity-url> spa-velocity
```

### 2. Install

```bash
cd api-velocity
npm install
```

### 3. Create the database

```bash
createdb api_velocity
```

### 4. Run the initial schema

```bash
psql -d api_velocity -f src/shared/infrastructure/database/migrations/001_initial_schema.sql

# Optional: seed the test admin (delivered+e2e-test-user@resend.dev / password123)
psql -d api_velocity -f src/shared/infrastructure/database/migrations/002_create_test_admin.sql
```

Per-module migrations (RBAC, chat, projects, sql-connections) run automatically on startup via TypeScript migration runners — no manual step needed.

### 5. Configure environment

Create `.env`:

```env
# Required
DATABASE_URL=postgresql://<user>@localhost:5432/api_velocity
AUTH_SECRET=replace-with-32+-char-secret

# Frontend integration (defaults to localhost:5173)
TRUSTED_ORIGINS=http://localhost:5173,http://localhost:5174
FE_URL=http://localhost:5173

# Optional — Email (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxxx
FROM_EMAIL=noreply@example.com

# Optional — Chat / LangChain
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
CHAT_SYSTEM_PROMPT_PATH=./prompts/system.md

# Optional — Airweave
AIRWEAVE_API_KEY=...
AIRWEAVE_BASE_URL=https://api.airweave.ai
```

See [Environment Variables](#environment-variables) for the full list.

### 6. Run

```bash
npm run start:dev   # hot-reload on port 3000
```

### 7. Verify

```bash
curl http://localhost:3000/api/auth/ok
# → {"ok":true}
```

---

## Architecture

### Layout

```
src/
├── main.ts                              # Bootstrap (port, CORS, body parser)
├── app.module.ts                        # Root module
├── auth.ts                              # Better Auth config (protected boundary)
├── permissions.ts                       # Static permission catalog
│
├── shared/                              # Cross-cutting
│   ├── config/                          # ConfigService (env access)
│   ├── email/                           # EmailService (Resend)
│   ├── guards/                          # RolesGuard, PermissionsGuard
│   ├── decorators/                      # @Roles, @RequirePermissions
│   └── infrastructure/database/         # TypeORM config, DatabaseService, raw-SQL migrations
│
└── modules/
    ├── admin/                           # Platform administration
    │   ├── users/                       # User CRUD, roles, ban, password
    │   ├── sessions/                    # Session list / revoke
    │   ├── organizations/               # Org CRUD, members, impersonation
    │   ├── rbac/                        # Roles, permissions, role assignment (@Global)
    │   └── dashboard/                   # Admin-only aggregates
    │
    ├── airweave/                        # Knowledge collections + OAuth source connections
    ├── chat/                            # Org-scoped AI chat (LangChain + OpenAI)
    ├── projects/                        # Project / workspace CRUD
    └── sql-connections/                 # External SQL datasource references
```

### Per-module layering (ADR-009)

Each domain module follows:

```
<module>/
├── api/                   # NestJS controllers + DTOs (presentation)
├── application/           # Services (use-cases)
├── domain/                # Entities, repository ports, invariants
└── infrastructure/        # Repository adapters (TypeORM or raw SQL)
```

This is the conventional shape — see `nestjs-clean-architecture` skill for the dependency rule. Flat modules without business invariants (e.g. `admin/dashboard`) skip it.

### Bootstrap (`src/main.ts`)

- Port: `PORT` env (default `3000`)
- `bodyParser: false` — Better Auth handles raw bodies for its routes; downstream NestJS controllers use module-local parsing where needed.
- CORS: dynamic origins from `ConfigService.getTrustedOrigins()` (defaults include `localhost:5173`, `localhost:5174` and `127.0.0.1` variants).

---

## Modules

| Module | Route prefix | Responsibility |
|---|---|---|
| `admin/users` | `/api/admin/users` | User CRUD, role changes, ban/unban, password set, bulk delete |
| `admin/sessions` | nested under users | List user sessions, revoke single / all |
| `admin/organizations` | `/api/platform-admin/organizations` | Cross-org admin view; members; impersonation entry |
| `admin/rbac` | `/api/rbac` | Roles, permissions, role-permission assignment |
| `admin/dashboard` | `/api/admin/dashboard` | Admin aggregates / counts |
| `airweave` | `/api/airweave` | Airweave collections + OAuth source connections (ADR-011) |
| `chat` | `/api/chat` | Conversations, messages, streaming completions |
| `projects` | `/api/projects` | Project / workspace CRUD |
| `sql-connections` | `/api/sql-connections` | External SQL datasource references |

---

## Persistence

**Pattern: TypeORM-first with raw-SQL fallback (ADR-001).**

- **TypeORM** is the default for new domain entities. RBAC uses TypeORM entities (`role.typeorm-entity.ts`, `permission.typeorm-entity.ts`).
- **Raw SQL** is used for the Better Auth core tables (`user`, `session`, `account`, `verification`, `jwks`, `organization`, `member`, `invitation`) and any query where ORM ergonomics outweigh the benefit. Raw SQL goes through `DatabaseService.query<T>()`.

### Migrations

| Layer | Location | Run by |
|---|---|---|
| Better Auth schema | `src/shared/infrastructure/database/migrations/*.sql` | manual `psql -f` once |
| Per-module schema | `src/modules/<module>/<module>.migration.ts` | auto on app startup |
| RBAC seed (roles + permissions) | `src/modules/admin/rbac/rbac.migration.ts` | auto on app startup |

There is no `typeorm migration:run` step in normal operation — bootstrap runs the per-module TS migrators idempotently.

---

## Authentication & RBAC

### Better Auth plugins

`src/auth.ts` mounts these plugins:

| Plugin | Purpose |
|---|---|
| `bearer()` | Bearer token auth (SPA stores in `localStorage`) |
| `jwt()` | JWT token issuance |
| `openAPI()` | Auth-routes OpenAPI surface |
| `organization()` | Multi-tenant orgs, members, invitations |
| `admin()` | Admin operations (impersonation, ban, listUsers) |

Email verification is enabled by default and disabled when `NODE_ENV=test`. Password-reset and invitation emails are sent via Resend.

### Unified 3-role model

| Role | Scope | Description |
|---|---|---|
| **admin** | global | Platform administrator, full access |
| **manager** | organization | Org-scoped admin within their org |
| **member** | organization | Basic read access |

- **Platform role**: `user.role` column.
- **Org role**: `member.role` column.

### Permission matrix (defaults)

| Permission | admin | manager | member |
|---|:---:|:---:|:---:|
| user:create | ✓ | – | – |
| user:read | ✓ | ✓ | ✓ |
| user:update | ✓ | ✓ | – |
| user:delete | ✓ | – | – |
| user:ban | ✓ | ✓ | – |
| user:impersonate | ✓ | – | – |
| user:set-role | ✓ | – | – |
| session:read | ✓ | ✓ | – |
| session:revoke | ✓ | ✓ | – |
| organization:create | ✓ | – | – |
| organization:read | ✓ | ✓ | ✓ |
| organization:update | ✓ | ✓ | – |
| organization:delete | ✓ | – | – |
| organization:invite | ✓ | ✓ | – |
| role:create / update / delete / assign | ✓ | – | – |
| chat:* / project:* / airweave:* | ✓ | ✓ | scoped |

Permission catalog lives in `src/permissions.ts`. The RBAC migration seeds these at boot.

### Protecting routes

```typescript
@Controller('api/admin/users')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles('admin', 'manager')
export class AdminUsersController {
  @Get()
  @RequirePermissions('user:read')
  listUsers() { /* ... */ }
}
```

Org-scope checks (the asks-first dependency gate, ADR-006) happen early in the controller layer and return 400 on scope denial (ADR-002) rather than 403.

### Airweave ownership (ADR-011)

Airweave collections and OAuth source connections are owned by the organization. Ownership is enforced by an org-metadata allowlist; `AIRWEAVE_READ_LOCKDOWN_ENFORCE` controls strictness:

| Env | Default |
|---|---|
| dev / staging | `true` (enforce) |
| prod | `false` (legacy compatibility) |

---

## API Endpoints

### Auth (`/api/auth`) — served by Better Auth

| Method | Endpoint | Description |
|---|---|---|
| POST | `/sign-up/email` | Register |
| POST | `/sign-in/email` | Login |
| POST | `/sign-out` | Logout |
| GET | `/get-session` | Current session |
| POST | `/verify-email` | Verify email |
| POST | `/forget-password` | Request reset |
| POST | `/reset-password` | Reset password |
| GET | `/token` | Issue JWT |
| GET | `/ok` | Health check |

### Organization (`/api/auth/organization`)

| Method | Endpoint |
|---|---|
| POST | `/create` |
| GET | `/list` |
| POST | `/invite-member` |
| POST | `/accept-invitation` |
| POST | `/reject-invitation` |
| DELETE | `/remove-member` |

### Admin — Users (`/api/admin/users`)

| Method | Endpoint | Required role |
|---|---|---|
| GET | `/` (paginated, searchable) | admin, manager |
| GET | `/me/approval-status` | any authenticated |
| GET | `/create-metadata` | admin, manager |
| GET | `/:userId/capabilities` | admin, manager |
| POST | `/` | admin, manager |
| PUT | `/:userId` | admin, manager |
| PUT | `/:userId/role` | admin, manager |
| POST | `/:userId/ban` | admin, manager |
| POST | `/:userId/unban` | admin, manager |
| POST | `/:userId/password` | admin, manager |
| DELETE | `/:userId` | admin, manager |
| POST | `/bulk-delete` | admin, manager |
| GET | `/:userId/sessions` | admin, manager |
| POST | `/sessions/revoke` | admin, manager |
| POST | `/:userId/sessions/revoke-all` | admin, manager |

### Admin — Organizations (`/api/platform-admin/organizations`)

| Method | Endpoint | Required role |
|---|---|---|
| GET | `/` (paginated) | admin, manager |
| GET | `/:id` | admin, manager |
| PUT | `/:id` | admin, manager |
| DELETE | `/:id` | admin |
| GET | `/:id/members` | admin, manager |
| POST | `/:orgId/impersonate` | admin, manager |
| POST | `/stop-impersonating` | any |

### Admin — Dashboard (`/api/admin/dashboard`)

| Method | Endpoint |
|---|---|
| GET | `/` (aggregate counts and recent activity) |

### RBAC (`/api/rbac`)

| Method | Endpoint | Required role |
|---|---|---|
| GET | `/roles` | any |
| POST | `/roles` | admin |
| PUT | `/roles/:id` | admin |
| DELETE | `/roles/:id` | admin |
| GET | `/permissions` | any |
| PUT | `/roles/:id/permissions` | admin |

### Airweave (`/api/airweave`)

| Method | Endpoint | Required permission |
|---|---|---|
| GET | `/collections` | airweave:read |
| POST | `/collections` | airweave:create |
| GET | `/collections/:readableId` | airweave:read |
| PUT | `/collections/:readableId` | airweave:update |
| DELETE | `/collections/:readableId` | airweave:delete |
| GET | `/collections/:readableId/source-connections` | airweave:read |
| POST | `/collections/:readableId/source-connections` | airweave:create |
| DELETE | `/collections/:readableId/source-connections/:id` | airweave:delete |
| POST | `/oauth/session` | airweave:create (short-lived widget session token) |

### Chat (`/api/chat`)

| Method | Endpoint |
|---|---|
| GET | `/conversations` |
| POST | `/conversations` |
| GET | `/conversations/:id` |
| DELETE | `/conversations/:id` |
| POST | `/conversations/:id/messages` (streamed completion) |

### Projects (`/api/projects`) and SQL Connections (`/api/sql-connections`)

Standard CRUD; see the corresponding `<module>/api/controllers/` for full surface.

---

## Environment Variables

Read by `src/shared/config/config.service.ts`.

| Variable | Required | Default | Purpose |
|---|:---:|---|---|
| `DATABASE_URL` | ✓ | — | PostgreSQL connection string |
| `AUTH_SECRET` | ✓ | — | Better Auth signing secret (≥32 chars) |
| `PORT` | – | `3000` | HTTP port |
| `BASE_URL` | – | `http://localhost:3000` | Public API URL used in emails |
| `TRUSTED_ORIGINS` | – | `localhost:5173,5174` (+127.0.0.1) | CORS allowlist (comma-separated) |
| `FE_URL` | – | `http://localhost:5173` | Frontend URL for email callback links |
| `NODE_ENV` | – | `development` | `test` disables email verification |
| `RESEND_API_KEY` | – | — | Resend API key (emails fail silently if absent) |
| `FROM_EMAIL` | – | `noreply@example.com` | Sender address |
| `ENFORCE_RESEND_TEST_RECIPIENTS` | – | auto | `true`/`false` to override Resend test-recipient guardrail |
| `OPENAI_API_KEY` | – | — | LLM key for `chat/` module |
| `OPENAI_MODEL` | – | `gpt-4o-mini` (varies) | Model identifier |
| `CHAT_SYSTEM_PROMPT` | – | — | Inline system prompt |
| `CHAT_SYSTEM_PROMPT_PATH` | – | — | Path to system prompt file (fallback if env not set) |
| `AIRWEAVE_API_KEY` | – | — | Airweave SDK key |
| `AIRWEAVE_BASE_URL` | – | `https://api.airweave.ai` | Airweave API endpoint |
| `AIRWEAVE_READ_LOCKDOWN_ENFORCE` | – | env-aware | Enforce org-ownership allowlist on reads |

---

## Testing

### Unit tests (Jest)

```bash
npm test            # full suite + coverage
npm run test:watch  # watch mode
npm run test:cov    # coverage report
npm run test:smoke  # smoke tests only (*.smoke.spec.ts)
```

~82 spec files spanning controllers, services, repositories, guards, RBAC, allowlist SQL, chat orchestration, and Airweave ownership.

### E2E tests

End-to-end coverage lives in **spa-velocity** (`spa-velocity/e2e/`) and drives both stacks via Playwright. Run from the frontend:

```bash
cd ../spa-velocity
npm run test:e2e
```

For an isolated run that does not collide with your local dev session, see spa-velocity's `npm run test:e2e:isolate*` scripts.

---

## ADRs

Load-bearing decisions live in `docs/decisions/`:

| ADR | Subject |
|---|---|
| ADR-001 | TypeORM-first persistence with raw-SQL fallback |
| ADR-002 | RBAC scope denial returns 400 (not 403) |
| ADR-003 | No global exception filter — per-module pattern |
| ADR-004 | NestJS Logger (no Pino) |
| ADR-005 | No class-validator and no `ValidationPipe` |
| ADR-006 | Asks-first dependency gate — RBAC scope checks happen early |
| ADR-007 | Skill-vs-repo conflict resolution |
| ADR-008 | No AI attribution in commits / PRs |
| ADR-009 | Clean architecture layering per module |
| ADR-010 | Supersede app-db host guard |
| ADR-011 | Airweave ownership via org metadata (+ amendments 2–4 for OAuth/BYOC/postMessage transport) |

---

## Companion Frontend

This API is the backend for **[spa-velocity](../spa-velocity)** — a React 19 / Vite 7 / Tailwind 4 SPA that consumes every endpoint above.

### Running both stacks

```bash
# Terminal 1 — backend (port 3000)
cd api-velocity
npm run start:dev

# Terminal 2 — frontend (port 5173)
cd ../spa-velocity
npm run dev
```

The SPA expects:
- API at `VITE_API_URL` (default `http://localhost:3000`).
- Bearer token in `localStorage["bearer_token"]`, issued by Better Auth on login.
- CORS origin matching `TRUSTED_ORIGINS`.

---

## Technology Stack

| Tech | Version | Purpose |
|---|---|---|
| NestJS | 11.x | HTTP framework |
| TypeScript | 5.x | Language |
| TypeORM | 0.3.28 | ORM (default persistence) |
| PostgreSQL | ≥14 | Database |
| Better Auth | 1.4.x | Identity + multi-tenant + admin |
| LangChain | 1.x | Chat orchestration |
| OpenAI | 6.x | LLM provider |
| @airweave/sdk | 0.9.x | Knowledge ingestion |
| Resend | 6.x | Email delivery |
| Jest | 29.x | Testing |

---

## License

MIT
