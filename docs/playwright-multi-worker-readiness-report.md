# Playwright Multi-Worker Readiness Report
Version: 1.0  
Repositories: `api-ampliri` (report location), `spa-ampliri` (implementation target)  
Date: 2026-03-08  
Audience: LLM/agents implementing Playwright suite splitting and worker-safe E2E execution with minimal regression risk.

## 1. Goal

Prepare the `spa-ampliri` Playwright suite for multiple workers by splitting the suite into explicit execution lanes, removing shared mutable fixtures from the fast lane, and preserving a stable serial fallback until the new path is deterministic.

## 2. Scope

### 2.1 In scope
1. Split the current Playwright suite into `parallel-safe`, `mixed/refactor`, and `serial` execution lanes.
2. Add a worker-safe fast lane that can run with multiple Playwright workers.
3. Refactor E2E helpers so worker-safe tests no longer depend on one shared mutable actor.
4. Identify and isolate tests that mutate global RBAC, sessions, organizations, or seeded auth state.
5. Break up large monolithic serial specs so worker-safe subsets can be promoted incrementally.
6. Preserve a conservative serial path for remaining stateful tests.
7. Add implementation guidance, risk controls, and verification gates suitable for an LLM to execute.

### 2.2 Out of scope
1. Do not change product behavior, API contracts, or authorization rules as part of this effort.
2. Do not add retries to hide flaky tests.
3. Do not redesign Better Auth or replace auth/session infrastructure.
4. Do not make database schema changes solely for this Playwright split unless a true blocker is found.
5. Do not globally set `workers > 1` for the whole suite in the first implementation pass.

## 3. Current State Summary

### 3.1 Current Playwright config
`spa-ampliri/playwright.config.ts` is intentionally conservative today:

- `fullyParallel: false`
- `workers: 1`
- `globalSetup: './e2e/global-setup.ts'`
- `globalTeardown: './e2e/global-teardown.ts'`

This is already a strong signal that the suite is not globally worker-safe.

### 3.2 Shared-state patterns already confirmed
1. `e2e/global-setup.ts` creates or restores one shared seeded `TEST_USER`, makes it admin, clears sessions, and rewrites default role permissions.
2. `e2e/global-teardown.ts` deletes the shared `TEST_USER` and related rows.
3. Several specs directly mutate the same `TEST_USER` role and session state.
4. Several specs rewrite global `role_permissions` for the built-in `manager` role.
5. Several specs insert or remove session rows directly in the DB.
6. Several suites are marked `test.describe.serial(...)` because they rely on ordered execution.
7. A few specs are read-only and are good candidates for the first worker-safe lane.

### 3.3 Important caveat about `test.describe.serial(...)`
`test.describe.serial(...)` only serializes tests inside that file or describe block. Once Playwright `workers > 1`, separate files can still run concurrently and interfere with each other. Therefore, serial blocks are **not** an adequate whole-suite worker-safety mechanism.

## 4. Hard Invariants

These are mandatory implementation rules.

1. The `parallel-safe` lane must not mutate shared global actors.
2. The `parallel-safe` lane must not mutate built-in global role permissions.
3. No worker-safe spec may depend on data created by another spec file.
4. Every mutable fixture in the worker-safe lane must be worker-owned.
5. Worker-owned data must use deterministic uniqueness, not plain `Date.now()` alone and not shared stable names.
6. UI assertions must target deterministic fixture rows, not the first arbitrary row from a mutable table.
7. The legacy serial lane must remain available until the parallel-safe lane is proven stable.
8. Authorization behavior must remain unchanged by the test refactor.
9. For impersonation-related tests, the authorization source of truth remains the `user:impersonate` permission; role names describe current supported role bundles and domain constraints, not the authorization source itself.

## 5. Current Problem Files and Why They Block Workers

### 5.1 Shared seeded user hotspot
These files rely on or mutate the shared `TEST_USER` and therefore are unsafe to run concurrently with other stateful files:

- `e2e/rbac-unified-roles.spec.ts`
  - explicitly states it uses a single test user and changes that user’s role between suites
  - clears sessions and updates active organization state for that shared actor
- `e2e/rbac-impersonation.spec.ts`
  - restores shared admin state and clears sessions
