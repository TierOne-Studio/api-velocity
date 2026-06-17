# Coordination plan — "Collections" → "Airweave Collections" rename (cross-repo)

**Repos:** api-velocity + spa-velocity · **Branch (both):** `feat/airweave-collections-rename`
**Type:** breaking wire + persisted-config rename → **the two PRs ship together.**
**Governing decision:** **api-velocity ADR-011 Amendment 6** (2026-06-16) — the authoritative record of what renames and what stays.

This doc exists per `cross-repo-workspace` Rule 3 (cross-repo feature → coordination doc enumerating per-repo steps, each under its own lens, with per-repo suites). Placed in api-velocity because the load-bearing breaking surfaces (data migration, wire contract, ADR) are backend-led. Referenced from both PR descriptions.

## The rename, in one line

Bare `collection*` identifiers become `airweaveCollection*` (wire JSON fields, persisted `config` keys, internal symbols, UI strings). **Already-`airweave` surfaces and external/SDK surfaces do NOT change** — see ADR-011 Amendment 6 for the exhaustive KEEP list (route path `/api/airweave/collections`, DB enum `airweave_collection`, RBAC `airweave:*`, metadata `allowedAirweaveCollectionIds`, route param `:collectionId`, SDK `client.collections.*`/`readable_id`, terse `Airweave*`-class methods).

## Shared wire contract (must match on both sides)

| Surface | Old | New |
|---|---|---|
| Source-connection response field | `collectionReadableId` | `airweaveCollectionReadableId` |
| Delete-conflict (409) body field | `collectionReadableId` | `airweaveCollectionReadableId` |
| Connect/session request body field | `collectionId` | `airweaveCollectionId` |
| Delete-collection response field | `collectionId` | `airweaveCollectionId` |
| Project data-source `config` keys (persisted) | `collectionReadableId`, `collectionName` | `airweaveCollectionReadableId`, `airweaveCollectionName` |

## api-velocity steps (NestJS lens)

- `api-velocity:` **Migration** `projects_005_rename_airweave_config_keys` — forward-rename the persisted `config` keys (idempotent, scoped to `kind='airweave_collection'`). Verify: integration test vs real Postgres (variants: both/partial/empty/non-airweave/idempotent). **Done.**
- `api-velocity:` **Config readers/writers** — `project.dto.ts` type, provider, repo (runtime SQL `config->>` at `:211` renames; migration `:167` idempotency read stays old-key), `projects.service.ts`, `chat-router.service.ts`. Verify: tsc + provider/repo/service/chat specs. **Done.**
- `api-velocity:` **Wire fields + body decorator** — `airweave.service.ts` summary/conflict + mapping; `airweave.controller.ts` connect/session body + `@RequireAirweaveOwnershipFromBody('airweaveCollectionId')` + DELETE response; decorator docstring. Verify: tsc + a **deterministic** connect/session ownership-coupling spec (`airweave-connect-session-ownership.spec.ts`) — the live `airweave-live.spec.ts` hits the real Airweave SDK and is not the gate. **Done.**
- `api-velocity:` **Internal symbols/vars** — bare DTOs, local vars/params (incl. admin/organizations allowlist params, `AirweaveOwnershipGuard` var), keeping terse methods + route params. Verify: tsc + full unit suite + residual grep. **Done.**
- `api-velocity:` **ADR-011 Amendment 6** + this coordination doc. **Done.**
- `api-velocity:` **Gate** — `npm test` + e2e vs real Postgres + `security-reviewer` (migration + RBAC-adjacent) + `code-reviewer` + `qa-validator` + `acceptance-verifier`.

## spa-velocity steps (React lens)

- `spa-velocity:` **Wire + config field renames (FE-1)** — `Airweave/types`, `Projects/types` (`AirweaveCollectionSourceConfig`), `ProjectFormDialog` config read/send, connect/session send (`source-connections.service.ts`), e2e mocks (`airweave-helpers.ts` + cross-track consumers `airweave-live.spec.ts`, `catalog-flow.spec.ts`). **Endpoint path strings unchanged.**
- `spa-velocity:` **Internal symbols/files (FE-2)** — `collections.service.ts`→`airweave-collections.service.ts`, dialog components, schemas, bare types, ~130 local var/param/prop sites (incl. the `toHaveProperty("collectionReadableId")` assertion). Keep free service functions terse; keep query-key root `['admin','airweave-collections']`.
- `spa-velocity:` **UI strings (FE-3)** — bare "Collection(s)" → "Airweave Collection(s)" + breaking Playwright/Vitest text assertions. Do NOT touch `/collection actions/i` (substring-survives) or the data-driven `/actions for <name>/i` family.
- `spa-velocity:` **Gate** — `tsc -b` + `vitest run` + `eslint` + **full Playwright (`test:e2e:full`)** + `code-reviewer` + `qa-validator` + `acceptance-verifier`.

## Cross-repo verification

- **Contract grep:** `rg "airweaveCollectionReadableId|airweaveCollectionId"` in both repos; no surface emits/reads the old names.
- **Residual sweep:** `rg -ni "collection"` returns only the ADR-011 Amendment-6 KEEP allowlist.
- **Deploy:** together (BE migration runs at boot). SRE: update dashboards keyed on the renamed `airweave.read_would_403` / `airweave.source_connection.*` log keys (ADR-011 Amendment 6).
