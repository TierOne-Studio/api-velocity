---
id: SPEC-001
title: "SPEC-001: Vector DB Knowledge Bases + RAG retrieval"
status: Draft
layer: contract
owner: Maxi Schvindt
created: 2026-06-09
updated: 2026-06-09
feature_paths:
  - src/modules/vector-db
  - src/modules/projects/application/providers/vector-db-data-source.provider.ts
  - src/modules/chat/application/services/chat-agent-tools.ts
related_adrs: [ADR-011, ADR-014, ADR-015, ADR-016]
related_specs: [SPEC-000]
counterpart_spec: "spa-velocity#SPEC-001"
coordination_doc: ""
---

# SPEC-001: Vector DB Knowledge Bases + RAG retrieval

## 1. Summary (intended behavior)

An organization can own one or more **Vector DB knowledge bases**: org-scoped collections
of documents that are uploaded, asynchronously ingested (extracted → chunked → embedded →
upserted into a vector store), and later retrieved by semantic search. Knowledge bases are
managed through the `api/vector-dbs` REST surface under RBAC, attachable to a project as a
`vector_db` data source, and queried at chat time through the agent's `search_knowledge_base`
tool so answers are grounded in the org's own documents. Every read and write is re-scoped to
the caller's organization; cross-org access is impossible by construction.

## 2. Context & problem

Chat answers were limited to Airweave collections as the only retrieval-augmented data source.
Organizations needed to bring their own documents (PDF/DOCX/plain text) and have the agent
answer from them. There was no first-party store the org controlled end to end: no upload
endpoint, no ingestion pipeline, no org-scoped vector collection, and no retrieval provider the
chat agent could call alongside Airweave. The persistence, queue, and extraction decisions are
recorded in `ADR-014` (persistence lifecycle), `ADR-015` (ingestion queue), and `ADR-016`
(document text extraction); org ownership via metadata follows `ADR-011`.

## 3. Scope

**In scope:**

- CRUD + file lifecycle for knowledge bases via `api/vector-dbs` (list, get, create, update,
  delete, upload, list files, delete file), all org-scoped and RBAC-gated.
- Persistence: `org_vector_db` and `vector_db_ingestion_job` tables with their migrations.
- Asynchronous ingestion pipeline: S3 blob upload → durable ingestion job → claim → text
  extraction → chunking → embedding → vector-store upsert, with status transitions and
  bounded retries.
- Storage-agnostic vector-store port with a Qdrant adapter; OpenAI embedder adapter;
  recursive text-chunker adapter; PDF/DOCX/plain-text document-extractor adapter; pg-boss
  ingestion-queue adapter; S3 file-uploader.
- Project integration: a `vector_db` data-source kind and its `VectorDbDataSourceProvider`,
  so a knowledge base can be attached to a project.
- Chat integration: the `search_knowledge_base` agent tool fans out across a project's
  configured providers (Airweave + `vector_db`) and re-scopes the vector DB to the org at
  query time.
- RBAC scopes: `vector-db:{read,create,update,delete,upload}` across the role matrix.

**Out of scope / non-goals:**

- The UI / spa-velocity screens for managing or browsing knowledge bases (paired `ui` spec,
  tracked separately; this SPEC is the `contract` layer).
- Re-embedding / re-indexing existing documents on embedder or chunker model changes.
- Per-document ACLs finer than the organization boundary.
- Synchronous (request-time) ingestion; ingestion is always asynchronous.
- Non-Qdrant vector stores (the port exists; only the Qdrant adapter ships).

## 4. Assumptions

1. [Confirmed] Every knowledge base belongs to exactly one organization; `organization_id`
   is the sole tenancy boundary and is enforced on every query.
2. [Confirmed] `(organization_id, name)` is unique — an org cannot have two knowledge bases
   with the same name.
3. [Confirmed] Ingestion is asynchronous: upload returns after the blob is stored and a
   `vector_db_ingestion_job` row is created; embedding happens off the request path.