- `e2e/admin.spec.ts`
  - restores shared admin state and relies on seeded admin fixtures
- `e2e/full-coverage.spec.ts`
  - repeatedly restores the shared user to admin and mixes many mutation-heavy flows
- `e2e/admin-gaps.spec.ts`
  - toggles the shared test user role and sessions
- `e2e/sessions-edge.spec.ts`
  - restores shared admin state before seeding synthetic sessions
- `e2e/admin-policy-api.spec.ts`
  - authenticates through `TEST_USER` and ensures it is admin-backed in DB
- `e2e/auth.spec.ts`
  - mixes shared-user login flows with unique-user signup flows
- `e2e/navigation-integrity.spec.ts`
  - uses shared seeded login, though it looks structurally easier to convert
- `e2e/auth-invitation-flow.spec.ts`
  - uses shared seeded login flow and invitation continuation state

### 5.2 Global RBAC mutation hotspot
These files mutate shared RBAC tables for built-in roles and therefore cannot be considered worker-safe:

- `e2e/roles-manager-permissions.spec.ts`
  - deletes and recreates `role_permissions` rows for `manager`
- `e2e/manager-impersonation-banner.spec.ts`
  - same global `manager` permission rewrite pattern
- `e2e/global-setup.ts`
  - resets default permissions for built-in roles at suite startup

### 5.3 Session mutation hotspot
These files create or delete session rows directly and therefore require isolation discipline:

- `e2e/rbac-sessions-matrix.spec.ts`
- `e2e/sessions-edge.spec.ts`
- `e2e/rbac-unified-roles.spec.ts`
- `e2e/rbac-impersonation.spec.ts`
- `e2e/admin.spec.ts`
- `e2e/full-coverage.spec.ts`
- `e2e/admin-gaps.spec.ts`

### 5.4 Monolithic serial hotspot
These files are too broad to promote whole-cloth into a fast worker lane:

- `e2e/full-coverage.spec.ts`
- `e2e/rbac-unified-roles.spec.ts`
- `e2e/admin.spec.ts`
- `e2e/admin-gaps.spec.ts`
- `e2e/rbac-impersonation.spec.ts`

They should be split before any serious worker promotion is attempted.

## 6. Recommended Target Architecture

### 6.1 Execution lanes
Use three explicit lanes.

#### A. `parallel-safe`
- Runs with multiple workers.
- Contains only read-only tests or tests with fully isolated worker-owned fixtures.
- Must not rely on shared seeded admin role toggling.

#### B. `mixed/refactor`
- Files that contain some potentially safe tests but still depend on shared actors or mutation-heavy helpers.
- These should be converted incrementally.

#### C. `serial`
- Runs with `workers: 1`.
- Keeps all remaining shared-state, role-mutation, and monolithic specs until refactored.

### 6.2 Preferred split mechanism
Use a phased split mechanism.

#### Phase-1 split recommendation
1. Keep `playwright.config.ts` as the conservative serial baseline.
2. Add a second config for the fast lane, for example:
   - `playwright.fast.config.ts`
3. Initially select fast-lane files via explicit file allowlist or dedicated script arguments.
4. Only after the first promotions are stable, consider moving or extracting specs into clearer folder-based groups.

This avoids a disruptive mass file move in the first implementation pass.

### 6.3 Worker count recommendation
Start modestly.

- Local initial fast-lane worker count: `2`
- CI initial fast-lane worker count: `2`

Increase only after repeated green runs show no flake pattern.

## 7. Proposed Initial Suite Classification

This is the initial execution target, not a permanent classification.

### 7.1 First `parallel-safe` candidates
These are the safest first promotions.

1. `e2e/health-api.spec.ts`
   - read-only backend health check
2. `e2e/roles-api.spec.ts`
   - read-only DB/API structure checks

### 7.2 `mixed/refactor` candidates
Convert these after worker-owned fixtures exist.

1. `e2e/auth.spec.ts`
   - split public unauthenticated tests from shared seeded login flows
   - move unique-user signup flows into the fast lane first
2. `e2e/navigation-integrity.spec.ts`
   - likely promotable after replacing shared seeded login dependency
