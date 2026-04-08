# Champion Velocity - Implementation Plan (Adapted)

**Version:** 1.0  
**Date:** April 3, 2026  
**Author:** TierOne Studio  
**Status:** Draft  
**Based on:** Champion Velocity PRD v1.0  

> Branch review note: this plan includes older project-scoped MVP assumptions. The active implementation baseline for the current branch is described in `docs/cv/current-implementation-baseline.md`.

---

## 1. Overview

This document adapts the Champion Velocity PRD to the existing codebase (`api-velocity` + `spa-velocity`) and the revised technical decisions agreed upon during planning. It serves as the actionable implementation plan for the engineering team.

### Key Deviations from Original PRD

| PRD Specifies | Implementation Decision | Rationale |
|---|---|---|
| Prisma ORM | **TypeORM** (keep current) | Already in use for RBAC; raw SQL + TypeORM are working well |
| 5 roles (Admin, PM, Analyst, Engineer, Client) | **Keep current RBAC** (superadmin, admin, manager, member) | Existing permission-based system is flexible enough; org-scoped custom roles already supported |
| Self-hosted Airweave (Docker) | **Airweave SaaS** at `airweave.ai` | Eliminates infra overhead for Airweave + Qdrant; already have account/API key |
| Claude API via @anthropic-ai/sdk | **OpenAI GPT-4o** via `openai` SDK | Team preference |
| LangGraph.js | **LangChain.js** | Simpler chain-based approach for MVP; upgrade to LangGraph later if needed |
| Prisma migrations | **TypeORM migrations** | Consistent with existing codebase |
| RDS PostgreSQL | **Local PostgreSQL** for current development | Matches the current `.env` and reduces infrastructure moving parts during initial build |
| ECS Fargate | **ECR + Elastic Beanstalk** (API) | Simpler deployment model |
| CloudFront + S3 | **S3** (static SPA hosting) | Frontend deployment |
| Monorepo `/api`, `/web`, `/infra` | **Multi-root workspace** (separate repos) | Already structured this way |

---

## 2. Architecture

### Revised Stack

| Layer | Technology | Package |
|---|---|---|
| Frontend SPA | React + Vite + TailwindCSS + shadcn/ui | `spa-velocity` |
| API | NestJS + TypeORM | `api-velocity` |
| Agent/Chat | LangChain.js (embedded in NestJS) | `langchain`, `@langchain/openai` |
| RAG Layer | Airweave SaaS (`api.airweave.ai`) | `@airweave/sdk` |
| Data Source Connect UI | Airweave Connect (embeddable widget) | `@airweave/connect-react` |
| LLM Provider | OpenAI GPT-4o | `openai` / `@langchain/openai` |
| Database | PostgreSQL via local development database | `pg` + TypeORM |
| Email | Resend (current) | `resend` |
| Auth | Better Auth (current) | `@thallesp/nestjs-better-auth` |
| Deployment - API | AWS ECR + Elastic Beanstalk | Docker |
| Deployment - SPA | AWS S3 | Static build |

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  REACT SPA (spa-velocity)                                    │
│  Vite + TypeScript + TailwindCSS + shadcn/ui                │
│                                                              │
│  ├── Existing: Auth, Admin (Users, Orgs, Roles, Sessions)   │
│  ├── New: Chat Interface (embedded, with message history)    │
│  ├── New: Airweave Connect widget (data source onboarding)   │
│  └── New: Projects Dashboard + Project Detail                │
│                                                              │
│  Deployed to: AWS S3                                         │
└───────────────────────────┬──────────────────────────────────┘
                            │ REST + WebSocket (SSE)