4. [Confirmed] The vector store is addressed through a port; only the Qdrant adapter is wired,
   and the persisted reference is storage-agnostic (`vector_store_kind` + `vector_store_ref`).
5. [Confirmed] An organization delete is blocked (`ON DELETE RESTRICT`) while it still owns
   knowledge bases; orphan cleanup of Qdrant collections and S3 blobs is handled out of band.
6. [Confirmed] Retrieval re-scopes the vector DB to the caller's organization at query time;
   the chat tool never trusts a collection reference without org context.

## 5. Affected areas

**Module:** `src/modules/vector-db` (api / application / domain / infrastructure), registered
via `vector-db.module.ts` and wired in `app.module.ts`.

**Endpoints** (`@Controller('api/vector-dbs')`, all behind `PermissionsGuard`):

| Method & path | Permission | Behavior |
|---|---|---|
| `GET /api/vector-dbs` | `vector-db:read` | List org's knowledge bases |
| `GET /api/vector-dbs/:id` | `vector-db:read` | Get one (org-scoped) |
| `POST /api/vector-dbs` | `vector-db:create` | Create (`name`, `description?`) |
| `PATCH /api/vector-dbs/:id` | `vector-db:update` | Update name/description |
| `POST /api/vector-dbs/:id/upload` | `vector-db:upload` | Upload file → 201, enqueue ingestion job |
| `GET /api/vector-dbs/:id/files` | `vector-db:read` | List ingestion jobs/files |
| `DELETE /api/vector-dbs/:id/files/:jobId` | `vector-db:delete` | Delete a file/job → 204 (removal is delete-grade, not upload) |
| `DELETE /api/vector-dbs/:id` | `vector-db:delete` | Delete knowledge base → 204 |

**Entities + migrations** (`vector-db.migration.ts`):

- `org_vector_db` — `id`, `organization_id` (FK `organization`, `ON DELETE RESTRICT`),
  `name`, `description`, `vector_store_kind` (default `qdrant`), `vector_store_ref`,
  `status` ∈ {`empty`,`processing`,`ready`,`error`}, `status_error` JSONB, `document_count`,
  `deleted_at`, `version`, `processing_started_at`, `last_ingested_at`, timestamps.
  Unique `(organization_id, name)`; index `(organization_id, status)`.
- `vector_db_ingestion_job` — `id`, `vector_db_id` (FK `org_vector_db`, `ON DELETE CASCADE`),
  `s3_key`, `original_filename`, `file_size_bytes`, `content_type`,
  `status` ∈ {`pending`,`processing`,`done`,`failed`}, `attempts`, `locked_until`,
  `last_error`, timestamps. Index `(status, locked_until)` for the claim query; index
  `(vector_db_id)`.

**Status state machine** (`org_vector_db.status`, `ADR-014` Decision 10) — enforced, not
advisory: `updateStatus` in `VectorDbDatabaseRepository` runs a single atomic guarded
`UPDATE … WHERE status = ANY(<legal sources>)`, and an attempt outside the table raises
`Illegal vector-db status transition: <from> -> <to>`. Allowed transitions (self-loops are
legal no-ops):

| From | To | Trigger |
|---|---|---|
| `empty` | `processing` | First ingestion job starts |
| `processing` | `ready` | Ingestion completes successfully |
| `processing` | `error` | Ingestion fails |
| `ready` | `processing` | Re-ingest / new upload |
| `error` | `processing` | Retry after failure |
| `ready` | `empty` | All documents purged |

**RBAC scopes** (`src/permissions.ts`): `vector-db:{read,create,update,delete,upload}`.
Owner/admin: all five. Manager: read/create/update/upload (**no delete** — managers
cannot remove vector-db elements: `vector-db:delete` gates both knowledge-base deletion
*and* file deletion). Viewer: read only. The runtime grant lives in the DB-seeded role
matrix (`rbac.migration.ts`); `rbac_023` revokes the delete grant rbac_022 had given
manager, and `rbac_024` registers `vector-db:upload` in the catalog (rbac_022 had omitted
it, which silently broke admin **and** manager upload at the guard) and grants it to admin
+ manager.

