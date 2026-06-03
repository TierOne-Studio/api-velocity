# ADR-013: Vector DB module — persistence, provider abstraction, and lifecycle

**Status:** Accepted
**Date:** 2026-06-02
**Deciders:** engineering team

## Context

The `vector-db` module (Slice 1) introduces a `org_vector_db` table that stores knowledge base metadata. Before any ingestion or Qdrant code ships (Slices 3–4), several structural decisions needed to be made to avoid costly retrofits once real data exists.

The initial Slice 1 schema baked Qdrant into the persistence layer (`qdrant_collection` column), used a hard-delete pattern, and lacked operational metadata columns that ingestion workers will need.

## Decisions

### Decision 1 — Storage-agnostic schema (`vector_store_kind` + `vector_store_ref`)

We replace `qdrant_collection TEXT` with two columns:

```sql
vector_store_kind TEXT NOT NULL DEFAULT 'qdrant'
  CHECK (vector_store_kind IN ('qdrant')),   -- extend per new adapter in Slice 4
vector_store_ref  TEXT NOT NULL              -- collection/index name in that store
```

The `vector_store_ref` generation prefix changes from `kb_` to `vdb_` (`vdb_<32hex>`). This lives behind the service, not in the schema. **The VectorStoreProvider port** (`infrastructure/providers/vector-store.provider.ts`) is deferred to Slice 4 when Qdrant code first ships — introducing a `NoopAdapter` now would add ceremony with no runtime value.

### Decision 2 — Operational metadata in Slice 1 migration

Five columns added in `vector_db_002_schema_improvements`:

| Column | Type | Purpose |
|---|---|---|
| `deleted_at` | `TIMESTAMPTZ NULL` | Soft-delete marker (Decision 3) |
| `version` | `INT NOT NULL DEFAULT 0` | Optimistic concurrency on rename + status updates |
| `processing_started_at` | `TIMESTAMPTZ NULL` | Ingestion watchdog / stuck-job detection |
| `last_ingested_at` | `TIMESTAMPTZ NULL` | Distinct from `updated_at` (Decision 5) |

Audit columns (`created_by_user_id`, `updated_by_user_id`) are deferred — NULL backfill in a future migration is semantically unambiguous ("pre-audit era"), and the fields have no consumers until a compliance requirement appears.

### Decision 3 — Soft-delete with async janitor

`DELETE /api/vector-dbs/:id` sets `deleted_at = now()` instead of issuing a hard `DELETE FROM`. HTTP response is `204 No Content`.

**Rationale:** Deleting a VectorDb will eventually cascade to Qdrant collection drop, S3 blob deletion, and `vector_db_ingestion_job` rows — a multi-system operation unsuitable for an HTTP request lifecycle. Soft-delete makes the HTTP handler fast and idempotent; cleanup is handled by a future janitor job (Slice 4 follow-up).

All repository queries filter `WHERE deleted_at IS NULL`. Soft-deleted rows are invisible to all API callers.

### Decision 4 — `DELETE` endpoint returns `204 No Content`

`DELETE /api/vector-dbs/:id` returns `204` (no body) instead of `200 { deleted: true }`. This matches REST semantics (the client already knows what was deleted) and makes the response shape consistent with the pattern used elsewhere in the repo for destructive operations.

### Decision 5 — `updated_at` reserved for user-initiated mutations

`updated_at` is bumped only on `UPDATE` (rename / description change). It is **not** bumped on:
- `incrementDocumentCount` — uses `last_ingested_at` instead
- `updateStatus` — status transitions are system-driven, not user-driven

**Rationale:** If the SPA or a cache layer uses `updated_at` for invalidation, a 10k-doc ingestion run that bumps `updated_at` on every batch would produce 10k spurious cache invalidations. `last_ingested_at` gives "when did content last change" without polluting the user-mutation signal.

### Decision 6 — `requireOrg` checks org existence for superadmin (→ 404, not 500)