┌───────────────────────────┴──────────────────────────────────┐
│  NESTJS API (api-velocity)                                   │
│                                                              │
│  ├── Existing Modules (keep as-is):                          │
│  │   ├── Auth Module (Better Auth, JWT, RBAC)                │
│  │   ├── Admin Module (Users, Sessions, Orgs)                │
│  │   ├── RBAC Module (Roles, Permissions)                    │
│  │   ├── Email Module (Resend)                               │
│  │   ├── Shared Module (Guards, Decorators, Config)          │
│  │   └── Database Module (pg Pool + TypeORM)                 │
│  │                                                           │
│  ├── New Modules:                                            │
│  │   ├── Airweave Module (collection mgmt, search proxy)     │
│  │   ├── Chat Module (conversation history, SSE streaming)   │
│  │   ├── Projects Module (lifecycle, phases, timelines)      │
│  │   └── Agents Module (LangChain.js orchestration)          │
│  │                                                           │
│  │       Chat Flow:                                          │
│  │       User message                                        │
│  │         → LangChain.js agent                              │
│  │           → Airweave search (via @airweave/sdk)           │
│  │           → GPT-4o reasoning + synthesis                  │
│  │         → Streamed response (SSE)                         │
│  │         → Persist to conversation history                 │
│  │                                                           │
│  TypeORM + pg → Local PostgreSQL                             │
│  @airweave/sdk → api.airweave.ai                             │
│  @langchain/openai → OpenAI API                              │
│                                                              │
│  Deployed to: AWS ECR + Elastic Beanstalk                    │
└───────────────────────────┬──────────────────────────────────┘
                            │ @airweave/sdk (HTTPS)
┌───────────────────────────┴──────────────────────────────────┐
│  AIRWEAVE SaaS (app.airweave.ai)                             │
│  ├── Per-organization Collections                            │
│  ├── 50+ Connectors (GitHub, Confluence, Slack, Jira, etc.) │
│  ├── Continuous sync with change detection                   │
│  ├── Chunking + Embedding pipeline (managed)                 │
│  ├── Search tiers:                                           │
│  │   ├── Instant  (~0.5s) - direct vector search             │
│  │   ├── Classic  (~2s)   - LLM-optimized search plan        │
│  │   └── Agentic  (<2min) - multi-step agent navigation      │
│  ├── Airweave Connect widget (embeddable data source UI)     │
│  ├── MCP Server (for AI assistant integration)               │
│  └── Vector DB (Qdrant, managed by Airweave)                 │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. MVP Scope (Revised)

### MVP Goal

Authenticated internal TierOne users can **chat with information stored in Airweave collections** - asking questions about connected data sources (GitHub repos, Confluence docs, etc.) and receiving grounded, source-attributed answers powered by GPT-4o.

### MVP Includes

1. **Airweave integration** - `@airweave/sdk` in NestJS: collection management, search proxy
2. **Airweave Connect widget** - `@airweave/connect-react` in SPA: connect GitHub and Confluence sources in the initial MVP
3. **Chat interface** - Embedded in SPA with full message history, SSE streaming
4. **LangChain.js agent** - Retrieval chain: query Airweave → augment with context → GPT-4o response
5. **Conversation persistence** - Chat history stored in the current local PostgreSQL database
6. **Projects module** - Basic project CRUD linking an organization to exactly one available pre-existing Airweave collection selected at project creation

### MVP Excludes (Deferred)

- Gap Analysis report generation and editor
- ROI Calculator
- Data Collection questionnaire workflow
- PDF export
- Scoreboard / DORA metrics dashboard
- Template library
- Margin tracking
- Human-in-the-loop review gates
- Agentic search tier (start with instant/classic)
- Shared conversations
- In-app Airweave collection creation

### MVP Success Criteria

- Internal TierOne user logs in and sees their projects, each linked to exactly one available pre-existing Airweave collection selected during project creation
- User can connect data sources via Airweave Connect widget
- User must select a project before chat starts
- User can chat and ask questions about their connected data
- Agent searches Airweave, synthesizes a structured markdown answer with GPT-4o, and streams it back
- Conversation history is persisted and viewable
- Conversations are private to the current user
- Multi-tenant isolation: users only see their organization's collections

---

## 4. Data Model (New Entities)

These entities are added to the existing schema. All Better Auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `jwks`) and RBAC tables (`roles`, `permissions`, `role_permissions`) remain unchanged.