**Project integration:** `vector_db` data-source kind + `VectorDbDataSourceProvider`
(`data-source.registry.ts`, `data-source-provider.interface.ts`,
`vector-db-data-source.provider.ts`); RBAC migration `rbac.migration.ts`.

**Chat integration:** `search_knowledge_base` tool (`chat-agent-tools.ts`,
`chat-agent.service.ts`) fans out over a project's providers with `Promise.allSettled`.

## 6. Acceptance criteria (falsifiable; each maps to a test)

| # | Criterion (observable behavior) | Proving test |
|---|---|---|
| AC1 | `POST /api/vector-dbs` creates an org-scoped KB; duplicate `(org,name)` is rejected | `src/modules/vector-db/api/controllers/vector-db.controller.spec.ts`; `.../infrastructure/persistence/repositories/vector-db.database-repository.integration.spec.ts` |
| AC2 | `GET` list/by-id return only KBs of the caller's org; another org's id is not found | `.../infrastructure/persistence/repositories/vector-db.database-repository.integration.spec.ts` |
| AC3 | RBAC: viewer is read-only; manager cannot remove elements (neither `DELETE /:id` nor `DELETE /:id/files/:jobId` — both gated on `vector-db:delete`, which manager lacks); required permission per route is enforced | `src/modules/vector-db/api/controllers/vector-db.controller.spec.ts`; `src/modules/admin/rbac/rbac.migration.spec.ts` |
| AC4 | `POST /:id/upload` returns 201, stores the blob, and creates a `pending` ingestion job | `src/modules/vector-db/infrastructure/s3/vector-db-file-uploader.service.spec.ts`; `.../application/services/vector-db-ingestion.integration.spec.ts` |
| AC5 | Ingestion claims a job, runs extract→chunk→embed→upsert, and transitions status (`pending`→`processing`→`done`/`failed`) with bounded attempts | `.../application/services/vector-db-ingestion.service.spec.ts`; `.../application/services/vector-db-ingestion.integration.spec.ts` |
| AC6 | PDF/DOCX/plain-text documents are extracted to text; unsupported types fail fast | `.../infrastructure/extractor/extract.spec.ts`; `.../infrastructure/extractor/document-extractor.adapter.integration.spec.ts` |
| AC7 | Chunking is deterministic and each chunk gets a stable point id | `.../infrastructure/textsplitter/chunker.spec.ts`; `src/modules/vector-db/domain/point-id.spec.ts` |
| AC8 | Embedding batches inputs and maps vectors back to chunks in order | `.../application/services/batch-embed.spec.ts`; `.../infrastructure/openai/openai-embedder.adapter.integration.spec.ts` |
| AC9 | Retrieval performs semantic search re-scoped to the org's collection at query time | `.../application/services/vector-db-retrieval.service.spec.ts`; `.../infrastructure/qdrant/qdrant-vector-store.adapter.integration.spec.ts` |
| AC10 | Migrations create both tables/indexes; org delete is RESTRICTed while KBs exist | `src/modules/vector-db/vector-db.migration.spec.ts` |
| AC11 | `VectorDbDataSourceProvider` only handles `vector_db` sources and delegates to org-scoped retrieval; other kinds are rejected | `.../application/services/vector-db-retrieval.service.spec.ts` |
| AC12 | A `vector_db` retrieval hit is attributed to its source document: retrieval resolves each chunk's `s3Key` to the ingestion job's `original_filename` (scoped to the org-scoped vector DB), and the citation's `name` is that filename (`sourceName` stays the collection). Chunks from distinct documents are not collapsed by a chunk-index `entityId` collision | `.../application/services/vector-db-retrieval.service.spec.ts`; `src/modules/projects/application/providers/vector-db-data-source.provider.spec.ts`; `.../infrastructure/persistence/repositories/vector-db.database-repository.integration.spec.ts` |
| AC13 | Retrieval drops chunks scoring below a configurable minimum cosine similarity (`VECTOR_DB_MIN_SCORE_PCT`, default 0.30) before name resolution, so only documents the answer was actually found in become citations (and feed the LLM) — a top-k search no longer surfaces every document. `0` disables the floor | `.../application/services/vector-db-retrieval.service.spec.ts`; `src/shared/config/config.service.spec.ts` |

