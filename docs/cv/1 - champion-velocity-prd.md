# Champion Velocity - Product Requirements Document

**Version:** 1.1  
**Date:** April 3, 2026  
**Author:** TierOne Studio  
**Status:** Draft  
**Supersedes:** PRD v1.0 MVP assumptions  

> Branch review note: this document is historical product context. The active implementation baseline for the current branch is described in `docs/cv/current-implementation-baseline.md`.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Vision & Problem Statement](#2-vision--problem-statement)
3. [Product Strategy](#3-product-strategy)
4. [MVP Definition (Phase 1)](#4-mvp-definition-phase-1)
5. [Functional Requirements](#5-functional-requirements)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Technical Architecture](#7-technical-architecture)
8. [Data Model](#8-data-model)
9. [User Roles & Permissions](#9-user-roles--permissions)
10. [UI Views & Screens](#10-ui-views--screens)
11. [Integrations](#11-integrations)
12. [Deployment & Infrastructure](#12-deployment--infrastructure)
13. [Roadmap](#13-roadmap)
14. [Risks & Mitigations](#14-risks--mitigations)
15. [Open Questions](#15-open-questions)
16. [Glossary](#16-glossary)

---

## 1. Executive Summary

Champion Velocity (CV) remains the long-term platform vision for helping small B2B software companies operate at higher velocity using process improvement, retrieval-augmented knowledge access, and AI-assisted workflows.

The original PRD described a broader end-to-end Discovery Sprint operating system. After reviewing the current `api-velocity` and `spa-velocity` codebases and aligning on implementation constraints, the product is now being re-baselined so that:

- **Phase 1 / MVP** is an **Airweave-powered knowledge chat product** embedded into the existing platform
- **Phase 1** uses the **current RBAC implementation**, **TypeORM**, **Supabase PostgreSQL**, **Airweave SaaS**, **LangChain.js**, and **OpenAI GPT-4o**
- The broader Discovery Sprint workflow, Gap Analysis engine, ROI calculator, scoreboards, and client delivery operating system are now explicitly **post-MVP phases**

This PRD therefore defines the **actual deliverable MVP** the team will build next, while preserving the larger Champion Velocity platform direction as later roadmap phases.

### Phase 1 Product Outcome

The first deliverable is a multi-tenant internal platform where authenticated users can:

- create and manage projects
- link projects to Airweave collections
- connect external sources via Airweave Connect
- chat with information stored in those connected sources
- receive grounded, source-attributed answers with persistent conversation history

This gives TierOne and early customers immediate value from connected knowledge before investing in more complex automation and reporting workflows.

---

## 2. Vision & Problem Statement

### Vision

Champion Velocity helps software teams operate like championship teams: clear priorities, faster delivery, better information access, measurable operational improvement, and AI used as a force multiplier rather than a replacement.

### Problem

Small software companies typically suffer from:

- fragmented knowledge across code, docs, tickets, Slack, and databases
- poor visibility into what has been built, decided, or documented
- slow onboarding for internal team members and new clients
- ad hoc AI tool usage with little reusable organizational leverage
- lack of a single system for operational context retrieval

### Why This MVP First

The shortest path to product value is not full delivery orchestration. It is a reliable, multi-tenant knowledge interface that lets users search and chat over their existing systems with minimal setup friction.

That foundation is also reusable for later phases:

- Discovery Sprint analysis
- Gap Analysis generation
- ROI workflows
- delivery scoreboards
- internal operating workflows

---

## 3. Product Strategy

### Long-Term Product Vision

Champion Velocity still targets three long-term surfaces:

1. **Services Layer**: Discovery Sprint and implementation engagements
2. **Product Layer**: a multi-tenant RAG SaaS experience for clients
3. **Internal Delivery OS**: TierOne's own operating system for running engagements

### Current Strategy Adjustment

Instead of attempting the full Discovery Sprint platform as the first release, Phase 1 will establish the platform primitives that everything else depends on:

- authenticated tenant-aware users
- project records
- Airweave collection linkage
- source connection management
- conversational retrieval interface
- persistent message history

### Product Principle for Phase 1

The MVP must be small enough to ship quickly, useful enough to use daily, and foundational enough that later phases build on it instead of replacing it.

---

## 4. MVP Definition (Phase 1)

### MVP Goal

Deliver an authenticated web application where users can connect data sources through Airweave SaaS and chat with the information stored in those collections using GPT-4o.

### MVP Includes

1. **Auth and RBAC using the current implementation**
2. **Project management** with basic CRUD and lifecycle metadata
3. **Airweave SaaS integration** using `@airweave/sdk`
4. **Airweave Connect widget** for onboarding external sources
5. **Embedded chat UI in the SPA** with message history
6. **LangChain.js retrieval flow** using Airweave results plus GPT-4o
7. **Conversation persistence** in Supabase PostgreSQL
8. **Tenant-aware project and collection scoping**

### MVP Explicitly Does Not Include

- Gap Analysis generation
- ROI calculator
- questionnaire workflows
- PDF report generation
- client-facing portal beyond the basic tenant-scoped app experience
- delivery scoreboards and DORA dashboards
- LangGraph.js orchestration
- template library
- margin tracking
- formal PM review gates

### MVP Success Criteria

- authenticated users can create a project
- a project can be linked to an Airweave collection
- users can connect one or more sources into that collection
- users can ask questions and receive grounded answers with source context
- chat history persists across sessions
- users only see data scoped to their own organization and project context

### MVP Positioning

This phase is the foundation for Champion Velocity. It is both a usable standalone knowledge product and the base layer for future Discovery Sprint automation.

---

## 5. Functional Requirements

### FR-1: Authentication & Authorization

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | Use the current Better Auth implementation with JWT-backed authenticated sessions | MVP |
| FR-1.2 | Use the existing RBAC model (`superadmin`, `admin`, `manager`, `member`) | MVP |
| FR-1.3 | Enforce organization-scoped data isolation for projects, chats, and Airweave-linked resources | MVP |
| FR-1.4 | Preserve the current invitation flow for onboarding users | MVP |
| FR-1.5 | Map future PM, Analyst, Engineer, and Client responsibilities through permissions instead of introducing new roles in Phase 1 | MVP |

### FR-2: Projects

| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | Create and manage projects tied to an organization | MVP |
| FR-2.2 | Store project status and phase metadata for future workflow expansion | MVP |
| FR-2.3 | Associate an Airweave collection with each project | MVP |
| FR-2.4 | List all accessible projects in a dashboard | MVP |
| FR-2.5 | View a project detail page with linked data sources and chat context | MVP |

### FR-3: Data Source Management

| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | Allow users to connect external sources via Airweave Connect | MVP |
| FR-3.2 | Track source connection status per project | MVP |
| FR-3.3 | Display source type, sync state, and recent sync metadata | MVP |
| FR-3.4 | Support GitHub and one documentation source first (Notion or Confluence) | MVP |
| FR-3.5 | Leave broader connector rollout to later phases | Post-MVP |

### FR-4: Conversational Retrieval

| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | Provide an embedded chat interface in the SPA | MVP |
| FR-4.2 | Persist conversations and messages per user and project | MVP |
| FR-4.3 | Use Airweave search as the retrieval layer for chat answers | MVP |
| FR-4.4 | Use GPT-4o to synthesize responses from retrieved context | MVP |
| FR-4.5 | Return source-attributed answers with relevant metadata | MVP |
| FR-4.6 | Stream assistant responses to the UI | MVP |

### FR-5: Airweave Integration

| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | Use Airweave SaaS at `airweave.ai`, not self-hosted Airweave | MVP |
| FR-5.2 | Create and manage collections through the backend using `@airweave/sdk` | MVP |
| FR-5.3 | Support Airweave search tiers with `classic` as the default chat mode | MVP |
| FR-5.4 | Generate Connect session tokens server-side only | MVP |
| FR-5.5 | Leave agentic search as an optional later enhancement | Post-MVP |

### FR-6: Conversations & History

| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | List existing conversations for the current user | MVP |
| FR-6.2 | Start a new conversation from the chat interface | MVP |
| FR-6.3 | Retrieve full message history for a conversation | MVP |
| FR-6.4 | Allow deletion of a conversation | MVP |
| FR-6.5 | Store assistant metadata for future analysis and UI attribution | MVP |

### FR-7: Deferred Discovery Sprint Capabilities

These requirements remain part of the long-term product but are explicitly moved out of Phase 1.

| Capability | Status |
|---|---|
| Gap Analysis generation | Later phase |
| ROI calculator | Later phase |
| Data collection questionnaire workflows | Later phase |
| PM approval gates | Later phase |
| PDF export and report preview | Later phase |
| DORA and delivery scoreboards | Later phase |
| Client delivery operating system workflows | Later phase |

---

## 6. Non-Functional Requirements

### NFR-1: Performance

| ID | Requirement |
|---|---|
| NFR-1.1 | Standard CRUD endpoints should remain responsive for normal interactive use |
| NFR-1.2 | Airweave-backed chat should feel interactive, with search and response streaming starting quickly |
| NFR-1.3 | Message streaming should begin as soon as the agent starts producing output |
| NFR-1.4 | Project and conversation views should load quickly enough for everyday operational use |

### NFR-2: Security

| ID | Requirement |
|---|---|
| NFR-2.1 | Airweave and OpenAI credentials must remain server-side only |
| NFR-2.2 | Airweave Connect session tokens must be short-lived and generated by the backend |
| NFR-2.3 | Organization and project scoping must prevent cross-tenant data access |
| NFR-2.4 | No unnecessary sensitive content should be logged in prompts, responses, or sync metadata |
| NFR-2.5 | Existing auth and invitation security boundaries must remain intact |

### NFR-3: Reliability

| ID | Requirement |
|---|---|
| NFR-3.1 | Chat failures should degrade gracefully and preserve stored history |
| NFR-3.2 | Airweave dependency failures should surface actionable user-visible errors |
| NFR-3.3 | The platform should support multiple organizations and projects without shared state leakage |

### NFR-4: Observability

| ID | Requirement |
|---|---|
| NFR-4.1 | Log backend failures with enough context for debugging while redacting secrets |
| NFR-4.2 | Track search and chat execution failures for operational visibility |
| NFR-4.3 | Preserve service health endpoints for deployment monitoring |

---

## 7. Technical Architecture

### Phase 1 Stack Overview

| Layer | Technology | Language |
|---|---|---|
| Frontend SPA | React + Vite + TailwindCSS + shadcn/ui | TypeScript |
| API | NestJS | TypeScript |
| Retrieval Layer | Airweave SaaS + `@airweave/sdk` | TypeScript |
| Chat Orchestration | LangChain.js | TypeScript |
| LLM Provider | OpenAI GPT-4o | TypeScript |
| Database | Supabase PostgreSQL via current pg + TypeORM stack | TypeScript |
| Auth | Better Auth | TypeScript |
| Email | Resend | — |
| Frontend Hosting | AWS S3 | — |
| API Hosting | AWS ECR + Elastic Beanstalk | — |

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  REACT SPA (spa-velocity)                                    │
│  ├── Auth + Admin surfaces (existing)                        │
│  ├── Projects dashboard (new)                                │
│  ├── Data sources UI via Airweave Connect (new)              │
│  └── Chat interface with history + streaming (new)           │
└───────────────────────────┬──────────────────────────────────┘
                            │ REST + SSE
┌───────────────────────────┴──────────────────────────────────┐
│  NESTJS API (api-velocity)                                   │
│  ├── Auth / Admin / RBAC modules (existing)                  │
│  ├── Projects module (new)                                   │
│  ├── Airweave module (new)                                   │
│  ├── Chat module (new)                                       │
│  └── LangChain.js retrieval flow (new)                       │
│                                                              │
│  pg + TypeORM → Supabase PostgreSQL                          │
│  @airweave/sdk → Airweave SaaS                               │
│  @langchain/openai → OpenAI GPT-4o                           │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────┴──────────────────────────────────┐
│  AIRWEAVE SaaS                                               │
│  ├── Collections                                             │
│  ├── Source connections                                      │
│  ├── Search tiers (instant, classic, agentic)                │
│  └── Connect widget                                          │
└──────────────────────────────────────────────────────────────┘
```

### Key Technical Decisions

1. **Keep the current RBAC implementation.** No new roles in Phase 1.
2. **Keep TypeORM and the current database approach.** No Prisma migration for Phase 1.
3. **Use Airweave SaaS.** Do not self-host Airweave, Qdrant, or associated infrastructure.
4. **Use LangChain.js instead of LangGraph.js** for the first implementation of chat orchestration.
5. **Use OpenAI GPT-4o** for answer synthesis.
6. **Use Supabase PostgreSQL** as the managed database while preserving Better Auth and Resend.

---

## 8. Data Model

### Existing Foundation

The current platform already has:

- users
- sessions
- organizations
- memberships
- invitations
- roles and permissions

### Phase 1 Additions

#### Project

Stores the business container for an organization's knowledge workspace.

Key fields:

- `id`
- `name`
- `description`
- `status`
- `phase`
- `organization_id`
- `airweave_collection_id`
- `airweave_collection_uuid`
- `start_date`
- `target_end_date`
- `actual_end_date`

#### Conversation

Stores a user-owned chat thread, optionally scoped to a project.

Key fields:

- `id`
- `title`
- `project_id`
- `organization_id`
- `user_id`
- `created_at`
- `updated_at`

#### Message

Stores individual chat messages.

Key fields:

- `id`
- `conversation_id`
- `role` (`user`, `assistant`, `system`)
- `content`
- `metadata`
- `created_at`

#### Data Source

Stores tracked source connection records linked to a project.

Key fields:

- `id`
- `project_id`
- `type`
- `name`
- `airweave_source_connection_id`
- `status`
- `last_sync_at`
- `entity_count`

### Deferred Data Model Concepts

The following remain valid long-term concepts but are deferred:

- GapAnalysis
- Finding
- ROIProjection
- AgentRun
- AgentToolCall
- ProjectMetrics
- Template library entities
- DataCollectionRequest entities

---

## 9. User Roles & Permissions

### Phase 1 Role Model

Champion Velocity Phase 1 uses the **existing RBAC roles**:

| Current Role | Intended Use in Phase 1 |
|---|---|
| `superadmin` | Full platform administration |
| `admin` | Organization administration and project management |
| `manager` | Elevated operational use within an organization |
| `member` | Basic tenant-scoped access |

### Phase 1 Permission Direction

New capabilities should be expressed via permissions, not new roles.

Proposed new resources:

| Resource | Actions |
|---|---|
| `chat` | `read`, `create`, `delete` |
| `project` | `create`, `read`, `update`, `delete` |
| `data_source` | `read`, `create`, `delete` |
| `airweave` | `search`, `manage_collections`, `connect_sources` |

### Deferred Role Semantics

The original PRD's Admin / PM / Analyst / Engineer / Client model is not removed as a product concept, but it will be implemented later through permission design, reporting workflows, or future role layering if still needed.

---

## 10. UI Views & Screens

### Phase 1 Views

| Screen | Description | Priority |
|---|---|---|
| Login | Existing authentication flow | MVP |
| Dashboard | Existing shell, expanded over time | MVP |
| Projects Dashboard | List all projects accessible to the current user | MVP |
| Project Detail | Project metadata, linked collection, data sources | MVP |
| Data Sources | Connect and inspect source integrations per project | MVP |
| Chat | Embedded chat with history and source-attributed responses | MVP |
| Settings | Existing settings/admin surfaces retained | MVP |

### Deferred Screens

| Screen | Status |
|---|---|
| Gap Analysis Editor | Later phase |
| ROI Calculator | Later phase |
| Report Preview | Later phase |
| Client Portal | Later phase |
| Scoreboard | Later phase |
| Metrics & Financials | Later phase |
| Template Library | Later phase |

---

## 11. Integrations

### Phase 1 Integrations

| Integration | Purpose | Method |
|---|---|---|
| Airweave SaaS | Retrieval layer, collections, source connections, search | `@airweave/sdk` |
| Airweave Connect | Embedded source onboarding UI | `@airweave/connect-react` |
| GitHub | Initial code and repo source connection | Via Airweave |
| Notion or Confluence | Initial documentation source connection | Via Airweave |
| OpenAI GPT-4o | Answer synthesis from retrieved context | OpenAI / LangChain |
| Supabase PostgreSQL | Managed application database | PostgreSQL |
| Resend | Existing email capability | Existing integration |
| AWS S3 | Frontend hosting | AWS |

### Deferred Integrations

| Integration | Purpose |
|---|---|
| Slack | Additional knowledge context |
| Jira / Linear | Ticket and sprint context |
| PostgreSQL via Airweave | Schema retrieval |
| Google Drive | Additional document retrieval |
| MCP Server productization | Developer-facing assistant integrations |
| LangSmith | Advanced tracing and evaluation |

---

## 12. Deployment & Infrastructure

### Phase 1 Hosting Model

| Component | Platform |
|---|---|
| Frontend SPA | AWS S3 |
| Backend API | Docker image in AWS ECR, deployed via Elastic Beanstalk |
| Database | Supabase PostgreSQL |
| Retrieval Infrastructure | Airweave SaaS |

### CI/CD Direction

- build and test in GitHub Actions
- build Docker image for API
- push API image to ECR
- deploy API via Elastic Beanstalk
- build SPA static assets
- publish SPA to S3

### Local Development

Local development no longer requires self-hosting Airweave for Phase 1. Developers only need:

- the existing API repo
- the existing SPA repo
- access to Supabase PostgreSQL
- access to Airweave SaaS
- access to OpenAI

---

## 13. Roadmap

### Phase 1: Airweave Knowledge Chat MVP

**Goal:** Ship the first usable Champion Velocity product.

Includes:

- Airweave SDK integration
- project CRUD
- source connection management
- embedded chat with history
- LangChain.js retrieval orchestration
- GPT-4o answer generation
- S3 + Elastic Beanstalk deployment

### Phase 2: Discovery Sprint Analysis Layer

Potential additions:

- structured retrieval workflows for analysis
- DORA-specific search and calculation helpers
- reusable prompts and scoring primitives
- stored evidence and citation structures

### Phase 3: Reporting Layer

Potential additions:

- Gap Analysis generation
- ROI calculator
- report preview
- export workflows
- PM review and approval flows

### Phase 4: Client Delivery Layer

Potential additions:

- client portal
- data request workflows
- onboarding workflows
- scoreboards and KPI visualization

### Phase 5: Delivery OS / Internal Operations

Potential additions:

- engagement tracking
- operational analytics
- margin and utilization reporting
- workflow automation across engagements

---

## 14. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Airweave search quality is inconsistent for some questions | High | Medium | Start with constrained project-scoped chat, inspect sources, iterate prompts and retrieval strategy |
| Airweave SaaS dependency becomes a product bottleneck | Medium | Medium | Keep the integration isolated behind a backend module and SDK wrapper |
| GPT-4o hallucination or over-synthesis | High | Medium | Require source-grounded responses and clear fallback behavior when context is insufficient |
| Cross-tenant leakage through poor scoping | High | Low-Medium | Enforce org and project scoping in backend queries and collection mapping |
| The MVP is still too broad | Medium | Medium | Keep Phase 1 focused on projects, sources, and chat only |
| Future product requirements outgrow current role model | Medium | Medium | Extend permissions first; revisit role design only when necessary |

---

## 15. Open Questions

| # | Question | Impact | Needed By |
|---|---|---|---|
| 1 | Should chat be scoped primarily by project, by collection, or by organization? | Affects data model and UX | Phase 1 |
| 2 | Which Airweave search tier provides the best default for chat quality and latency? | Affects user experience | Phase 1 |
| 3 | Which documentation source should ship first alongside GitHub: Notion or Confluence? | Affects connector prioritization | Phase 1 |
| 4 | What message history window should be sent into the retrieval chain by default? | Affects cost and answer quality | Phase 1 |
| 5 | Do we need source sync status polling only, or Airweave webhook support later? | Affects data source UI behavior | Phase 1 / Phase 2 |
| 6 | Which later-phase Discovery Sprint features should be prioritized first after chat? | Affects roadmap ordering | Post-MVP |

---

## 16. Glossary

| Term | Definition |
|---|---|
| Champion Velocity | TierOne Studio's broader consulting + product vision |
| Phase 1 / MVP | The first production scope: project-based Airweave knowledge chat |
| Airweave Collection | A searchable knowledge base in Airweave composed of one or more connected sources |
| Source Connection | A configured integration between Airweave and a customer system |
| Airweave Connect | Airweave's embedded UI for connecting external apps and services |
| LangChain.js | The orchestration layer used for Phase 1 conversational retrieval |
| GPT-4o | The LLM used for Phase 1 answer synthesis |
| Supabase PostgreSQL | The managed database for application persistence |

---

*End of document.*