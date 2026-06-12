# API Reference

## Conventions

- Base URL: `http://localhost:3000`
- Auth base path: `/api/auth`
- Domain endpoints are currently unversioned. Consumers should treat
  frontend/backend releases as a coordinated compatibility unit until a
  versioning and deprecation policy exists.
- Protected endpoints use `Authorization: Bearer <token>`.
- Most domain responses use `{ "data": ... }`.
- Deletes may return `204` or a small success object depending on the module.
- User-controlled input is validated manually in controllers and services.
- Organization-owned requests use the active organization unless an authorized
  superadmin supplies an explicit `organizationId`.
- Supported cross-organization list endpoints may accept `scope=all` for
  superadmins.

## Error Semantics

| Status | Meaning |
|---|---|
| `400` | Invalid input or invalid scope request |
| `403` | Missing authentication, approval, permission, membership, or ownership |
| `404` | Scoped resource does not exist |
| `409` | Uniqueness or referenced-resource conflict |
| `429` | Chat rate limit exceeded |
| `500` | Unexpected server failure |
| `502` | Upstream integration failure |
| `503` | Required service wiring or infrastructure unavailable |

## Health

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/hello` | Anonymous service greeting |
| GET | `/health` | Process liveness, timestamp, and uptime; does not verify dependencies |
| GET | `/api/password-policy` | Anonymous password policy used by the SPA |
| GET | `/me` | Current authenticated Better Auth session |
| GET | `/api/auth/ok` | Better Auth functional health |

Deployments need a separate dependency-aware readiness policy for PostgreSQL,
pg-boss, S3, Qdrant, OpenAI, and any integration required by the enabled
features.

## Authentication

Better Auth owns routes under `/api/auth`, including email/password login,
signup, session, email verification, password reset, organizations,
invitations, admin operations, bearer tokens, JWT, and generated OpenAPI
metadata.

The SPA specifically relies on:

- sign in and sign up;
- session retrieval;
- sign out;
- password reset;
- email verification;
- organization membership and invitations;
- impersonation/admin operations;
- the `set-auth-token` response header.

## Projects

Base path: `/api/projects`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | `project:read` | List projects for organization or superadmin scope |
| GET | `/:id` | `project:read` | Get project with source attachments |
| POST | `/` | `project:create` | Create project and optional initial sources |
| PATCH | `/:id` | `project:update` | Update project |
| DELETE | `/:id` | `project:delete` | Delete project, sources, and conversations |
| POST | `/:id/sources` | `project:manage-sources` | Attach a source |
| DELETE | `/:id/sources/:sourceId` | `project:manage-sources` | Detach a source |

Supported attachment kinds:

```ts
type DataSourceKind =
  | "airweave_collection"
  | "database"
  | "vector_db"
  | "external";
```

`external` is reserved but currently rejected as not implemented.

## Chat

Base path: `/api/chat`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/conversations` | `chat:read` | List the caller's conversations |
| POST | `/conversations` | `chat:create` | Create a project-scoped conversation |
| GET | `/conversations/:id/messages` | `chat:read` | List messages |
| POST | `/conversations/:id/messages` | `chat:stream` | Generate a non-streamed reply |
| POST | `/conversations/:id/messages/stream` | `chat:stream` | Generate an SSE reply |
| DELETE | `/conversations/:id` | `chat:delete` | Delete caller-owned conversation |

Conversation creation requires `projectId`. Chat history is scoped by user and
organization.

### SSE events

The stream uses named events:

| Event | Data |
|---|---|
| `start` | Persisted conversation and user message |
| `thinking` | Empty object |
| `searching` | Retrieval query |
| `sql_executed` | SQL, row count, rows for live display, truncation, duration |
| `chunk` | Answer text fragment |
| `complete` | Updated conversation, user message, persisted assistant message |
| `error` | Status code and message |

The agent domain defines internal `sql_planning` and `sql_executing` progress
events, but the current controller does not serialize them to SSE. The current
SPA handles every event listed in the table.

## Airweave

