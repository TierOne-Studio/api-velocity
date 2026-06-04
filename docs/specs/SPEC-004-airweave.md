---
id: SPEC-004
title: "SPEC-004: Airweave contract (collections, sources, ownership, OAuth session)"
status: Implemented
layer: contract
owner: Mariano Ravinale
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/modules/airweave
related_adrs: [ADR-011]
related_specs: [SPEC-002]
counterpart_spec: "spa-velocity#SPEC-004"
coordination_doc: ""
---

# SPEC-004: Airweave contract

> **Backfill** — current, test-backed contract. ACs map to existing Jest specs. The `ui` counterpart
> is `spa-velocity#SPEC-004`.

## 1. Summary (intended behavior)

Proxies the upstream Airweave SDK for **collections** (list/get/create/rename/delete/search) and
**source connections** (list/create/rename/delete/reauth), plus a **connect-session** token endpoint
for the OAuth catalog widget. Ownership is via `organization.metadata.allowedAirweaveCollectionIds`
(ADR-011): LIST silently filters; per-collection reads/mutations are ownership-gated (a feature flag
observes-vs-enforces on the read path). Create uses a random nonce slug (409 fail-loud on collision;
orphan recovery), delete refuses (409) when projects reference the collection. Direct-auth sources are
created inline; OAuth routes through the widget (in-app OAuth body → 400). Permissions:
`airweave:{read,create,update,delete,manage-sources}`.

## 2. Context & problem

Crosses two trust boundaries (external Airweave service + OAuth tokens) and is multi-tenant. Load-
bearing rules (ADR-011): allowlist ownership, random-nonce-no-adopt-on-409, the read-lockdown flag, the
inline lookup-then-gate for source mutations, and body-level org membership re-validation (Amendment 5).

## 3. Scope

**In scope:** collection CRUD (random nonce, 409 collision, orphan recovery, refuse-on-reference
delete, 404 idempotency), search (classic/instant tiers), source CRUD (direct create, OAuth-body
rejection, inline lookup-then-gate, reauth deny-by-default), connect-session token, ownership
(allowlist filter + assert + membership), read-lockdown flag, upstream error mapping (404/409/429/502).

**Out of scope / non-goals (thin coverage — §9):** live upstream SDK behavior (mocked), JSONB
allowlist mutation atomicity under concurrency, orphan-reconciler cron (not built), org-delete cascade
(no FK on JSONB), the SPA-side widget/postMessage flow (tested in `spa-velocity#SPEC-004`).

## 4. Assumptions

1. [Confirmed] Ownership via `organization.metadata.allowedAirweaveCollectionIds`: LIST filters (superadmin→all; no org→[]; non-string ignored) (`airweave-authorization.service.spec.ts:62`).
2. [Confirmed] Per-collection assert: superadmin bypass; no org → 403; not-owned → 403 with claim-flow message (`airweave-authorization.service.spec.ts:146`).
3. [Confirmed] Read-lockdown flag: OFF → log `read_would_403` + allow; ON → propagate 403; non-403 always thrown (`airweave-ownership.guard.spec.ts:220`).
4. [Confirmed] Create uses a random nonce; 409 collision → ConflictException (no adopt); orphan (allowlist write fails) → 409 (`airweave.service.spec.ts:736,788,811`).
5. [Confirmed] Source mutations use inline lookup-then-gate (ADR-011 §7); reauth denies-by-default on unknown method; in-app OAuth create body → 400 (Amendment 4) (`airweave.service.spec.ts:1045,1147`; `airweave.controller.spec.ts:642`).
6. [Confirmed] Body-level `organizationId` on create re-validates membership (404 no org / 403 not member; no superadmin exemption) (Amendment 5) (`airweave.controller.spec.ts:409,429,444`).

## 5. Affected areas

- `src/modules/airweave/{api,application,infrastructure}/*` — controller, service, authorization service, ownership guard, SDK provider.
- Ownership state: `organization.metadata.allowedAirweaveCollectionIds` (JSONB).
- Upstream: `@airweave/sdk` client (`AIRWEAVE_API_KEY`, `AIRWEAVE_BASE_URL`); `POST {base}/connect/sessions` for the widget token.
- Endpoints: `GET/POST /api/airweave/collections[/:id]`, `PATCH/DELETE /collections/:id`, `POST /collections/:id/search`, `GET /sources/:collectionId`, `POST /collections/:id/source-connections`, `PATCH/DELETE /source-connections/:id`, `POST /source-connections/:id/reauth`, `POST /connect/session`.

## 6. Acceptance criteria (mapped to existing tests)

| # | Criterion | Proving test |
|---|---|---|
| AC1 | Each endpoint carries the right `airweave:*` permission; class-level `PermissionsGuard` applied | `airweave.controller.spec.ts:59,68` |
| AC2 | LIST allowlist filter: superadmin→all; no org→[]; org allowlist filters; non-string entries ignored | `airweave-authorization.service.spec.ts:62` |
| AC3 | Per-collection ownership assert: superadmin bypass; no org→403; not-owned→403 claim-flow | `airweave-authorization.service.spec.ts:146` |
| AC4 | Read-lockdown flag OFF→log+allow; ON→403; non-403 always thrown; bad source param→400 | `airweave-ownership.guard.spec.ts:112,220` |
| AC5 | Create: random nonce distinct per call; org-not-found→404; 409 collision→Conflict (no adopt); allowlist-write fail→409 orphan | `airweave.service.spec.ts:736,763,788,811` |
| AC6 | Create body-org (Amendment 5): active-org default; body-org+member ok; not-member→403; no-org→404; empty→400 | `airweave.controller.spec.ts:389,409,429,444,483` |
| AC7 | Delete: 409 with project list on references; clean delete; upstream 404→proceed cleanup; 5xx→502 no cleanup | `airweave.service.spec.ts:871,891,910,929` |
| AC8 | Source create: direct delegates; in-app OAuth body→400; unknown kind→400; non-object credentials→400 | `airweave.controller.spec.ts:615,642,667,687` |
| AC9 | Source mutations inline-gate (lookup→assert→mutate); reauth rejects direct-auth + deny-by-default on unknown | `airweave.service.spec.ts:1045,1070,1139,1147` |
| AC10 | Connect-session issues a token; SDK unconfigured→503; upstream error→502; 429 pass-through with retryAfterSeconds | `airweave.service.spec.ts:355,386,420` |

## 7. Implementation plan

N/A — backfill. Future Airweave changes update this spec first.

## 8. Testing plan

Jest unit: `src/modules/airweave/**/*.spec.ts` (controller, service, authorization service, ownership guard, sdk provider) — ~120 tests, SDK mocked. Run `npx jest src/modules/airweave`.

## 9. Risks & failure modes

- **Live upstream behavior is mocked** — collision rate / SDK stability are ADR-011 assumptions, not live-validated.
- JSONB allowlist mutation atomicity under concurrent writers is **unverified**; orphan-reconciler + org-delete cascade are acknowledged gaps (ADR-011 follow-ups).
- The widget/postMessage flow lives in `spa-velocity#SPEC-004`; session tokens are short-lived + redacted.

## 10. Open questions

- Should the source-catalog contract the widget consumes be owned here as the SSoT?

## Change Log

- 2026-06-04 · PR (backfill) · created · documents the Airweave contract; 10 ACs mapped to existing Jest specs (ownership, read-lockdown, random-nonce, inline-gate, connect-session).