### 4.1 Projects

```sql
CREATE TABLE IF NOT EXISTS project (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'discovery'
        CHECK (status IN ('discovery', 'pilot', 'retainer', 'completed', 'cancelled')),
    phase TEXT NOT NULL DEFAULT 'data_collection'
        CHECK (phase IN ('data_collection', 'workshop', 'analysis', 'report',
                         'implementation', 'handover')),
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    airweave_collection_id TEXT NOT NULL,
    airweave_collection_uuid TEXT,
    start_date TIMESTAMP WITH TIME ZONE,
    target_end_date TIMESTAMP WITH TIME ZONE,
    actual_end_date TIMESTAMP WITH TIME ZONE,
    created_by TEXT REFERENCES "user"(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_organization ON project(organization_id);
CREATE INDEX idx_project_status ON project(status);
```

### 4.2 Conversations & Messages

```sql
CREATE TABLE IF NOT EXISTS conversation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_project ON conversation(project_id);
CREATE INDEX idx_conversation_user ON conversation(user_id);
CREATE INDEX idx_conversation_org ON conversation(organization_id);

CREATE TABLE IF NOT EXISTS message (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_conversation ON message(conversation_id);
CREATE INDEX idx_message_created ON message(conversation_id, created_at);
```

### 4.3 Data Sources (tracking Airweave connections)

```sql
CREATE TABLE IF NOT EXISTS data_source (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    type TEXT NOT NULL
        CHECK (type IN ('github', 'notion', 'confluence', 'jira',
                        'slack', 'google_drive', 'postgresql', 'other')),
    name TEXT NOT NULL,
    airweave_source_connection_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'connected', 'syncing', 'synced', 'error')),
    last_sync_at TIMESTAMP WITH TIME ZONE,
    entity_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_data_source_project ON data_source(project_id);
```

---

## 5. API Modules (New)

### 5.1 Airweave Module

**Purpose:** Proxy and manage Airweave SaaS interactions. API keys stay server-side.

```text
src/modules/airweave/
├── airweave.module.ts
├── api/
│   └── controllers/
│       └── airweave.controller.ts
├── application/
│   └── services/
│       ├── airweave.service.ts
│       └── airweave-connect.service.ts
└── infrastructure/
    └── airweave-sdk.provider.ts
```

**Key endpoints:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/airweave/collections` | List available pre-existing collections for org/project linking |
| GET | `/api/airweave/collections/:id` | Get collection details + sync status |
| POST | `/api/airweave/collections/:id/search` | Proxy search (instant/classic) |
| POST | `/api/airweave/connect/session` | Create Airweave Connect session token |
| GET | `/api/airweave/sources/:collectionId` | List source connections |

**Environment variables:**

```env
AIRWEAVE_API_KEY=sk-...
AIRWEAVE_BASE_URL=https://api.airweave.ai
```

### 5.2 Chat Module

**Purpose:** Manage conversations, orchestrate LangChain.js agent, stream responses.

```text
src/modules/chat/
├── chat.module.ts
├── api/
│   └── controllers/
│       └── chat.controller.ts
├── application/
│   └── services/
│       ├── chat.service.ts
│       └── chat-agent.service.ts
├── domain/
│   └── repositories/
│       └── chat.repository.interface.ts
└── infrastructure/
    └── persistence/
        └── repositories/
            └── chat.database-repository.ts
```

**Key endpoints:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/chat/conversations` | List user's conversations |
| POST | `/api/chat/conversations` | Create new conversation |
| GET | `/api/chat/conversations/:id/messages` | Get message history |
| POST | `/api/chat/conversations/:id/messages` | Send message (returns SSE stream) |
| DELETE | `/api/chat/conversations/:id` | Delete conversation |

**Chat Agent Flow (LangChain.js):**

