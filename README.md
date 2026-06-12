# Velocity API

`api-velocity` is the backend for the Velocity enterprise knowledge assistant.
It provides multi-tenant identity and authorization, source management,
project-scoped chat, live read-only PostgreSQL analysis, document ingestion,
semantic retrieval, and administrative APIs.

Companion frontend:
[`spa-velocity`](https://github.com/TierOne-Studio/spa-velocity).

## What the API Does

- authenticates users with Better Auth bearer sessions;
- resolves platform and organization roles into action-level permissions;
- enforces organization scope on protected resources;
- manages users, sessions, organizations, invitations, approvals, and
  impersonation;
- manages projects and their Airweave, PostgreSQL, and vector database sources;
- streams grounded AI answers through Server-Sent Events;
- routes questions to RAG, SQL, or a general tool-calling agent;
- encrypts stored SQL credentials and executes bounded read-only queries;
- ingests uploaded documents through S3, pg-boss, OpenAI embeddings, and
  Qdrant.

## Documentation

| Document | Purpose |
|---|---|
| [Documentation index](docs/README.md) | Entry point for the complete backend documentation set |
| [Architecture](docs/architecture.md) | System context, NestJS modules, clean architecture, persistence, tenancy, and data model |
| [Agentic architecture](docs/agentic-architecture.md) | Chat router, outer agent, SQL sub-agent, RAG, SSE, vector ingestion, and sequence diagrams |
| [API reference](docs/api-reference.md) | Endpoint families, permissions, request conventions, and SSE events |
| [Deployment and operations](docs/deployment-and-operations.md) | Infrastructure, environment variables, startup, verification, observability, and failure modes |
| [Chat tuning](docs/chat-tuning-guide.md) | Retrieval and agent quality/cost controls |
| [SQL operations](docs/sql-connections-operations.md) | Production safety requirements for attached databases |
| [SQL key rotation](docs/sql-connections-key-rotation.md) | AES key rotation runbook |
| [Architecture decisions](docs/decisions/README.md) | Accepted backend engineering decisions |
| [Frontend product overview](https://github.com/TierOne-Studio/spa-velocity/blob/main/docs/product-overview.md) | Product value and user-facing capability model |
| [Executive and architecture review](https://github.com/TierOne-Studio/spa-velocity/blob/main/docs/executive-architecture-review.md) | Due-diligence questions, objections, readiness gaps, and go-live gates across both repositories |
| [Documentation verification](https://github.com/TierOne-Studio/spa-velocity/blob/main/docs/documentation-verification.md) | Audited source baselines, evidence matrix, branch drift, checks, and confidence |

## Quick Start

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- PostgreSQL 14 or newer
- OpenSSL or another way to generate a 32-byte encryption key

The current application boots all modules. OpenAI, S3, and Qdrant configuration
are therefore startup requirements alongside PostgreSQL, even when vector
database functionality is not yet exposed to users. Resend and Airweave are
optional integrations. Reachable PostgreSQL source databases are only needed
for chat-to-SQL.

### Install

```bash
npm install
cp .env.example .env
```

### Create the application database

```bash
createdb api_velocity
psql -d api_velocity \
  -f src/shared/infrastructure/database/migrations/001_initial_schema.sql
```

The optional test administrator seed is:

```bash
psql -d api_velocity \
  -f src/shared/infrastructure/database/migrations/002_create_test_admin.sql
```

Module-owned migrations for RBAC, projects, chat, SQL connections, and vector
databases run idempotently during application startup. Module import order is
load-bearing because some migrations depend on earlier module tables.

### Configure required environment

```env
DATABASE_URL=postgresql://user:password@localhost:5432/api_velocity
AUTH_SECRET=replace-with-at-least-32-characters
BASE_URL=http://localhost:3000
TRUSTED_ORIGINS=http://localhost:5173
FE_URL=http://localhost:5173
PROJECT_SOURCE_SECRET_KEY=<base64-encoded-32-byte-key>
OPENAI_API_KEY=...
S3_BUCKET=...
S3_REGION=us-east-1
QDRANT_URL=https://your-cluster.qdrant.io:6333
QDRANT_API_KEY=...
```

Generate an encryption key:

```bash
openssl rand -base64 32
```

See [Deployment and operations](docs/deployment-and-operations.md) for the full
configuration matrix.

### Run

```bash
npm run start:dev
```

The API listens on `http://localhost:3000` by default.

```bash
curl http://localhost:3000/api/auth/ok
```

Start the frontend in the sibling repository:

```bash
cd ../spa-velocity
cp .env.example .env.local
npm install
npm run dev
```

## Common Commands

```bash
npm run start:dev       # watch mode
npm run build           # compile and copy prompt assets
npm run start:prod      # run dist/main
npm test                # Jest unit/integration suite with coverage
npm run test:e2e        # API end-to-end suite
npm run test:smoke      # smoke specifications
npm run lint            # ESLint with fixes
```

## Technology

- NestJS 11 and TypeScript
- Better Auth with bearer, JWT, organization, admin, and OpenAPI plugins
- PostgreSQL with TypeORM-first persistence and parameterized raw-SQL adapters
- LangChain and OpenAI chat models
- Airweave SDK
- S3, Qdrant, OpenAI embeddings, and pg-boss
- Resend
- Jest, Supertest, Testcontainers, and integration specifications

## Architecture at a Glance

```text
HTTP controllers and guards
          |
Application services and agent orchestration
          |
Domain ports and entities
          |
Infrastructure adapters
  PostgreSQL | Airweave | OpenAI | S3 | Qdrant | Resend
```

Domain modules generally use:

```text
src/modules/<domain>/
├── api/
├── application/
├── domain/
└── infrastructure/
```

Start reading at:

- `src/app.module.ts` for module composition and startup ordering;
- `src/auth.ts` for identity and Better Auth integration;
- `src/shared/guards/permissions.guard.ts` for authorization;
- `src/modules/chat/application/services/chat-agent.service.ts` for the outer
  agent and router dispatch;
- `src/modules/projects/application/providers/` for source providers;
- `src/modules/vector-db/` for document ingestion and retrieval.

## Current Boundaries

- The implementation is appropriate for a controlled pilot, not an automatic
  enterprise-production guarantee. A synthetic RAG benchmark provides an
  engineering baseline, but SLOs, recovery objectives, auditability, data
  lifecycle, customer-domain evaluation, and cost governance require explicit
  production decisions.
- Live database analysis supports PostgreSQL.
- The `external` project source kind is reserved but not implemented.
- The direct chat router is opt-in; the general agent path remains the default.
- Module migrations are startup-driven rather than managed by
  `typeorm migration:run`.
- There is no global exception filter, request correlation middleware, or
  dedicated audit-log subsystem.
- Production SQL safety requires operator-provisioned SELECT-only roles and
  network controls in addition to application safeguards.

## AI-Assisted Development

Ruler is the source of truth for coding-agent instructions under `.ruler/`.
Generated files such as `AGENTS.md` and `CLAUDE.md` should not be hand-edited.

```bash
npx ruler apply
```