When a superadmin passes a `organizationId` to any vector-db endpoint, the service calls `repository.assertOrganizationExists(orgId)` before any operation. A non-existent org throws `NotFoundException` (404).

**Without this check:** a superadmin `POST /api/vector-dbs` with a non-existent org hits the `FOREIGN KEY (organization_id)` constraint, Postgres throws, NestJS surfaces 500. This mirrors the pattern in `AirweaveAuthorizationService` (api-velocity ADR-011 Am.6): "org-existence is never skipped."

This will be extracted into `VectorDbAuthorizationService` in a future PR when the authorization surface grows.

### Decision 7 — `ON DELETE RESTRICT` for the `organization_id` FK

The FK from `org_vector_db.organization_id` to `organization.id` is changed from `ON DELETE CASCADE` to `ON DELETE RESTRICT`.

`ON DELETE CASCADE` would silently drop all `org_vector_db` rows when an org is deleted — but it would not drop the corresponding Qdrant collections or S3 blobs (Slices 3–4), leaving them orphaned and billable. `ON DELETE RESTRICT` blocks the org delete until VectorDbs are explicitly cleaned up, preventing silent orphaning.

**Future cleanup path (Slice 4):** subscribe to an `OrganizationDeleted` domain event in `VectorDbModule`, run async cleanup (Qdrant drop + S3 purge + row delete), then allow the org delete to proceed.

### Decision 8 — `status_error` is structured JSONB

```sql
-- BEFORE (Slice 1 original)
status_error TEXT NULL

-- AFTER
status_error JSONB NULL   -- { message: string, code?: string, occurredAt?: string }
```

Structured JSONB enables: SPA error localization, operator dashboard filtering, retry-policy keying by error code, and Sentry fingerprinting. The schema cost is the same now; retrofitting after ingestion workers start writing to this column would require a data migration.

Minimum shape shipped in Slice 1: `{ message: string }`. Fields are additive — no migration needed to extend later.

### Decision 9 — `countProjectReferences` stays in `VectorDbRepository` for Slice 1

The reviewer (ADR-013 §H) correctly identifies that `VectorDbRepository` reaching into `project_data_source.config->>'knowledgeBaseId'` violates the dependency rule — `VectorDb` should not know the `Projects` module's JSON shape. The correct inversion is `ProjectsService.countDataSourceReferences({ kind: 'vector-db', refId: id })`.

This inversion is deferred to Slice 4 when the Projects module is extended with vector-db source support. Inverting before there is a consumer would require adding a `countDataSourceReferences` method to `ProjectsService` with no test coverage and no real callers — a YAGNI violation. The raw SQL is annotated with a comment pointing to this ADR.

### Decision 10 — Status state machine (documented, not enforced in Slice 1)

Allowed transitions:

| From | To | Trigger |
|---|---|---|
| `empty` | `processing` | First ingestion job starts |
| `processing` | `ready` | Ingestion completes successfully |
| `processing` | `error` | Ingestion fails |
| `ready` | `processing` | Re-ingest / new document upload |
| `error` | `processing` | Retry |
| `ready` | `empty` | All documents purged |

Invalid transitions (e.g., `empty → ready`, `ready → empty` without purge) will be rejected in `updateStatus` via `ConflictException` in Slice 4 when the ingestion worker first calls this method. Enforcing them in Slice 1 would add dead-code guards with no test surface.

### Decision 11 — Raw SQL via `DatabaseService` justified

`VectorDbDatabaseRepository` uses raw SQL rather than TypeORM for two reasons (per api-velocity ADR-001 fallback criteria):

1. `countProjectReferences` uses a JSON operator (`config->>'knowledgeBaseId'`) on a JSONB column — TypeORM cannot express this without a raw query.
2. Future ingestion queries will use ANN (approximate nearest-neighbor) extensions and window functions that TypeORM cannot express.

## Alternatives considered