Base path: `/api/airweave`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/collections` | `airweave:read` | List organization-owned collections |
| POST | `/collections` | `airweave:create` | Create collection and record ownership |
| GET | `/collections/:collectionId` | `airweave:read` | Collection detail |
| PATCH | `/collections/:collectionId` | `airweave:update` | Rename/update collection |
| DELETE | `/collections/:collectionId` | `airweave:delete` | Delete unreferenced collection |
| POST | `/collections/:collectionId/search` | `airweave:read` | Search collection |
| GET | `/sources/:collectionId` | `airweave:read` | List source connections |
| POST | `/collections/:collectionId/source-connections` | `airweave:manage-sources` | Create direct-auth source |
| PATCH | `/source-connections/:id` | `airweave:manage-sources` | Update source |
| POST | `/source-connections/:id/reauth` | `airweave:manage-sources` | Reauthenticate source |
| DELETE | `/source-connections/:id` | `airweave:manage-sources` | Delete source |
| POST | `/connect/session` | `airweave:manage-sources` | Create catalog/OAuth connect session |

Non-superadmin collection visibility is filtered by organization ownership.
Direct reads of known collection IDs are rejected only when
`AIRWEAVE_READ_LOCKDOWN_ENFORCE=true`; production defaults to observe-only and
logs `airweave.read_would_403`. Destructive operations are refused when
projects still reference the source.

## SQL Connections

Base path: `/api/sql-connections`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | `sql-connection:read` | List public connection metadata |
| POST | `/` | `sql-connection:create` | Save encrypted connection |
| POST | `/test` | `sql-connection:update` | Test supplied credentials |
| PATCH | `/:id` | `sql-connection:update` | Update connection |
| POST | `/:id/test` | `sql-connection:update` | Test stored connection |
| DELETE | `/:id` | `sql-connection:delete` | Delete unreferenced connection |

Public responses omit passwords and ciphertext. `allowedTables` is optional and
accepts PostgreSQL identifiers such as `users` or `analytics.orders`.

## Vector Databases

Base path: `/api/vector-dbs`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | `vector-db:read` | List organization vector databases |
| GET | `/:id` | `vector-db:read` | Get vector database |
| POST | `/` | `vector-db:create` | Create Qdrant-backed vector database |
| PATCH | `/:id` | `vector-db:update` | Rename/update description |
| POST | `/:id/upload` | `vector-db:upload` | Upload document and queue ingestion |
| GET | `/:id/files` | `vector-db:read` | List ingestion jobs/files |
| DELETE | `/:id/files/:jobId` | `vector-db:delete` | Delete file record and S3 object |
| DELETE | `/:id` | `vector-db:delete` | Delete unreferenced vector database |

Upload is multipart form data with field name `file`. Maximum size is 50 MB.
Accepted MIME families cover PDF, DOCX, plain text, Markdown, CSV, and JSON.

Vector database status:

```ts
type VectorDbStatus = "empty" | "processing" | "ready" | "error";
```

Deletion is not currently a complete purge:

- deleting a file removes the ingestion row and attempts S3 deletion, but does
  not delete the file's Qdrant points;
- deleting a vector database is a soft delete and does not immediately purge
  its S3 objects or Qdrant collection;
- operators must not present these endpoints as immediate erasure until the
  reconciliation janitor is implemented.

Default role intent is: admin has all vector database actions; manager has
read/create/update/upload but not delete; member/viewer is read-only. The
persisted permission assignments remain authoritative.

## Administration

### Users

Base path: `/api/admin/users`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/me/approval-status` | Authenticated, pending allowed | Read caller approval/rejection state |
| POST | `/self-approve-invited` | Authenticated, accepted invitation required | Approve the invited caller |
| GET | `/create-metadata` | `user:read` | Roles/organizations available for user creation |
| GET | `/` | `user:read` | Paginated scoped user list |
| GET | `/pending` | `user:approve` | Paginated pending-user list |
| POST | `/:userId/approve` | `user:approve` | Approve user |
| POST | `/:userId/reject` | `user:approve` | Reject user with optional reason |
| POST | `/capabilities/batch` | `user:read` | Resolve actor capabilities for multiple users |
| GET | `/:userId/capabilities` | `user:read` | Resolve actor capabilities for one user |
| POST | `/` | `user:create` | Create user |
| PUT | `/:userId` | `user:update` | Update user profile |
| PUT | `/:userId/role` | `user:set-role` | Change role |
| POST | `/:userId/ban` | `user:ban` | Ban user |
| POST | `/:userId/unban` | `user:ban` | Unban user |
| POST | `/:userId/password` | `user:set-password` | Set user password |
| POST | `/:userId/impersonate` | `user:impersonate` | Start support impersonation |
| DELETE | `/:userId` | `user:delete` | Delete one user |
| POST | `/bulk-delete` | `user:delete` | Delete multiple users |