```text
User sends message
  → chat.controller receives POST
  → chat-agent.service orchestrates:
      1. Load conversation history (last N messages for context window)
      2. Create LangChain.js RetrievalQA chain:
         a. Retriever: Airweave search (classic tier) via @airweave/sdk
         b. LLM: GPT-4o via @langchain/openai
         c. System prompt: grounding instructions + source attribution
      3. Stream response tokens via SSE
      4. On completion: persist assistant message + metadata (sources, search results)
  → Return SSE stream to client
```

### 5.3 Projects Module

**Purpose:** CRUD for projects, requiring selection of exactly one available pre-existing Airweave collection during project creation.

```text
src/modules/projects/
├── projects.module.ts
├── api/
│   └── controllers/
│       └── projects.controller.ts
├── application/
│   └── services/
│       └── projects.service.ts
├── domain/
│   └── repositories/
│       └── projects.repository.interface.ts
└── infrastructure/
    └── persistence/
        └── repositories/
            └── projects.database-repository.ts
```

**Key endpoints:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects` | List projects for org |
| POST | `/api/projects` | Create project and require selection of exactly one available pre-existing Airweave collection |
| GET | `/api/projects/:id` | Get project detail |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/projects/:id/data-sources` | List data sources |
| POST | `/api/projects/:id/data-sources` | Track a new data source |

---

## 6. SPA Features (New)

### 6.1 Chat Interface

New feature module at `src/features/Chat/`.

```text
src/features/Chat/
├── index.ts
├── views/
│   └── ChatPage.tsx
├── components/
│   ├── ConversationList.tsx
│   ├── ChatWindow.tsx
│   ├── ChatMessage.tsx
│   ├── ChatInput.tsx
│   ├── SourceCard.tsx
│   └── StreamingMessage.tsx
├── hooks/
│   ├── useConversations.ts
│   ├── useMessages.ts
│   └── useChat.ts
├── services/
│   └── chatService.ts
└── types/
    └── index.ts
```

**Route:** `/chat` and `/chat/:conversationId`

**UX:**
- Left sidebar: list of conversations (newest first), "New Chat" button
- Main area: message history with streaming assistant responses
- Each assistant message shows minimal source attribution (source name and link when available)
- Project selection is required before the first message is sent
- SSE-based streaming for real-time token display

### 6.2 Airweave Connect Integration

Embedded in project settings or a dedicated "Data Sources" tab.

```text
src/features/DataSources/
├── index.ts
├── views/
│   └── DataSourcesPage.tsx
├── components/
│   ├── ConnectButton.tsx
│   ├── DataSourceList.tsx
│   └── SyncStatusBadge.tsx
├── hooks/
│   └── useDataSources.ts
└── services/
    └── dataSourceService.ts
```

**UX:**
- "Connect your apps" button opens Airweave Connect modal
- Users authenticate with GitHub and Confluence only in the initial MVP
- After connection, data source appears in list with sync status
- Status badges: Pending → Syncing → Synced / Error

### 6.3 Projects Dashboard

```text
src/features/Projects/
├── index.ts
├── views/
│   ├── ProjectsPage.tsx
│   └── ProjectDetailPage.tsx
├── components/
│   ├── ProjectCard.tsx
│   ├── ProjectForm.tsx
│   └── ProjectStatusBadge.tsx
├── hooks/
│   └── useProjects.ts
└── services/
    └── projectService.ts
```

**Routes:** `/projects` and `/projects/:id`

### 6.4 Updated Navigation

Add to the existing `AppSidebar`:

| Section | Route | Permission |
|---|---|---|
| Dashboard | `/` | All authenticated |
| Chat | `/chat` | All authenticated |
| Projects | `/projects` | `organization:read` |
| Data Sources | `/data-sources` | `organization:read` |
| Admin → Users | `/admin/users` | `user:read` |
| Admin → Organizations | `/admin/organizations` | `organization:read` |
| Admin → Roles | `/admin/roles` | `role:read` |
| Admin → Sessions | `/admin/sessions` | `session:read` |
| Settings | `/settings` | All authenticated |

---

## 7. New Dependencies

### api-velocity

