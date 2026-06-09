# ADR-015: Vector DB ingestion — durable queue, idempotent indexing, and crash recovery

**Status:** Accepted
**Date:** 2026-06-04
**Deciders:** engineering team

## Context

Slice 3 of the `vector-db` knowledge-base feature added file upload: `POST /api/vector-dbs/:id/upload`
stores the file in S3 and inserts a `vector_db_ingestion_job` row with `status='pending'`
(see `vector-db.migration.ts` migration 003, `vector-db.service.ts:uploadFile`). Nothing
consumes those pending jobs — a knowledge base (KB) therefore never becomes searchable.

Slice 4 adds the **ingestion pipeline**: for each pending job, read the S3 blob → chunk →
embed (OpenAI) → upsert vectors into a per-KB Qdrant collection → drive the KB status
`empty → processing → ready|error`. This is long-running, costly, fails partway, and
**must not be lost** (a silently dropped ingest = the user believes documents are searchable
when no vectors landed). It therefore needs a **durable queue with retry and crash recovery**,
not fire-and-forget.

The coordination plan (`feature/qdrant-knowledge-base-coordination-plan.md` §7) framed the
core distinction: a **trigger** ("when does the worker wake up?") is not a **queue** ("what
durable work is pending, and how do we avoid losing or double-processing it?"). Ingestion
needs both, and the non-negotiables in §7.4 (idempotent upserts, status as UI source of truth,
batched embeddings, lease + reclaim, graceful shutdown) constrain the design.

This ADR records the decisions deferred to Slice 4 by ADR-014 (VectorStoreProvider port,
status-transition enforcement) plus the queue/embeddings/Qdrant decisions D1–D4.

## Decision

We will run ingestion as a **`pg-boss` durable queue inside our existing Postgres**, with the
`vector_db_ingestion_job` table as the **single source of truth (SoT) for UI status** and
`pg-boss` as the **trigger + retry/backoff scheduler**. Specifically:

1. **Queue mechanism (D1): `pg-boss`.** It implements leasing, exponential-backoff retry,
   stale-job reclaim, and a notify+poll loop on the Postgres we already operate — the
   easy-to-botch parts of a hand-rolled `SKIP LOCKED` queue. No new stateful infrastructure
   (no Redis). `pg-boss` creates and migrates its own `pgboss` schema on `start()`,
   independent of the repo's `OnModuleInit` migration runner (no collision).

2. **Domain table is the SoT; the queue is the trigger.** `vector_db_ingestion_job.status`
   (`pending|processing|done|failed`) and `org_vector_db.status` drive the UI. `pg-boss`'s
   internal job state is never read by the UI. The durable *intent* is the job row, not the
   `boss.send` call — so a lost or failed enqueue is recoverable (decision 4).

3. **Idempotent indexing (non-negotiable §7.4 #1).** Qdrant point IDs are deterministic:
   `uuidv5-shaped(sha256(vdbId:s3Key:chunkIndex))`. A retried or re-run job upserts the *same*
   IDs, overwriting rather than duplicating. (Qdrant requires point IDs to be an unsigned int
   or a valid UUID — a raw hex string is rejected, so the hash is formatted `8-4-4-4-12`.)

4. **Crash recovery via a startup reconcile sweep, not just the queue lease.** On
   `onModuleInit` (after `boss.start` + `boss.work`), the ingestion service re-enqueues every
   job that is `pending` (recovers a lost/failed `boss.send`) or `processing` whose row
   `updated_at` is older than a stuck-threshold (recovers a worker that was hard-killed
   mid-flight, with no graceful shutdown). The job table has no `processing_started_at` column
   (that lives on `org_vector_db`); `updated_at`, stamped by `setJobStatus`, is the per-job
   freshness signal. Idempotent upsert (decision 3) makes re-processing
   safe. This makes "a job survives an API restart" true even under SIGKILL, which a graceful
   `boss.stop` alone does not guarantee.

5. **Terminal-failure ownership is a single code path in the handler.** The handler reads the
   domain `attempts` counter. On a processing error: if `attempts + 1 >= MAX_ATTEMPTS` it sets
   the job `failed` + KB `error` (with `status_error.message`) and returns (pg-boss treats the
   job complete); otherwise it increments `attempts`, sets the job back to `pending`, and
   rethrows so pg-boss reschedules with backoff. We do **not** depend on a separate pg-boss
   dead-letter/`onComplete` callback to write terminal domain status — keeping the SoT writes
   in one place avoids divergence between pg-boss state and the domain row.

6. **Collection model (D4): one Qdrant collection per KB.** The collection name is the existing
   `org_vector_db.vector_store_ref` (`vdb_<32hex>`, generated in Slice 1). Per-KB collections
   give clean delete/detach semantics and simple isolation. The embedding dimension is sourced
   from `IEmbedder.dimensions()` and passed to `ensureCollection`; the collection is created
   once with that dimension (cosine distance).

7. **Status writes are concurrency-safe under multi-file ingest.** With `teamConcurrency > 1`,
   sibling jobs for the same KB run in parallel. KB → `ready` is written only when no other
   `pending`/`processing` job remains for that KB (guarded `UPDATE`), so the badge cannot flap
   `ready ↔ processing` or land `ready` while a sibling is still indexing.

8. **Embeddings (D2/D3) behind domain ports (ADR-009).** OpenAI embeddings and Qdrant are
   reached only through `IEmbedder` and `IVectorStore` ports in `domain/`; the SDKs live in
   `infrastructure/`. This satisfies ADR-014's deferred "VectorStoreProvider port" follow-up.
   Embeddings are sent in **bounded batches with bounded concurrency** (`EMBEDDING_BATCH_SIZE`,
   `EMBEDDING_CONCURRENCY`) to respect OpenAI rate limits — never `Promise.all` over thousands
   of chunks at once.

9. **`document_count` semantics unchanged.** It remains the count of *uploaded files*
   (incremented at upload, decremented at file delete, Slice 3). Ingestion does not modify it,
   avoiding a double-count. The `document_count > 0` acceptance criterion is satisfied at upload.

## Alternatives considered

- **Alt A — Fire-and-forget (`void promise`).** Rejected: lost on deploy/restart; no retry,
  no durability. Unacceptable for must-not-be-lost ingestion (coordination plan §7.2 Option A).
- **Alt B — `@nestjs/schedule` + Postgres job table + `FOR UPDATE SKIP LOCKED` (hand-rolled).**
  Viable and dependency-lean (one first-party dep), but we would own ~80–150 LOC of
  claim/lease/backoff/reclaim — exactly the easy-to-botch logic pg-boss provides correctly.
  Rejected for MVP in favor of one well-tested third-party dep (coordination plan §7.3).
- **Alt C — BullMQ + Redis.** Best ergonomics at scale, but adds a stateful Redis service.
  Overkill for MVP; deferred until throughput demands it (coordination plan §7.5).
- **Alt D — Transactional enqueue (enqueue inside the job-insert DB transaction).** Would give
  exactly-once enqueue, but couples to pg-boss's cross-schema `send`-in-transaction support
  (version-fragile) and still leaves crash-mid-processing uncovered. Rejected in favor of the
  reconcile sweep (decision 4), which covers both lost-enqueue *and* crash-mid-flight with one
  mechanism and a cleaner SoT story.
- **Alt E — Derive UI status from pg-boss state + a view (no domain status column).** Rejected:
  the UI needs the ADR-014 columns (`status_error` JSONB, `processing_started_at`,
  `last_ingested_at`) and a stable shape independent of the queue library.

## Consequences

- **Positive:** durable, idempotent, crash-safe ingestion with no new stateful infrastructure.
  Retry/backoff/lease come from a tested library. The reconcile sweep makes restart-durability
  real (survives SIGKILL, not just graceful shutdown). SoT is unambiguous (the domain table).
  External systems are swappable behind ports.
- **Negative:** pg-boss adds a `pgboss` schema to the application Postgres (more tables, its own
  migrations on boot). `QDRANT_URL` + `QDRANT_API_KEY` become required env (boot fails without
  them) — every environment running the API must provision Qdrant. `upsert` with `wait: true`
  (used for read-after-write correctness in tests) is a synchronous per-batch flush — a known
  throughput tradeoff acceptable at MVP volume. The reconcile sweep can re-run a job that
  *actually* finished but crashed before writing `done`; idempotent upsert makes this harmless
  but it costs duplicate embedding spend on that one job.
- **Known limitations (MVP):**
  - ~~Uploaded file bodies are decoded as **UTF-8 text** for chunking. No PDF/DOCX text
    extraction — a binary upload will be chunked as raw text. Extraction is future work.~~
    **Superseded by ADR-015** — PDF/DOCX text extraction now runs before chunking.
  - A single shared Qdrant instance via env (not per-org encrypted creds). Per-KB collections
    provide isolation.
  - Changing `EMBEDDING_MODEL` after vectors exist requires a **new collection** (Qdrant rejects
    a dimension mismatch on upsert). No automatic re-index/migration.
- **Follow-ups (still deferred, per ADR-014):** soft-delete janitor (Qdrant drop + S3 purge +
  orphan sweep) — this is also the mechanism that purges PII from Qdrant on KB delete, so it
  must land before GA; confirm Qdrant Cloud at-rest encryption is enabled on the provisioned
  cluster. `OrganizationDeleted` event subscriber, `countProjectReferences` inversion
  (Slice 5), `VectorDbAuthorizationService` extraction, Qdrant `search()` for the chat RAG
  provider (Slice 6).

## References

- `feature/qdrant-knowledge-base-coordination-plan.md` §7 (D1 trigger-vs-queue), §7.4 (non-negotiables).
- `src/modules/vector-db/vector-db.migration.ts` — `vector_db_ingestion_job` table (migration 003).
- `src/modules/vector-db/application/services/vector-db-ingestion.service.ts` — queue lifecycle,
  reconcile sweep, worker handler.
- `src/modules/vector-db/domain/{vector-store.port.ts, embedder.port.ts, point-id.ts}` — ports + idempotency.
- `src/modules/vector-db/infrastructure/{qdrant, openai, queue}/` — adapters.
- `src/shared/config/config.service.ts` — `getQdrantUrl`, `getQdrantApiKey`, `getEmbeddingModel`,
  `getEmbeddingBatchSize`, `getEmbeddingConcurrency`; `QDRANT_URL`/`QDRANT_API_KEY` in `validateEnvironment`.
- ADR-014 (vector-db persistence/lifecycle — Decision 10 status state machine, deferred follow-ups).
- ADR-009 (clean-architecture layering — ports in domain, adapters in infrastructure).
- ADR-006 (asks-first dependency gate — `pg-boss`, `@qdrant/js-client-rest` adoption).
- ADR-001 (TypeORM-first persistence — raw-SQL fallback used by `VectorDbDatabaseRepository`).