### Sessions

Nested under `/api/admin/users`:

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/:userId/sessions` | `session:read` | List scoped sessions |
| POST | `/sessions/revoke` | `session:revoke` | Revoke one token |
| POST | `/:userId/sessions/revoke-all` | `session:revoke` | Revoke all sessions for user |

### Organizations

Base path: `/api/platform-admin/organizations`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/` | `organization:create` | Create organization |
| GET | `/roles-metadata` | `organization:read` | Available membership roles |
| GET | `/` | `organization:read` | Paginated scoped organization list |
| GET | `/:id` | `organization:read` | Organization detail |
| GET | `/:id/members` | `organization:read` | Member list |
| GET | `/:id/member-candidates` | `organization:invite` | Search users eligible for membership |
| GET | `/:id/invitations` | `organization:read` | Invitation list |
| POST | `/:id/invitations` | `organization:invite` | Create invitation |
| DELETE | `/:orgId/invitations/:invitationId` | `organization:invite` | Revoke invitation |
| POST | `/:id/members` | `organization:invite` | Add existing user |
| PUT | `/:id/members/:memberId/role` | `organization:invite` | Change membership role |
| DELETE | `/:id/members/:memberId` | `organization:invite` | Remove member |
| PUT | `/:id` | `organization:update` | Update organization |
| DELETE | `/:id` | `organization:delete` | Delete organization |

Organization impersonation endpoints:

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/organization/:organizationId/impersonate` | `user:impersonate` | Impersonate a member in the organization |
| POST | `/api/organization/stop-impersonating` | Effective impersonation bearer token | End impersonation |

### RBAC

Base path: `/api/rbac`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/my-permissions` | Authenticated | Current effective permission strings |
| GET | `/roles` | `role:read` | Scoped role list |
| GET | `/roles/:id` | `role:read` | Role and permissions |
| POST | `/roles` | `role:create` | Create organization role |
| PUT | `/roles/:id` | `role:update` | Update role |
| DELETE | `/roles/:id` | `role:delete` | Delete unassigned non-global role |
| PUT | `/roles/:id/permissions` | `role:assign` | Replace permission assignments with anti-escalation checks |
| GET | `/permissions` | `role:read` | Permission catalog |
| GET | `/permissions/grouped` | `role:read` | Permission catalog grouped by resource |
| GET | `/users/:roleName/permissions` | `role:read` | Effective role permissions |
| GET | `/check/:roleName/:resource/:action` | `role:read` | Check one permission |

### Dashboard

Base path: `/api/admin/dashboard`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/organizations/list` | `dashboard:view` | Organizations visible to dashboard filters |
| GET | `/overview` | `dashboard:view` | Overview statistics |
| GET | `/users` | `dashboard:view` | User statistics for `7d`, `30d`, or `90d` |
| GET | `/chat` | `dashboard:view` | Chat statistics for `7d`, `30d`, or `90d` |
| GET | `/organizations` | `dashboard:view` | Organization statistics |

## Default Permission Families

- `user:*`
- `session:*`
- `organization:*`
- `role:*`
- `chat:read|create|stream|delete`
- `dashboard:view`
- `project:create|read|update|delete|manage-sources`
- `airweave:create|read|update|delete|manage-sources`
- `sql-connection:read|create|update|delete`
- `vector-db:read|create|update|delete|upload`

The persisted RBAC model is authoritative; default roles seed the initial
assignments.