```json
{
  "@airweave/sdk": "^0.9.x",
  "openai": "^4.x",
  "langchain": "^0.3.x",
  "@langchain/openai": "^0.3.x",
  "@langchain/core": "^0.3.x"
}
```

### spa-velocity

```json
{
  "@airweave/connect-react": "latest"
}
```

---

## 8. Environment Variables (New)

### api-velocity

```env
# Airweave SaaS
AIRWEAVE_API_KEY=sk-...
AIRWEAVE_BASE_URL=https://api.airweave.ai

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Local PostgreSQL
DATABASE_URL=postgresql://mravinale@localhost:5432/velocity
```

### spa-velocity

```env
# No new env vars - Airweave Connect session tokens come from the API
```

---

## 9. Deployment

### API (api-velocity)

```text
GitHub Actions CI
  → npm ci && npm run build && npm test
  → docker build -t cv-api .
  → docker tag + push to AWS ECR
  → Deploy to Elastic Beanstalk (Docker platform)

Elastic Beanstalk config:
  - Single Docker container
  - Environment variables via EB configuration
  - Health check: GET /health
  - Auto-scaling: 1-4 instances
```

### SPA (spa-velocity)

```text
GitHub Actions CI
  → npm ci && npm run build
  → aws s3 sync dist/ s3://cv-spa-bucket --delete
  → (Optional) CloudFront invalidation
```

### Database (Local PostgreSQL for current build)

- Local PostgreSQL is the current development database, as configured in `.env`
- Migrations run via TypeORM on startup using the existing `DatabaseService.runMigrations()` flow
- Hosted database strategy can be revisited after the MVP foundation is working locally

---

## 10. Revised Build Phases

### Phase 1: Airweave Integration (Week 1)

**Goal:** API talks to Airweave SaaS, collections work end-to-end.

- [ ] Install `@airweave/sdk` in api-velocity
- [ ] Create `AirweaveModule` with `AirweaveService` wrapping the SDK
- [ ] Implement collection lookup and project-linking endpoints for pre-existing Airweave collections
- [ ] Implement search proxy endpoint (instant + classic tiers)
- [ ] Implement Airweave Connect session endpoint
- [ ] Add `AIRWEAVE_API_KEY` and `AIRWEAVE_BASE_URL` to config
- [ ] Write integration tests against Airweave SaaS
- [ ] Verify search works against a pre-existing collection with real data

### Phase 2: Chat Backend (Week 2)

**Goal:** LangChain.js agent answers questions using Airweave data.

- [ ] Install `langchain`, `@langchain/openai`, `@langchain/core`
- [ ] Create `ChatModule` with conversation/message CRUD (private per user)
- [ ] Create database migration for `conversation` and `message` tables
- [ ] Implement `ChatAgentService` with LangChain.js RetrievalQA chain
- [ ] Custom Airweave retriever: LangChain `BaseRetriever` → `@airweave/sdk` search
- [ ] SSE streaming endpoint for chat responses
- [ ] Persist messages with metadata (sources, token usage)
- [ ] Implement hard delete for conversations
- [ ] Conversation-scoped context (include last N messages)
- [ ] Add `OPENAI_API_KEY` and `OPENAI_MODEL` to config

### Phase 3: Chat Frontend (Week 3)

**Goal:** Users can chat in the SPA with streaming responses.

- [ ] Create `Chat` feature module in spa-velocity
- [ ] Build ConversationList, ChatWindow, ChatMessage, ChatInput components
- [ ] Implement SSE streaming hook (`useChat`)
- [ ] Implement conversation CRUD hooks (`useConversations`, `useMessages`)
- [ ] Source attribution cards in assistant messages
- [ ] Add `/chat` route to AppRoutes
- [ ] Update AppSidebar with Chat navigation item
- [ ] Responsive design (mobile-friendly chat)

### Phase 4: Data Sources + Projects (Week 4)

**Goal:** Users connect their own apps and manage projects.