3. `e2e/sessions-edge.spec.ts`
   - requires worker-scoped users and synthetic sessions
4. `e2e/organizations-edge.spec.ts`
   - requires worker-owned admin actor and deterministic org/member fixtures
5. `e2e/admin-policy-api.spec.ts`
   - may be promotable after shared admin dependence is removed or isolated
6. `e2e/auth-invitation-flow.spec.ts`
   - likely mixed because it depends on auth continuation state and seeded login

### 7.3 Keep `serial` in the first migration wave
1. `e2e/admin.spec.ts`
2. `e2e/admin-gaps.spec.ts`
3. `e2e/full-coverage.spec.ts`
4. `e2e/rbac-unified-roles.spec.ts`
5. `e2e/rbac-impersonation.spec.ts`
6. `e2e/roles-manager-permissions.spec.ts`
7. `e2e/manager-impersonation-banner.spec.ts`
8. `e2e/rbac-capabilities-contract.spec.ts`
9. `e2e/rbac-organizations-matrix.spec.ts`
10. `e2e/rbac-roles-matrix.spec.ts`
11. `e2e/rbac-sessions-matrix.spec.ts`
12. `e2e/rbac-users-matrix.spec.ts`
13. `e2e/users-permissions-matrix.spec.ts`
14. `e2e/guards.spec.ts` unless audit proves it is mutation-free
15. `e2e/roles-visibility-rules.spec.ts` unless audit proves it is fully isolated

## 8. Files Likely To Change

### 8.1 Primary config and script files
- `spa-ampliri/playwright.config.ts`
- `spa-ampliri/package.json`
- optional new `spa-ampliri/playwright.fast.config.ts`

### 8.2 Shared E2E helper layer
- `spa-ampliri/e2e/env.ts`
- `spa-ampliri/e2e/global-setup.ts`
- `spa-ampliri/e2e/global-teardown.ts`
- `spa-ampliri/e2e/test-helpers.ts`
- likely a new worker-aware fixture/helper module under `spa-ampliri/e2e/`

### 8.3 First conversion targets
- `spa-ampliri/e2e/auth.spec.ts`
- `spa-ampliri/e2e/navigation-integrity.spec.ts`
- `spa-ampliri/e2e/sessions-edge.spec.ts`
- `spa-ampliri/e2e/organizations-edge.spec.ts`
- `spa-ampliri/e2e/admin-policy-api.spec.ts`

### 8.4 Deferred serial-only refactor targets
- `spa-ampliri/e2e/full-coverage.spec.ts`
- `spa-ampliri/e2e/rbac-unified-roles.spec.ts`
- `spa-ampliri/e2e/admin.spec.ts`
- `spa-ampliri/e2e/admin-gaps.spec.ts`
- `spa-ampliri/e2e/rbac-impersonation.spec.ts`
- `spa-ampliri/e2e/roles-manager-permissions.spec.ts`
- `spa-ampliri/e2e/manager-impersonation-banner.spec.ts`

## 9. Target Fixture Model

### 9.1 Introduce worker-aware fixture primitives
Create a shared helper capable of generating a unique namespace per worker and per test.

Minimum inputs:
- `workerIndex`
- test title or test id fragment
- stable prefix such as `e2e`

Use this namespace to derive:
- user emails
- org slugs
- org names
- role names
- invitation emails
- synthetic session labels

### 9.2 Replace unstable uniqueness patterns
Avoid these as the only uniqueness strategy:
- plain `Date.now()`
- hardcoded stable emails reused across runs
- shared fixed slugs like `manager-org`

Preferred approach:
- one helper that builds namespaced values consistently
- one cleanup model that deletes only rows owned by the current test or worker

### 9.3 Recommended helper responsibilities
Extend `e2e/test-helpers.ts` or create a new fixture module with responsibilities such as:
1. create worker-owned verified users
2. create worker-owned organizations
3. create worker-owned memberships
4. create worker-owned synthetic sessions
5. sign in as a worker-owned actor
6. clear only worker-owned state
7. optionally build a cleanup registry for same-test teardown

## 10. Implementation Workstreams

## 10.1 Workstream 1: Establish explicit lane boundaries
**Objective:** Create a safe execution split before refactoring deep internals.