- **Alt A — Hard-delete with `pending_deletion` status.** Adds a status variant, complicates the state machine, and still requires an async cleanup step. No advantage over soft-delete.
- **Alt B — NoopVectorStoreAdapter in Slice 1.** Correct direction, premature timing. The port and adapter will ship alongside Slice 4's Qdrant code, when there is a real adapter to implement against.
- **Alt C — `ON DELETE CASCADE` + a TODO comment.** Already in Slice 1. Rejected because it silently orphans Qdrant/S3 resources the moment any org is deleted — a billing and data-leak risk even before Slice 4 ships.

### Decision 11 — S3 as blob store for uploaded files (Slice 3)

**Status:** Accepted

Uploaded files are stored in AWS S3 before the ingestion worker processes them. The choice and design:

- **Why S3 (not GCS, local disk, or presigned URL delegated to the worker):** S3 is the de-facto standard for object storage; `@aws-sdk/client-s3` is the official SDK with no heavyweight runtime dependencies; credentials come from the SDK default credential chain (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) so no custom credential wiring is needed. Local disk is not viable in a multi-instance deployment. GCS would work equally well but S3 was chosen for cost/ecosystem familiarity.

- **S3 key scheme:** `vector-dbs/{orgId}/{vectorDbId}/{randomUUID()}`. No filename in the key (avoids spaces, special characters, and encoding issues). Original filename is stored in `vector_db_ingestion_job.original_filename`. The UUID suffix guarantees collision-free multi-upload to the same VectorDb.

- **Orphan on partial failure:** If the S3 put succeeds but the DB `createIngestionJob` insert fails, the S3 object is orphaned. The S3 key is logged before the put (at `info` level) so operators can correlate and clean up manually. A Slice 4 janitor will sweep these automatically. This is the same async-cleanup philosophy as Decision 3 (soft-delete).

- **Port + concrete adapter:** `IVectorDbFileUploader` (`domain/vector-db-file-uploader.port.ts`) defines the `put` / `delete` interface. `VectorDbFileUploaderService` (`infrastructure/s3/`) is the only adapter today. Per YAGNI, no second adapter is planned; the port exists to satisfy ADR-009 (application layer must not import infrastructure directly) rather than to anticipate a swap.

- **Config:** `S3_BUCKET` (required, validated at startup via `validateEnvironment()`), `S3_REGION` (optional, defaults `us-east-1`).

## Consequences

- **Positive:** Schema is stable enough to survive Slices 2–4 without data migrations. Org deletes are safe (RESTRICT). The service never returns 500 on a bad org reference. DELETE is RESTfully shaped. `updated_at` is a reliable user-mutation signal.
- **Negative:** Soft-delete means rows are never truly purged until a janitor job exists (Slice 4 follow-up). `ON DELETE RESTRICT` requires explicit cleanup before an org can be deleted — ops must handle this. S3 orphans accumulate on partial-failure until the janitor ships.
- **Follow-ups:**
  - Slice 4: implement `VectorStoreProvider` port + `QdrantVectorStoreAdapter`.
  - Slice 4: extract `VectorDbAuthorizationService`.
  - Slice 4: enforce status transition guards in `updateStatus`.
  - Slice 4: invert `countProjectReferences` → `ProjectsService.countDataSourceReferences`.
  - Slice 4: implement soft-delete janitor (Qdrant drop + S3 purge + orphan sweep).
  - Future: add `created_by_user_id` / `updated_by_user_id` audit columns when a compliance requirement appears.

## References

- `src/modules/vector-db/vector-db.migration.ts` — migrations `001` and `002`
- `src/modules/vector-db/domain/vector-db.repository.ts` — `IVectorDbRepository` interface
- `src/modules/vector-db/application/services/vector-db.service.ts` — `requireOrg`, `delete`, `create`
- `src/modules/vector-db/api/controllers/vector-db.controller.ts` — `@HttpCode(204)` on DELETE
- api-velocity ADR-001 (TypeORM-first / raw-SQL fallback)
- api-velocity ADR-011 (Airweave org-existence pattern — Decision 6 mirrors Am.6)