## 7. Implementation plan

Built as ordered slices (mirrors the branch commit history); each slice carried its tests.

1. **Persistence + CRUD** — `files:` controller, DTO, service, repository interface +
   database-repository, `org_vector_db` migration. `tests:` controller.spec,
   database-repository.integration.spec, migration.spec. `risk:` tenancy leak.
   `slice:` 1–2.
2. **Upload + S3** — `files:` `upload` route, `vector-db-file-uploader.service`,
   `vector-db-file-uploader.port`. `tests:` file-uploader.service.spec. `risk:` orphan blobs.
   `slice:` 3.
3. **Async ingestion queue** — `files:` ingestion service, ingestion-queue port +
   pg-boss adapter, ingestion-job table migration, ingestion-errors. `tests:`
   ingestion.service.spec, ingestion.integration.spec. `risk:` stuck/duplicate jobs.
   `slice:` 4 (`ADR-015`).
4. **Text extraction** — `files:` document-extractor port + adapter, `extract.ts`.
   `tests:` extract.spec, document-extractor.adapter.integration.spec. `slice:` 4 (`ADR-016`).
5. **Chunk + embed + upsert** — `files:` text-chunker port + recursive adapter, embedder port +
   OpenAI adapter, `batch-embed`, `point-id`, vector-store port + Qdrant adapter. `tests:`
   chunker.spec, point-id.spec, batch-embed.spec, openai/qdrant integration specs.
   `slice:` 4–5.
6. **Project attach + retrieval** — `files:` `vector_db` data-source provider + registry,
   projects service/repository/DTO/migration, retrieval service. `tests:`
   retrieval.service.spec. `risk:` query-time org re-scope. `slice:` 5a (`ADR-011`).
7. **Chat RAG grounding** — `files:` `search_knowledge_base` tool, chat-agent service.
   `tests:` retrieval.service.spec (provider contract). `slice:` 6.

## 8. Testing plan

- **Unit (Jest `*.spec.ts`):** controller RBAC/route wiring (AC1, AC3), service orchestration
  and status transitions (AC5), chunking/point-id determinism (AC7), batch embedding (AC8),
  extraction dispatch (AC6), provider kind-guard (AC11).
- **Integration (`*.integration.spec.ts`, real Postgres / real adapters):** repository org
  scoping and uniqueness (AC1, AC2), ingestion end-to-end (AC4, AC5), OpenAI embedder and
  Qdrant store adapters (AC8, AC9), document extractor (AC6).
- **Migration (`vector-db.migration.spec.ts`):** table/index creation and FK RESTRICT (AC10).

No `*.e2e-spec.ts` is required for this SPEC: the org-scoped RBAC and persistence criteria are
proven at the integration layer against real Postgres, which is the binding acceptance layer
for data/RBAC/migration-bound criteria.

## 9. Risks & failure modes

- **Cross-org leak** (tenancy): every repository query filters by `organization_id`; getById
  for another org's id returns not-found. Mitigation: AC2 integration test.
- **Stuck/duplicate ingestion jobs** (race/partial): claim uses `(status, locked_until)` with
  `attempts` bound; failures set `status='failed'` with `last_error`, no infinite retry.
- **Partial pipeline failure** (network/large): extraction/embedding errors mark the job
  failed and leave the KB `status='error'` with a structured `status_error`; fail fast,
  no silent swallow.
- **Orphaned external state** on delete: FK RESTRICT blocks org delete while KBs exist; Qdrant
  collections and S3 blobs are cleaned out of band (`ADR-014`).
- **Empty/unsupported document**: unsupported content types fail fast at extraction (AC6);
  empty extraction yields zero chunks and a terminal job state rather than an upsert of nothing.