### Changes
1. Keep the current serial config intact.
2. Add a fast-lane config or script with `workers: 2`.
3. Wire package scripts so local and CI runs can execute:
   - stable serial lane
   - fast lane
4. Ensure the default full run still points to the stable serial path until the migration is proven.

### Expected outcome
A non-disruptive multi-lane setup exists without changing broad suite semantics.

### Tests / verification
1. `playwright test` still behaves as before.
2. Fast lane can run the first read-only specs with multiple workers.
3. No existing serial-only tests are accidentally included in the fast lane.

## 10.2 Workstream 2: Build worker-owned fixture primitives
**Objective:** Remove shared seeded actor assumptions from the fast lane.

### Changes
1. Add worker-aware naming helpers.
2. Add actor creation helpers that return fully isolated users.
3. Stop relying on global seeded `TEST_USER` in worker-safe paths.
4. Keep the old seeded path available for serial files during transition.

### Expected outcome
New worker-safe tests can create and own their own auth and org state.

### Tests / verification
1. Helper unit tests where practical.
2. Focused E2E conversions proving two independent worker-owned actors can coexist.

## 10.3 Workstream 3: Convert mixed candidates into fast-lane tests
**Objective:** Promote safe subsets without touching the highest-risk monoliths first.

### Priority order
1. `navigation-integrity.spec.ts`
2. worker-safe subset of `auth.spec.ts`
3. `sessions-edge.spec.ts`
4. `organizations-edge.spec.ts`
5. `admin-policy-api.spec.ts`

### Conversion rules
1. Extract mutation-heavy tests out of mixed files if needed.
2. Keep the old shared-user versions in the serial lane until replacements are proven.
3. Promote only converted files or extracted files, not half-safe mixed files.

### Expected outcome
The fast lane grows incrementally while the serial lane shrinks safely.

## 10.4 Workstream 4: Isolate global RBAC mutation flows
**Objective:** Prevent global `role_permissions` rewrites from colliding across workers.

### Changes
1. Keep `roles-manager-permissions.spec.ts` and `manager-impersonation-banner.spec.ts` serial initially.
2. If later parallelization is desired, redesign these tests to avoid rewriting built-in role permission rows.
3. Any future redesign must preserve the permission-led model for impersonation and capability checks.

### Expected outcome
Global permission-table mutation is contained to the serial lane.

## 10.5 Workstream 5: Break up monolithic serial files
**Objective:** Enable file-level promotion by decomposing broad serial umbrellas.

### Target files
1. `full-coverage.spec.ts`
2. `rbac-unified-roles.spec.ts`
3. `admin.spec.ts`
4. `admin-gaps.spec.ts`
5. `rbac-impersonation.spec.ts`

### Rules
1. Split read-only visibility assertions away from mutation-heavy CRUD flows.
2. Do not move and change behavior in the same step if avoidable.
3. Prefer helper extraction first, then file extraction.
4. Keep feature coverage stable while reducing cross-domain coupling.

### Expected outcome
Future promotions become possible at file granularity instead of all-or-nothing.

## 10.6 Workstream 6: Raise fast-lane concurrency carefully
**Objective:** Increase speed only after the lane is stable.

### Changes
1. Start with `workers: 2`.
2. Run repeated focused passes.
3. Only then consider increasing worker count.
4. Reconsider default global config only after the serial bucket is small and proven isolated.

### Expected outcome
Better wall-clock time without introducing hidden flakes.

## 11. Recommended Step-by-Step Execution Plan For Another LLM

### Phase A — Baseline split
1. Create the fast-lane config or scripts.
2. Allowlist only `health-api.spec.ts` and `roles-api.spec.ts` in the fast lane.
3. Keep everything else on the serial path.
4. Verify the default run is unchanged.

### Phase B — Worker fixture foundation
1. Introduce worker-owned naming utilities.
2. Introduce worker-owned actor/org/session helpers.
3. Leave old helpers in place temporarily for serial specs.
4. Do not convert broad monoliths yet.

### Phase C — First mixed-file conversions
1. Convert `navigation-integrity.spec.ts` to worker-owned auth.
2. Split `auth.spec.ts` into:
   - public/unauthenticated tests
   - worker-owned signup/auth tests
   - shared-user legacy tests, if still needed