- [ ] Install `@airweave/connect-react` in spa-velocity
- [ ] Create `DataSources` feature module with Connect widget integration restricted to GitHub and Confluence
- [ ] Create `Projects` feature module (CRUD + list/detail views)
- [ ] Create `ProjectsModule` in api-velocity (CRUD endpoints)
- [ ] Database migration for `project` and `data_source` tables
- [ ] Require each project to select exactly one available pre-existing Airweave collection at creation time
- [ ] Track source connection status from Airweave
- [ ] Force project selection in the chat interface before first message
- [ ] Add `/projects` and `/data-sources` routes

### Phase 5: Deploy + Polish (Week 5)

**Goal:** Running in AWS with real users.

- [ ] Keep local PostgreSQL as the development database during Phase 1
- [ ] Set up ECR repository + push Docker image
- [ ] Configure Elastic Beanstalk environment
- [ ] Deploy SPA to S3
- [ ] DNS + HTTPS setup
- [ ] End-to-end testing with real Airweave data sources
- [ ] Performance optimization (search latency, streaming)
- [ ] Error handling + loading states polish

---

## 11. Security Considerations

| Concern | Mitigation |
|---|---|
| Airweave API key exposure | Key stored server-side only; SPA calls API proxy, never Airweave directly |
| OpenAI API key exposure | Key stored server-side only; LangChain.js runs in NestJS |
| Multi-tenant data isolation | Each org's chat/projects scoped by `organization_id`; conversations are private per user; Airweave collections are scoped per project |
| Airweave Connect session tokens | Short-lived (10min), HMAC-signed, scoped to specific collection |
| Chat injection | System prompt instructs GPT-4o to only answer from retrieved context; input sanitization |
| Rate limiting | Airweave SDK has built-in retry with backoff; add rate limiting on chat endpoints |

---

## 12. Airweave Integration Details

### SDK Usage Pattern

```typescript
import { AirweaveSDKClient } from '@airweave/sdk';

const client = new AirweaveSDKClient({
  apiKey: process.env.AIRWEAVE_API_KEY,
});

await client.collections.create({ name: 'Client Acme', readable_id: 'acme-corp' });
await client.collections.list({ search: 'acme' });

const results = await client.collections.search.instant(
  'acme-corp',
  { query: 'deployment pipeline configuration', limit: 10 }
);

const classicResults = await client.collections.search.classic(
  'acme-corp',
  { query: 'how does authentication work?', limit: 10 }
);
```

### Airweave Connect (Frontend)

```tsx
import { useAirweaveConnect } from '@airweave/connect-react';

function ConnectButton({ collectionId }: { collectionId: string }) {
  const { open, isLoading } = useAirweaveConnect({
    getSessionToken: async () => {
      const res = await fetch('/api/airweave/connect/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId }),
      });
      const data = await res.json();
      return data.session_token;
    },
    onSuccess: (_connectionId) => {
    },
  });

  return (
    <button onClick={open} disabled={isLoading}>
      Connect your apps
    </button>
  );
}
```

### Search Tier Selection Strategy

| Use Case | Tier | Latency | When |
|---|---|---|---|
| Chat responses | `classic` | ~2s | Default for conversational queries |
| Autocomplete / quick lookup | `instant` | ~0.5s | Type-ahead, simple keyword searches |
| Deep analysis (post-MVP) | `agentic` | <2min | Gap analysis, comprehensive codebase review |

### Available Airweave Connectors (Relevant Subset)

| Connector | Data Types | Priority |
|---|---|---|
| GitHub | Repos, PRs, issues, code files | MVP |
| Confluence | Pages, spaces | MVP |
| Notion | Pages, databases | Later |
| Slack | Messages, threads | Post-MVP |
| Jira | Issues, sprints | Post-MVP |
| Google Drive | Docs, sheets, slides | Post-MVP |
| PostgreSQL | Schema, tables | Post-MVP |

### MCP Server (Future Enhancement)

Airweave provides an MCP server (`airweave-mcp-search`) that lets AI coding assistants (Cursor, VS Code Copilot, Claude Desktop) search collections directly. This could be offered to clients post-MVP:

