# ADR-011: Airweave collection ownership via `organization.metadata` allowlist

**Status:** Accepted (Decision 3 + Decision 4 amended 2026-05-23 after security review; OAuth-transport client contract amended 2026-05-25)
**Date:** 2026-05-23
**Deciders:** Engineering (api-velocity)

> **Amendment 1 (2026-05-23) — post-security-review.** The original Decision 3 used a *deterministic* `readable_id` (sha256-of-inputs) to enable "adopt-on-409" recovery. Security review found two HIGH issues: (a) a deterministic suffix is `O(1)` derivable by any caller who knows the target org's slug + a collection display name (org slugs are public; display names often leak via OAuth callback URLs and share links), and (b) the adopt-on-409 "recover-by-add" branch could silently grant cross-org ownership under slug-rename or legacy-id-match conditions. The decision was re-architected to use a true **random** suffix and to surface 409 as a real conflict (no adoption). Decision 3 below reflects the amended contract; Alt C is now the chosen approach, not rejected. Decision 4's default was also tightened to enforce in non-prod environments.

> **Amendment 2 (2026-05-25) — post-SPA-recon: OAuth client transport correction.** The SPA-side OAuth source-connection flow was originally built (spa-velocity `feat/airweave-collections-crud` commit `0a87506`) against a wrong understanding of Airweave's integration model. We assumed Airweave used an **open-new-tab + URL-encoded `?session_token=`** redirect-style portal at `https://app.airweave.ai/connect`. The actual Airweave Connect contract — confirmed at [docs.airweave.ai/connect](https://docs.airweave.ai/connect) — is an **iframe widget hosted at `https://connect.airweave.ai`** that transports the session token via **`postMessage` (`REQUEST_TOKEN` / `TOKEN_RESPONSE`)** and uses the official **`@airweave/connect-react` SDK** with the `useAirweaveConnect` hook for React consumers. The SDK auto-portals the iframe, enforces origin pinning, and emits `CONNECTION_CREATED` / `CLOSE` callbacks; URL-based token transport is never used. The original SPA implementation never worked against the real Airweave service.
>
> **Backend impact: NONE.** The backend's `POST /api/airweave/connect/session` + the OAuth-branch `POST /api/airweave/collections/:id/source-connections` already returned `sessionToken` in the exact shape the SDK's `getSessionToken` callback consumes — by accident, the right contract was built. The relevant Airweave docs quote is: *"Your backend creates a short-lived session token, your frontend passes it to the widget via postMessage."* Our backend implements the former; the SPA SDK now implements the latter.
>
> **The one backend cleanup (this amendment's code change):** the `redirectUri?: string` field on the OAuth discriminant of `CreateSourceConnectionBody` (api DTO) + the mirror field on `CreateAirweaveSourceConnectionParams` (service-internal type) + the corresponding `redirect_url` spread in the SDK call body were inherited from the wrong-contract design and never consumed in practice. Airweave Connect does NOT support a redirect URI — `CONNECTION_CREATED` / `CLOSE` postMessage callbacks replace it entirely. **Removed in this amendment.** Backward-compat preserved: per ADR-005 (no global ValidationPipe), unknown body fields are silently ignored, so any old client still sending `redirectUri` keeps working — the wire just drops the field on the floor.
>
> **SPA-side files affected** (in spa-velocity `feat/airweave-collections-crud`, R-OAuth Steps 0-6, separate PR):
> - DELETE `src/features/Airweave/hooks/useAirweaveOAuthPortal.ts` + spec
> - DELETE `src/features/Airweave/lib/popup-blocked-toast.ts`
> - NEW `src/features/Airweave/hooks/useAirweaveConnectModal.ts` (thin SDK wrapper)
> - REFACTOR `CreateSourceConnectionDialog.tsx` (OAuth tab now feeds token up to page-level modal; `DirectAuthForm` migrates to `zodResolver`)
> - REFACTOR `ReauthSourceConnectionButton.tsx` (uses the wrapper)
> - REFACTOR `AirweaveCollectionDetailPage.tsx` (lift `useAirweaveConnectModal` to page level via ref-mirror pattern; drop the "OAuth in progress" banner — SDK's `onSuccess` invalidates cache automatically)
> - RENAME `VITE_AIRWEAVE_PORTAL_URL` → `VITE_AIRWEAVE_CONNECT_URL`
> - KEEP `<meta name="referrer" content="strict-origin">` (general SPA hardening, not OAuth-specific)
> - KEEP `scrubSessionToken` (defense-in-depth on backend error messages)
>
> **Shape decisions (user-confirmed):**
> - **Token lifecycle (Path B)**: SPA reuses the cached `sessionToken` from the backend's create-source-connection response (one network call). On token staleness (>10 min TTL elapsed before SDK's `getSessionToken` callback fires) → SDK `onError` → toast "Click Reauth on the row to retry." No silent fallback; the Reauth row is the SDK-paved recovery surface.
> - **`onClose('cancel')` UX**: toast `Source created in pending state — complete OAuth later via Reauth on the row, or delete the row.` Pending source-connection row stays for user to resume; no auto-delete.
> - **Env var rename**: `VITE_AIRWEAVE_PORTAL_URL` → `VITE_AIRWEAVE_CONNECT_URL`. Default `https://connect.airweave.ai`. Override via SDK's `connectUrl` prop for self-hosted Airweave.
> - **Scrubber retention**: `scrubSessionToken` kept as defense-in-depth on any backend error message that might accidentally embed a session token. URL-based leakage is gone with postMessage, but error-string leakage is independent.
> - **Referrer meta tag retention**: general SPA-wide document hardening (not OAuth-specific). Zero runtime cost; protects all `target="_blank"` + `window.open` call sites in the SPA.

> **Amendment 3 (2026-05-26) — post-manual-test: BYOC (Bring Your Own Client) pass-through.** Manual smoke testing of the Amendment-2 OAuth flow surfaced an empty Airweave Connect widget for Slack: the modal opened, the postMessage handshake succeeded, the `Pending Auth` badge rendered — but no "Authorize" button. Root cause: the shared Airweave account doesn't have a preconfigured Slack OAuth app, so the widget can't generate the upstream consent URL. Airweave's API exposes this as the `Source.requires_byoc` flag and accepts per-source-connection BYOC fields on the create call: `client_id` / `client_secret` (OAuth2) or `consumer_key` / `consumer_secret` (OAuth1), plus an optional `redirect_uri`.
>
> **The mechanism Amendment 2 dropped is partially restored.** Amendment 2 removed `redirectUri` because the SDK's postMessage transport doesn't need it for the widget round-trip. Amendment 3 brings back `redirectUri` (and adds the four BYOC secret fields) — NOT as transport for the SDK handshake, but as **pass-through** to Airweave's `OAuthBrowserAuthentication` schema. Airweave stores these tied to the source-connection; Velocity persists nothing.
>
> **In-scope code changes:**
> - `airweave.dto.ts` — `CreateSourceConnectionBodyOAuth.authentication` gets 5 optional fields: `clientId`, `clientSecret`, `consumerKey`, `consumerSecret`, `redirectUri`.
> - `airweave.controller.ts` — new helper `trimAndPick` trims and drops empty-string values, so callers never accidentally forward `""` as a secret.
> - `airweave.service.ts` — new helper `buildOAuthBrowserAuth` maps camelCase Velocity fields to snake_case SDK fields, returns `undefined` when no BYOC fields are present (preserves the shared-OAuth-app code path verbatim).
> - SPA: `CreateSourceConnectionDialog.tsx` adds an "Advanced — Bring your own OAuth app" `<details>` disclosure with the 5 inputs. Zod schema (`createOAuthSourceConnectionSchema`) treats all 5 as optional and strips empty strings.
>
> **Out-of-scope (deliberately, see "Alternatives considered" §C):**
> - Org-level provider-credential storage in Velocity's own DB. The BYOC values live in Airweave only; if the user wants configure-once UX across many collections, that's a future ADR. Storing third-party OAuth app secrets in our DB takes on encryption + rotation + audit-log responsibility for something Airweave already handles.
>
> **Security posture:**
> - Velocity never persists BYOC values; they round-trip from form → `POST /api/airweave/collections/:id/source-connections` body → Airweave's database. Same lifecycle as the existing `direct` auth `credentials` blob (which the dialog has carried since the initial PR).
> - All five fields are scrubbed at the boundary (trim + drop-empty in the controller, transform-to-undefined in the Zod schema) so the wire never carries `""` as a secret.
> - The dialog's secret inputs use `type="password"` + `autoComplete="off"` so browser-side credential managers don't auto-fill with the user's own login creds and the values don't leak via developer tools history.
>
> **Backward-compat:** existing callers that omit the BYOC fields entirely keep working — the service detects "no BYOC fields present" and omits the `authentication` key on the SDK call (which is exactly what the pre-Amendment-3 code did). Only the new affordance is additive; nothing breaks.

## Context

Today the Airweave integration in `src/modules/airweave/` exposes only read operations against a single shared Airweave account: `listCollections`, `getCollection`, `searchCollection`, `listSourceConnections`, plus `createConnectSession` for the end-user OAuth flow. Collections must be created out-of-band in the Airweave portal, and a superadmin (or a one-time migration) records which collections each org may see by appending the `readable_id` to `organization.metadata.allowedAirweaveCollectionIds: string[]`. The current readers:

- `applyAirweaveAllowlist` in [airweave.controller.ts:143-166](../../src/modules/airweave/api/controllers/airweave.controller.ts) — filters the LIST response by the active org's allowlist (non-superadmins).
- The one-time seed `projects_003_seed_airweave_allowlist` in [projects.migration.ts:239-265](../../src/modules/projects/projects.migration.ts) — backfills `allowedAirweaveCollectionIds` from a legacy `metadata.airweaveCollectionId` field.
- A symmetric read in `projects.service.ts:436` consumed by the per-project data-source allowlist.

The PR introducing this ADR ([branch `feat/airweave-collections-crud`](../../)) lets Velocity users with the right permissions create, rename and delete collections and CRUD source connections directly from the Velocity UI, via the Airweave SDK. The structural question this ADR resolves is: **how is org-level ownership of a Velocity-created Airweave collection recorded?**

A second, coupled question: once Velocity originates collection IDs (instead of merely listing IDs created by an operator), the existing read endpoints become a cross-org data-exfiltration vector — `GET /collections/:id`, `POST /collections/:id/search`, `GET /sources/:collectionId`, and `POST /connect/session` currently gate on `organization:read` without checking the allowlist. An attacker in org B who knows or guesses a `readable_id` created by org A can read its metadata, search its content, list its sources, and even initiate an OAuth `createConnectSession` against it (attaching their own credentials to someone else's collection). This ADR also resolves the lockdown strategy for those read endpoints.

The forces at play:

1. **Existing allowlist seam** — `allowedAirweaveCollectionIds` is already the source of truth for "which collections may this org see", consumed by the LIST endpoint and seeded by an existing migration. Introducing a parallel table would split the single source of truth in two.
2. **Velocity-as-origin shifts the threat model.** While Velocity only listed collections, "guess the readable_id" required prior knowledge from a platform operator. Once Velocity creates them, the operator's role disappears and the IDs are derived from caller-supplied input — much easier to enumerate.
3. **Failure recovery** — Airweave's `collections.create` is the kind of upstream call that can succeed and then have the local follow-up (allowlist mutation) fail. The recovery shape determines whether retries produce orphans, duplicates, or convergence.
4. **`organization.metadata` is already mutable.** [AdminOrganizationsService.update](../../src/modules/admin/organizations/application/services/admin-organizations.service.ts) line 270 performs a full JSON-blob overwrite on `metadata` if `dto.metadata` is provided. Any new code that mutates `allowedAirweaveCollectionIds` field-locally MUST avoid that path (race risk against any other concurrent metadata writer — even though grep confirms no current caller of `update()` provides `dto.metadata`).
5. **RBAC nuance** — the natural permission set for the new feature has an asymmetry: `manage-sources` (managing data integrations inside a collection) is a frequent operator task; `delete` (disposing of the collection entirely) is a rarer, more consequential one. Treating both as a single permission is too coarse.

## Decision

We will adopt the following four coupled rules for the Airweave CRUD feature.

**Decision 1 — Ownership model.** A collection is owned by exactly one organization. Ownership is recorded by the presence of the collection's `readable_id` in `organization.metadata.allowedAirweaveCollectionIds`. No dedicated `airweave_collection_mapping` table is introduced. Legacy collections (not present in any org's allowlist) remain readable globally for backward compatibility but are NOT mutable from Velocity until a superadmin (or a future "claim" flow) explicitly assigns them.

**Decision 2 — Atomic allowlist mutation.** Two new methods on `IAdminOrgRepository` — `addAirweaveCollectionToAllowlist(orgId, readableId)` and `removeAirweaveCollectionFromAllowlist(orgId, readableId)` — use raw-SQL `jsonb_set` with `DISTINCT` to mutate the array idempotently and field-locally. The full-overwrite `update({ metadata })` path is bypassed for this field. (Raw SQL is the explicitly-listed ADR-001 fallback case for JSONB-array manipulation.)

**Decision 3 — Random suffix + fail-loud 409 (amended).** The server generates `readable_id` as `${orgSlug}-${slugHint||nameSlug}-${nonce8}` where `nonce8 = randomBytes(4).toString('hex')` — a true 32-bit random hex suffix per call. No caller can derive an existing collection's id from its name + org slug. On Airweave `409 Conflict`, the service surfaces a `ConflictException` to the caller naming the colliding `readable_id`; the caller's recovery is to retry with a different `slugHint` (or accept the new random nonce by reissuing). There is no adopt-on-409 path: this Velocity orchestration never calls `collections.get` to disambiguate, and never adds someone else's collection to its allowlist.

The orphan-on-timeout window is now handled operationally, not in-code: if Airweave create succeeds but the allowlist `UPDATE` fails (network or process death), the next retry generates a NEW random `readable_id` (no collision; clean second create). The previous orphan persists upstream in Airweave until a future reconciler cron (see Follow-ups) or a superadmin claim flow assigns it. This is acceptable because (a) orphans don't leak ownership (no allowlist entry → not visible to any non-superadmin), (b) the operational cost of an occasional orphan is lower than the security cost of the deterministic-derivation attack vector, and (c) clients retry rates are bounded and observable.

**Decision 4 — Read-path lockdown behind a feature flag (amended).** All collection-scoped reads (`GET /collections/:id`, `POST /collections/:id/search`, `GET /sources/:collectionId`, `POST /connect/session`) carry `@RequireAirweaveOwnership(...)`. Enforcement is gated by `AIRWEAVE_READ_LOCKDOWN_ENFORCE` with environment-aware defaults:

- **`NODE_ENV !== 'production'` → default `true`** (enforce). Dev / staging surface misconfigured callers immediately; the soak window is production-only.
- **`NODE_ENV === 'production'` → default `false`** (observe). The guard logs a structured `airweave.read_would_403` warning with `{userId, userRole, orgId, collectionReadableId, route, method, source}` and ALLOWS. Flip to `true` after ≥5 business days of zero would-403 events from legitimate frontend traffic — see the [CHANGELOG](../../CHANGELOG.md).

`AIRWEAVE_READ_LOCKDOWN_ENFORCE=true` overrides the default in any environment.

The LIST endpoint keeps its silent-filter semantics regardless of the flag (returning fewer rows is non-breaking; returning 403 on a per-id read is).

## Alternatives considered

- **Alt A — Dedicated `airweave_collection_mapping` table.** A new table `(id, airweave_collection_readable_id UNIQUE, organization_id FK, created_by_user_id FK, created_at)`. **Rejected.** Splits the single source of truth: the existing `applyAirweaveAllowlist` reader on the LIST endpoint + the `projects.service.ts` reader + the seed migration would all need migration to read from the new table (or worse, the table and the JSONB would be both read in parallel forever). Adds a new schema migration, a new repository, and new test surface. The JSONB allowlist is already the answer to "which collections may this org see"; ownership ("created by this org and may be mutated") is the same predicate with a different access intent — over the same data. One source, two intents.

- **Alt B — Read-modify-write of the JSONB blob via `AdminOrganizationsService.update({ metadata })`.** Fetch the org, splice the array client-side, call `update()`. **Rejected.** TOCTOU race with any other concurrent metadata writer — the `update()` method does a full overwrite. Even though grep confirms no current code path writes `metadata` outside the seed migration, future code might. Field-local `jsonb_set` is race-free at the database level and idempotent by construction.

- **Alt C — Optimistic 409-detection without adopt: surface every 409 to the caller.** **Chosen (as amended).** The orphan-on-timeout case (Airweave create succeeds, the local UPDATE fails before commit) means the orphan persists upstream until a reconciler runs. Acceptable because (a) random suffix on the retry means no false-409 collision, (b) orphans have no allowlist entry so they leak no ownership, (c) operational cost is bounded. The original Decision 3 chose adopt-on-409 to self-heal this case but security review found that the determinism required for self-healing created an `O(1)`-derivable identifier and a "recover-by-add" cross-org adoption path — both of which were judged worse than the operational cost of occasional orphans.

- **Alt D — Two-phase commit via an outbox / saga pattern.** A persisted intent record + a worker that completes the Airweave call + reconciles. **Rejected.** Massive infrastructure for a single integration. The fail-loud 409 contract (Alt C as amended) is simple, fail-fast, and surfaces orphans for the future reconciler-cron Follow-up to clean up. If/when we have three or more such integrations, the outbox pattern can be revisited.

- **Alt G — Deterministic suffix with adopt-on-409 (the original Decision 3).** Used `sha256(orgSlug | slugPart).slice(0, 8)` so retries with the same input would produce the same id, enabling self-healing. **Superseded by security review.** Two HIGH findings: (a) the suffix becomes `O(1)` derivable by any caller who knows the target org's slug + a collection display name, making `readable_id` no better than a public identifier for cross-org enumeration attacks against the read endpoints; (b) the "recover-by-add" branch silently grants ownership of an upstream collection to whichever org first generates a matching id, which under org-slug rename or legacy-id-match conditions can adopt another org's collection. Mitigations (require Airweave to expose tamper-resistant `organization_id` on the SDK shape; forbid org-slug renames; ship a salted nonce per request) were judged costlier than the simpler "go random, fail loud" option.

- **Alt E — Lockdown all read endpoints in the same PR as CRUD (no feature flag).** **Rejected.** Step 9 of the implementation plan changes 200→403 for non-superadmin reads of legacy collections. If any frontend page cold-calls `GET /collections/:id` with an id it didn't first see in a LIST response, that page breaks in the brief allowlist-propagation window after a create. Feature flag + observability soak surfaces those callers before the breaking flip. Cost: one extra small PR; benefit: a measured rollout instead of a revert-or-hotfix.

- **Alt F — Replace `manage-sources` with a finer split (`source:create | source:update | source:delete`).** **Rejected for v1.** Five-action vs seven-action permission tables; the asymmetry between "manager has manage-sources but not collection delete" is intentional and documented (see Consequences below). If usage patterns reveal it's wrong, splitting later is a low-cost migration. Kept as a follow-up.

## Consequences

### Positive

- **One source of truth.** `organization.metadata.allowedAirweaveCollectionIds` continues to be the single answer to "may this org see this collection". Adding "may this org mutate" as the same predicate keeps the model coherent.
- **Unguessable identifiers.** Random 32-bit suffixes mean a `readable_id` cannot be derived from public inputs (org slug + display name). Cross-org enumeration via the read endpoints requires either obtaining the id from a legitimate response (in which case ownership gating applies) or guessing it (2^32 birthday-bound).
- **Atomic allowlist mutation.** Field-local `jsonb_set` cannot stomp other fields of `metadata` and cannot leave the array in a duplicated state.
- **Measured read-path lockdown.** The would-403 log lets us see exactly which callers (frontend page, user role, route) hit the cross-org boundary before turning it into a 403. Reduces "ship-and-revert" risk to near zero.
- **Smaller migration surface.** No new table, no new entity, no TypeORM `@InjectRepository` plumbing for ownership. The two new repository methods are additive to `IAdminOrgRepository`.

### Negative

- **Orphan collections from failed creates are operational debt.** When Airweave create succeeds but the allowlist `UPDATE` fails (network or process death after the upstream commit), the upstream collection exists without an owner. The caller's retry produces a different random id (no collision), creating a clean second collection. The original orphan persists in Airweave and is not visible from Velocity (no allowlist entry → silent-filter on LIST hides it, ownership guard blocks all per-id reads). A future reconciler cron (Follow-ups) sweeps these. Operationally bounded; security-acceptable.
- **Stale allowlist entries are tolerated.** If a superadmin deletes a collection directly in the Airweave portal, the org's `allowedAirweaveCollectionIds` still contains the orphan `readable_id`. `requireOwnership` will grant access (allowlist is the source of truth for the *authorization* decision); the subsequent Airweave call will return 404, which surfaces naturally to the caller. A future claim/unclaim flow + reconciler cron is needed to clean this up; tracked in Follow-ups.
- **`manage-sources` asymmetry.** Manager-role users can delete a *source connection* but not the *collection* that contains it. Rationale: collections are containers — disposing of them is a more consequential, lower-frequency action that warrants gating to admin only. Sources are configuration — managing them is the day-to-day operator work. Asymmetric but intentional, and the asymmetry is the natural one (managers do day-to-day, admins dispose of structural things). If usage patterns reveal it's wrong, Alt F unblocks a finer split.
- **JSONB ownership has no FK semantics.** Deleting an organization does NOT cascade-delete its Airweave collections (Postgres doesn't enforce FKs into JSONB). The org delete leaves the `readable_id`s present in Airweave until a future delete flow notices the parent is gone. This is acceptable for the current threat model (Velocity is a single tenant of Airweave; abandoned collections cost storage but not security), but a dedicated mapping table WOULD have caught this with a FK. Documented as a known limitation.
- **Read-path lockdown is a second PR.** Step 10b is explicitly out of this PR's main scope. The observability soak before flipping the flag is an operational gate, not a code gate; it requires log-aggregator access and human attention. Tracked in Follow-ups.
- **Orphan-id leak in error messages.** Failure-mode row 1 returns the orphan `readable_id` in the error body so the caller can re-claim manually. The id is always the caller's own (the generator embeds the caller's `orgIdSlug`), so this is not a cross-org information leak.

### Nonce-length collision math

With `nonce8 = 32 truly random hex bits` (per amended Decision 3), the per-`(orgSlug, slugPart)` collision space is 2^32. Two callers in the same org choosing the same `slugHint` need ~65k attempts to hit a 50% birthday collision. At realistic volumes (≤1k collections per `(orgSlug, slugHint)` bucket), collision probability is < 0.001%. When a collision DOES occur, the caller receives a `ConflictException` and retries (different random nonce → different id → succeeds). The earlier 4-char (16-bit) nonce would have produced caller-facing 409s at ~256 collections per bucket — too noisy for production. 8 chars (32 bits) is the minimum for a clean caller experience under realistic volumes.

**Why not a longer nonce?** A 64-bit (16-char) nonce would push the birthday boundary to ~4 billion attempts, but the resulting `readable_id` becomes unwieldy in URLs and logs. 32 bits is the sweet spot: cryptographically unguessable for cross-org attackers (one in 2^32 lookup probability per random guess), low enough collision rate to never surface in practice for own-org calls.

### Follow-ups

- **Claim flow for legacy collections.** Superadmin endpoint `POST /api/airweave/collections/:id/claim` that pushes an existing un-mapped collection's `readable_id` into a chosen org's allowlist. Required to migrate the pre-existing legacy collections that this ADR explicitly leaves globally readable.
- **Reconciler cron.** Sweeps allowlists for entries whose Airweave collection no longer exists; auto-prunes after a grace period. Closes the stale-allowlist case from Negatives.
- **Audit log.** Structured-log events `airweave.collection.{created,deleted}` and `airweave.source_connection.{created,deleted}` with `organizationId`, `userId`, `readableId`. Currently the only structured signal is the would-403 warning from the feature-flag rollout.
- **`manage-sources` split.** If usage patterns reveal manager-source-delete is too permissive, split into `airweave:source:create | source:update | source:delete`. Migration cost is one rbac_NNN migration that maps the existing `manage-sources` row to the three new ones.
- **Org-delete cascade.** Decide whether deleting an organization should also delete its Airweave-side collections, or merely orphan them. Today neither happens; the question is currently moot because org delete is rare and behind superadmin.

## Assumption-pin table

The CRUD feature relies on seven assumptions about Airweave + the codebase. Each is pinned by a downstream verification step. (Original assumption A7 — "cross-org `get(readableId)` returns 200/404, not 403" — was retired by the Amendment 1 re-architecture: the service no longer calls `collections.get` cross-org during create.)

| Assumption | Verified by |
|---|---|
| A1: `AdminOrganizationsService.update` is full-overwrite on `metadata` | Step 0 grep — confirmed at `admin-organizations.service.ts:270` (`updates.metadataJson = JSON.stringify(dto.metadata)`) |
| A2: Airweave SDK supports `collections.{create,update,delete}` and `sourceConnections.{create,update,delete,get}` | Architect-reviewer SDK type-definition verification |
| A3: Airweave returns `409 Conflict` on duplicate `readable_id` | Step 4a smoke test |
| A4: Airweave `collections.delete` returns `404` (not silent success) when already gone | Step 5 smoke test |
| A5: Airweave's source-connection delete cancels in-flight syncs server-side | Step 7 characterization test |
| A6: No other code path mutates `allowedAirweaveCollectionIds` outside the seed migration | Step 0 grep — confirmed 4 references, all reads or one-time seed |
| A8: Frontend never cold-calls `GET /collections/:id` with ids it has not first seen in LIST | Step 10a observability soak (≥5 business days of zero `airweave.read_would_403` events from legitimate frontend traffic) |

## References

- **Existing readers of the allowlist:**
  - [airweave.controller.ts:143-175](../../src/modules/airweave/api/controllers/airweave.controller.ts) — `applyAirweaveAllowlist` + `readAllowedAirweaveCollectionIds`.
  - [projects.service.ts:436](../../src/modules/projects/application/services/projects.service.ts) — symmetric per-project allowlist read.
  - [projects.migration.ts:239-265](../../src/modules/projects/projects.migration.ts) — one-time seed migration.
- **New surfaces this ADR sanctions (planned, see `feat/airweave-collections-crud` plan file):**
  - `IAdminOrgRepository` — two new allowlist methods + `isInAllowlist`.
  - `AirweaveOwnershipGuard` + `@RequireAirweaveOwnership` / `@RequireAirweaveOwnershipFromBody` decorators.
  - `AirweaveAuthorizationService` (extracted `applyAirweaveAllowlist`).
  - `airweave.service.ts` — `createCollection` / `updateCollection` / `deleteCollection` / `createSourceConnection` / `updateSourceConnection` / `reauthSourceConnection` / `deleteSourceConnection`.
  - `rbac_020_add_airweave_permissions` migration in `rbac.migration.ts`.
- **Related ADRs:**
  - [ADR-001](./ADR-001-typeorm-first-persistence.md) — raw-SQL fallback for JSONB array mutation is the explicitly-listed permitted case. This ADR exercises that fallback.
  - [ADR-003](./ADR-003-no-global-exception-filter.md) — new code throws typed NestJS exceptions (`BadRequestException`, `ForbiddenException`, `ConflictException`, `ServiceUnavailableException`, `BadGatewayException`); no global filter.
  - [ADR-004](./ADR-004-nestjs-logger-no-pino.md) — the would-403 warning uses NestJS `Logger`; structured fields embedded in the log message.
  - [ADR-005](./ADR-005-no-class-validator-no-validation-pipe.md) — DTOs are plain TypeScript `interface`s; validation lives in service methods.
  - [ADR-009](./ADR-009-clean-architecture-layering-for-modules.md) — `IAdminOrgRepository` lives under `domain/repositories/`; the raw-SQL adapter lives under `infrastructure/persistence/repositories/`; the new authorization service lives under `application/services/`.
- **Plan file:** `~/.claude/plans/imperative-bubbling-wren.md` (architect-reviewer APPROVE_PLAN at confidence 0.92).