3. Convert `sessions-edge.spec.ts` to worker-owned seeded users and sessions.
4. Promote only the converted files into the fast lane.

### Phase D — Structured extraction from serial monoliths
1. Extract read-only or worker-isolatable tests from `admin.spec.ts` and `rbac-unified-roles.spec.ts` into smaller files.
2. Keep permission-rewrite and shared-role-toggle flows serial.
3. Re-run focused subsets after each extraction.

### Phase E — Concurrency increase
1. Run the fast lane repeatedly with `workers: 2`.
2. If deterministic, consider increasing local worker count.
3. Delay CI worker increases until no flakes are observed across repeated runs.

## 12. Verification Strategy

### 12.1 Focused verification during implementation
Run the smallest relevant slice first.

Examples:
1. fast lane only
2. one converted file only
3. one serial file only after extraction

### 12.2 Regression gates
At minimum, verify:
1. baseline serial lane still passes
2. fast lane passes repeatedly
3. converted files do not require retries
4. mixed-to-fast promotions do not break auth, impersonation, or org flows

### 12.3 Wall-clock success metric
Track:
1. baseline serial duration
2. fast-lane duration
3. repeated-run flake rate
4. combined pipeline duration after split

## 13. Suggested Commands For The Implementing LLM

These are guidance commands, not mandatory exact names if the implementation chooses slightly different scripts.

### Current investigation commands
- `npm run test:e2e:list`
- `playwright test --list`

### Intended future commands
- serial baseline, unchanged behavior
- fast-lane multi-worker run
- focused file runs for converted specs

If new package scripts are added, keep them explicit and predictable, for example:
- one script for stable serial
- one script for fast lane
- one script that runs both sequentially

## 14. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Shared `TEST_USER` still leaks into fast lane | High | Convert fast-lane files to worker-owned actors before promotion |
| Global `role_permissions` rewrites collide across workers | Critical | Keep permission-rewrite specs serial until redesigned |
| `test.describe.serial(...)` gives false confidence | High | Use lane-level isolation, not only file-level serial blocks |
| Stable emails/slugs collide across repeated runs | High | Replace with worker-aware deterministic namespaces |
| Generic selectors pick the wrong row under concurrent writes | Medium | Use deterministic fixture rows and explicit search keys |
| Monolithic files hide mixed-safe and unsafe tests | Medium | Decompose large files before promotion |
| Impersonation regressions due to incorrect authorization assumptions | High | Preserve `user:impersonate` as permission source of truth; roles remain bundles/domain constraints only |
| CI becomes slower instead of faster due to poor split | Medium | Keep fast lane small at first, measure, then expand |

## 15. Definition of Done

1. A distinct Playwright fast lane exists and runs with multiple workers.
2. The fast lane contains only worker-safe files.
3. The serial lane remains available and green.
4. No worker-safe spec mutates shared seeded actors or built-in global permissions.
5. Mixed files promoted to fast lane use worker-owned fixtures.
6. Large monolithic serial files are reduced or partially extracted where appropriate.
7. Repeated fast-lane runs show deterministic results without retries.
8. The migration preserves product behavior and auth/RBAC semantics.
9. Impersonation-related tests still model authorization as permission-driven.

## 16. Final Recommendation

Do **not** globally turn on Playwright workers for the entire suite as the first move. Implement an explicit fast lane, introduce worker-owned fixture primitives, promote only proven isolated files, and keep RBAC mutation and shared-admin flows serial until they are redesigned or decomposed.

## 17. Implementation Notes For Another LLM

1. Prefer small, reviewable diffs.
2. Do not rewrite the whole E2E suite in one pass.
3. Convert one mixed file at a time and prove it green before promoting it.
4. Avoid broad file moves in the first step; use config/scripts first, then refactor files.
5. When touching impersonation tests, keep the permission-driven model explicit.
6. Treat the current serial lane as the rollback path until the fast lane is proven stable.
7. If a spec still mutates shared built-in role permissions, it is not fast-lane ready.
8. If a spec still logs in as one shared mutable actor, it is not fast-lane ready.