```json
{
  "mcpServers": {
    "airweave-search": {
      "command": "npx",
      "args": ["-y", "airweave-mcp-search"],
      "env": {
        "AIRWEAVE_API_KEY": "client-scoped-key",
        "AIRWEAVE_COLLECTION": "client-collection-id"
      }
    }
  }
}
```

---

## 13. LangChain.js Agent Design

### Chat Agent (MVP)

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { BaseRetriever } from '@langchain/core/retrievers';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { createRetrievalChain } from 'langchain/chains/retrieval';

class AirweaveRetriever extends BaseRetriever {
  constructor(
    private airweaveService: AirweaveService,
    private collectionId: string,
  ) { super({ callbacks: [] }); }

  async _getRelevantDocuments(query: string) {
    const results = await this.airweaveService.search(this.collectionId, {
      query,
      tier: 'classic',
      limit: 10,
    });
    return results.map(r => ({
      pageContent: r.textual_representation,
      metadata: {
        source: r.name,
        sourceType: r.airweave_system_metadata?.source_name,
        entityType: r.airweave_system_metadata?.entity_type,
        relevanceScore: r.relevance_score,
      },
    }));
  }
}

const llm = new ChatOpenAI({ model: 'gpt-4o', streaming: true });
const retriever = new AirweaveRetriever(airweaveService, collectionId);
const chain = await createRetrievalChain({
  retriever,
  combineDocsChain: await createStuffDocumentsChain({
    llm,
    prompt: SYSTEM_PROMPT,
  }),
});
```

### System Prompt (Core)

```text
You are a knowledge assistant for Champion Velocity. You answer questions using
ONLY information retrieved from the user's connected data sources via Airweave.

Rules:
1. Base your answers ONLY on the provided context documents
2. If the context doesn't contain enough information, say so clearly
3. Use minimal source attribution: mention the source name and link when available
4. Format responses in structured markdown similar to ChatGPT
5. Never fabricate information not present in the retrieved context
6. If asked about topics outside the connected data, acknowledge the limitation
```

---

## 14. Role Mapping (PRD → Current RBAC)

The existing RBAC system maps to PRD roles as follows. No new roles needed.

| PRD Role | Current Role | Mapping Notes |
|---|---|---|
| Admin | `superadmin` | TierOne leadership - full platform access |
| PM | `admin` | Organization admin - manages projects, reviews reports |
| Analyst | `manager` | Elevated operational access - runs analyses, manages data |
| Engineer | `manager` | Same permission level, different org membership |
| Client | `member` | Basic access within their organization - view only |

Finer-grained access is handled by the existing permission-based system (`PermissionsGuard` + `RequirePermissions` decorator). New permissions can be added to the `permissions` table as Chat and Projects modules are built:

| Resource | Actions |
|---|---|
| `chat` | `read`, `create`, `delete` |
| `project` | `create`, `read`, `update`, `delete` |
| `data_source` | `read`, `create`, `delete` |
| `airweave` | `search`, `manage_collections`, `connect_sources` |

---

## 15. Open Questions (Revised)

| # | Question | Impact | Needed By |
|---|---|---|---|
| 1 | Can the same pre-existing Airweave collection be reused across multiple projects, or should each collection map to only one project? | Determines final project-to-collection mapping rules | Phase 1 |
| 2 | Which Airweave search tier gives best results for conversational chat in real usage? | May need to validate classic vs instant tradeoffs | Phase 1 |
| 3 | What context window size works best for chat? (last N messages) | Affects token usage and response quality | Phase 2 |
| 4 | Do we need Airweave webhooks for sync status updates? | Affects data source status tracking | Phase 4 |
| 5 | Elastic Beanstalk instance size for LangChain.js + SSE streaming? | Affects deployment cost | Phase 5 |
| 6 | When should hosted database infrastructure replace local PostgreSQL? | Affects later environment hardening | Post-MVP |

---

*End of document.*