- **Embedding/upsert ordering**: vectors are mapped back to chunks by index; a batch-size or
  ordering bug is caught by `batch-embed.spec.ts` (AC8).

## 10. Open questions

None blocking. Deferred (non-blocking): re-embedding strategy on embedder/chunker upgrades,
and the paired spa-velocity `ui` SPEC for knowledge-base management screens.

## Change Log

Append-only. Newest first.

- 2026-06-10 · feat/kb-crud · `vector-db:upload` registered in the RBAC catalog and granted
  to admin + manager (AC4): rbac_022 had shipped the vector-db catalog without `upload`, so
  the upload endpoint was grantable only to superadmin — admin AND manager upload was
  silently broken at the DB-backed `PermissionsGuard`. `rbac_024_add_vector_db_upload_permission`
  inserts the catalog row, adds `upload` to `ORGANIZATION_ADMIN/MANAGER_DEFAULT_PERMISSIONS`,
  and re-syncs roles (custom roles inherit via `organization:update`). Member stays read-only;
  manager `delete` stays revoked. · No assumption corrections.
- 2026-06-10 · feat/kb-crud · Managers can no longer remove vector-db elements (AC3): file
  deletion (`DELETE /:id/files/:jobId`) is re-gated from `vector-db:upload` to
  `vector-db:delete`, and `rbac_023_revoke_manager_vector_db_delete` revokes the
  `vector-db:delete` grant rbac_022 had given the manager role (dropped from
  `ORGANIZATION_MANAGER_DEFAULT_PERMISSIONS`). Removal of any vector-db element is now
  admin-only. Supersedes the earlier "manager gets full vector-db access" direction. Custom
  roles inheriting `vector-db:delete` via `organization:update` are intentionally untouched. ·
  Aligns "manager can't remove elements" across collection + file deletion. · No assumption
  corrections.
- 2026-06-09 · PR #28+ (feat/kb-crud) · Relevance floor for `vector_db` retrieval (AC13):
  `VectorDbRetrievalService` now drops hits below `ConfigService.getVectorDbMinScore()`
  (`VECTOR_DB_MIN_SCORE_PCT`, default 30 ⇒ 0.30) before resolving names, so a top-k search
  stops surfacing every document as a "source" (the entityId fix in AC12 had made the
  pre-existing over-retrieval visible). Scoped to the `vector_db` lane; Airweave unaffected. ·
  Shows only the documents an answer was actually grounded in. · No assumption corrections.
- 2026-06-09 · PR #28+ (feat/kb-crud) · Source-document attribution for `vector_db` citations
  (AC12): retrieval now carries each chunk's `s3Key` and resolves it to the ingestion job's
  `original_filename` (scoped by `vector_db_id`); the provider sets citation `name` = filename
  (was the collection name, causing the "collection · collection" chip) and disambiguates
  `entityId` with `s3Key` so chunk-index collisions across documents no longer drop sources. ·
  Surfaces the document behind a grounded answer in the chat Sources chip. · No assumption corrections.
- 2026-06-09 · PR #28+ (feat/kb-crud) · Added the §5 Status state machine subsection
  (allowed `org_vector_db.status` transitions + enforcement in `updateStatus`), documenting
  behavior already shipped per `ADR-014` Decision 10. · No code or assumption changes.
- 2026-06-09 · PR #28+ (feat/kb-crud) · Documents the as-built Vector DB / RAG feature
  (slices 1–6: CRUD, upload/S3, async ingestion queue, extraction, chunk/embed/upsert,
  project attach + chat RAG grounding) as the governing contract SPEC. The code is implemented
  on `feat/kb-crud` but not yet merged to master, so `status` stays `Draft` (under review);
  it moves to `Implemented` on merge, when the SPEC is reconciled with the merged diff. ·
  Created to satisfy the spec-first gate (SPEC-000) for the behavioral `src/modules/vector-db`
  change. · No assumption corrections.
