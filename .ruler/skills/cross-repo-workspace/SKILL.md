---
name: cross-repo-workspace
description: Use ALWAYS when the Claude Code session has access to both api-velocity AND spa-velocity (primary cwd is one repo and the other is in Additional working directories). Governs the lens-switching rule (which repo's conventions apply per file), the ADR-qualification rule (both repos use overlapping ADR numbers with different meanings), the coordination-doc pattern for cross-repo features, and the prompt-target convention. NOT for single-repo sessions; NOT for sessions accessing only one of these two repos; NOT for any other repo combination.
---

# Cross-Repo Workspace (api-velocity ↔ spa-velocity)

This skill fires when a session has both `api-velocity` and `spa-velocity` as working directories. It governs how the active doctrine (`CLAUDE.md`, `.claude/skills/`, `.claude/agents/`, `.claude/settings.json`) — which is loaded from ONE repo per Claude Code session — interacts with cross-repo work.

## When this fires

- Primary cwd is api-velocity, spa-velocity is in Additional working directories (or vice versa).
- A prompt mentions both repos by name, OR references files in both trees, OR asks for coordinated work (API endpoint + SPA consumer hook, shared DTO, auth-token contract changes).
- A response would benefit from path-based lens-switching to give correct framework-specific advice.

## When this does NOT fire

- Single-repo sessions (just one repo loaded — the active doctrine applies as-is).
- Sessions involving any other repo combination.
- Read-only investigations that don't propose changes (the active lens is harmless when only reading).

## Topology

```
Workspace
├── api-velocity (BFF/API — NestJS + TypeORM + better-auth server)
│   ├── CLAUDE.md / .claude/* / .ruler/*
│   └── docs/decisions/ ADR-001..009 (NestJS/server decisions)
└── spa-velocity (React SPA — Vite + React 19 + Zustand + TanStack Query + better-auth)
    ├── CLAUDE.md / .claude/* / .ruler/*
    └── docs/decisions/ ADR-001..010 (React/SPA decisions)
```

The active CLAUDE.md, force-load matrix, subagent files, and settings come from the **primary cwd**. The other repo is reachable via file Read but its doctrine is NOT auto-loaded.

## Rules

### Rule 1 — Active-lens by path

The active doctrine for any operation is determined by the **file being touched**, not by the primary cwd:

| File path contains | Active lens |
|---|---|
| `/api-velocity/` | api-velocity (NestJS, TypeORM-first or raw-SQL, RBAC scope contract, NestJS exceptions, etc.) |
| `/spa-velocity/` | spa-velocity (React, function components, Zustand + TanStack Query, RHF + Zod, `<ProtectedRoute>`, etc.) |
| Workspace-spanning doc (coordination plan, comparison doc) | Declare explicitly which side's conventions apply where |

When the file being touched belongs to the **non-primary** repo, MUST:

1. **Read the target repo's `.ruler/skills/repo-conventions/SKILL.md`** before proposing edits. The active session's `repo-conventions` (force-loaded by P3.4) describes the WRONG repo for that file — replace its framing in working memory with the target repo's.
2. **Read the target repo's `.ruler/instructions.md`** (or `CLAUDE.md`) for the force-load matrix and subagent triggers that side uses. The active session's P3.4 force-loads also describe the wrong repo.
3. **Honor the target repo's P3.4 force-load** — even though the harness has loaded the primary repo's force-load skills, the *correct* list is the target repo's. For api-velocity edits: tdd-workflow, repo-conventions, failure-mode-analysis, design-review, plan-mode (NestJS-flavored), plus async-error-handling and database-transactions where applicable. For spa-velocity edits: tdd-workflow, repo-conventions, failure-mode-analysis, design-review, plan-mode (React-flavored), react-patterns, accessibility.
4. **For post-impl review**, invoke the **target repo's subagent**: `Read /absolute/path/to/<target-repo>/.ruler/agents/<subagent>.md` first, then apply its criteria. The active session's subagent file describes the wrong repo.

If the file you're about to touch is in the non-primary repo and you cannot read the target repo's doctrine (filesystem error, permissions, etc.), **stop and escalate**. Do not edit with the wrong lens.

### Rule 2 — ADR-qualification (mandatory in workspace context)

Both repos use overlapping ADR numbers with **different meanings**:

```
                   api-velocity                    spa-velocity
ADR-001    TypeORM-first persistence       Zustand for client state
ADR-002    RBAC scope=all returns 400      TanStack Query for server state
ADR-003    No global exception filter      React Router 7
ADR-004    NestJS Logger, no pino          Tailwind 4 + Radix + CVA
ADR-005    No class-validator              RHF + Zod
ADR-006    Asks-first dep gate          ╳  Vitest + Testing Library + Playwright
ADR-007    Skill-vs-repo resolution    ╳   better-auth + localStorage.bearer_token
ADR-008    No AI attribution           ═══ No AI attribution (concept identical)
ADR-009    Clean-architecture layering ╳   Asks-first dependency gate
ADR-010    (none)                       ╳  Skill-vs-repo conflict resolution
```

Only ADR-008 matches by number AND meaning. Every other number is a trap.

**Rule:** in any context that mentions both repos, OR that is itself a cross-repo artifact (coordination doc, cross-repo PR description, response that compares both sides), ADR references MUST always qualify the repo:

- ✅ "Per **api-velocity** ADR-001 (TypeORM-first persistence)"
- ✅ "Per **spa-velocity** ADR-007 (better-auth + localStorage.bearer_token)"
- ❌ "Per ADR-007" — ambiguous in workspace context; refuse to act on bare references until clarified

Inside a file that lives in repo X and only discusses repo X, bare `ADR-NNN` is fine (it means repo X's ADR-NNN by construction). The qualifier becomes mandatory the moment the citation crosses repo boundaries.

### Rule 3 — Coordinated cross-repo features

For features that span both repos (new API endpoint + new SPA hook consuming it; auth-flow contract change; shared DTO update; cross-cutting RBAC permission rollout):

1. **Author a coordination plan** in `docs/<feature>-coordination-plan.md` in the repo that owns the user-visible behavior (usually spa-velocity for end-user features; api-velocity for backend-only changes).
2. **The plan enumerates per-repo steps**, each prefixed with the target:
   - `api-velocity:` — steps applied under api-velocity's lens
   - `spa-velocity:` — steps applied under spa-velocity's lens
   Each side gets its own dependency graph + slice strategy + verifier per `plan-mode`.
3. **Implement each side under its own lens** (Rule 1).
4. **Run each side's test suite from that side's cwd.** `npm test` from one repo does NOT cover the other (different runtimes, different scripts).
5. **Commit per-repo** (two separate branches, two separate PRs). Reference the coordination doc from both PR descriptions. Don't try to merge one PR before the other is ready — they ship together.

### Rule 4 — ADR adoption that binds both repos

When a single decision binds both repos (e.g., the auth-token contract that api-velocity's server enforces and spa-velocity's ADR-007 codifies on the client side):

- Write **ONE primary ADR** in the repo where the rule mostly lives (the one with the larger surface area or the originating constraint).
- Add a **`Reference:` row** to the other repo's `docs/decisions/README.md` pointing at the primary ADR with the qualifier:

  > | Reference | See **spa-velocity** ADR-007 (better-auth + localStorage.bearer_token) — paired client-side contract for the bearer-token flow this API serves. |
- Skills in both repos cite with the qualifier.

Do NOT write the same conceptual ADR twice with different numbers in each repo — that's exactly the trap that the ADR-006/ADR-009 (asks-first) and ADR-007/ADR-010 (skill-vs-repo) pairs already represent. Future bilateral decisions get a single ADR with a cross-reference.

### Rule 5 — Memory-keying

Auto-memory is keyed by absolute repo path; api-velocity and spa-velocity memory namespaces are **isolated**. A `feedback` memory written from an api-velocity session is not visible to a spa-velocity session, and vice versa.

For cross-repo lessons (e.g., "the API changed the token shape but the SPA wasn't updated, broke production"), MUST capture the lesson **TWICE** — once per repo — until workspace-level memory tooling exists. The `lessons-curator` invocation should mention both target memory namespaces explicitly:

> Saving this lesson to BOTH `~/.claude/projects/<api-velocity-path>/memory/` AND `~/.claude/projects/<spa-velocity-path>/memory/` (cross-repo lesson per `cross-repo-workspace` Rule 5).

### Rule 6 — Prompt-target convention

The user's convention is to lead prompts with the target repo:

- `api-velocity: ...` — applies to api-velocity only
- `spa-velocity: ...` — applies to spa-velocity only
- `both: ...` — workspace-spanning work

When a prompt is **ambiguous** about target repo, MUST ask:

> Target repo? (api-velocity / spa-velocity / both)

Do not guess. The cost of asking once is much lower than the cost of editing the wrong repo's code or applying the wrong lens.

Unprefixed prompts may default to the primary cwd **only if** the request is clearly about that side from content (e.g., "add a controller" → api-velocity by content; "add a React component" → spa-velocity by content). When in doubt, ask.

### Rule 7 — Settings-gate scope (informational)

The session's `permissions.deny` / `permissions.ask` block is loaded from the **primary repo's** `.claude/settings.json`. Both repos currently use the same hard-gate patterns (block main/master writes, force pushes, `npm publish`, deploy commands, etc.) — so the gates apply correctly to either repo from this session.

If the gates ever diverge between repos:
- The primary repo's gates win for the session.
- Verify before doing destructive work in the other repo from this session.
- Consider re-running the destructive command from a session whose primary cwd is the target repo.

## Output contract addition

When this skill fires, the response's `Skills consulted:` line MUST include `cross-repo-workspace`. When Rule 1 caused a lens-switch (file in the non-primary repo), the response MUST also state:

> Lens-switch: applied **<target-repo>** conventions for files under `/<target-repo>/`. Read `<absolute-path>/.ruler/skills/repo-conventions/SKILL.md` before editing.

This makes the lens-switch auditable so a future review knows which repo's rules the model followed.

## Enforcement directives (audit items for subagents)

When this skill is loaded into a session, the following audit items apply IN ADDITION to each subagent's normal mandate. Subagents reading this skill MUST honor them.

### ENFORCE-1: Per-repo `architect-reviewer` invocation (cross-repo plans)

When the plan under review touches files in BOTH repos, the `architect-reviewer` that loads from the primary cwd MUST ALSO read the non-primary repo's `.ruler/agents/architect-reviewer.md` and apply its criteria to the non-primary-side steps. A plan reviewed from only the primary repo's perspective is incomplete — the non-primary side's conventions (NestJS layering rules vs React feature-folder rules, etc.) will not be checked. A cross-repo plan where only one architect-reviewer ran is a **MED finding** minimum; the verdict should list "non-primary side not audited" in Required revisions.

### ENFORCE-2: Coordination-doc presence (cross-repo plans)

Per Rule 3, cross-repo features require `docs/<feature>-coordination-plan.md` in the user-visible-side repo. The `architect-reviewer` MUST audit cross-repo plans for the coordination-doc step. If the plan introduces a cross-repo feature but no coordination-doc step exists in the per-step list, that is a **HIGH finding** — the plan is missing the structural artifact that prevents per-side drift, per-side branch confusion, and bilateral-ADR collisions.

### ENFORCE-3: Lens-switch attestation (cross-repo diffs)

The `code-reviewer` MUST audit diffs that modify files under the non-primary repo's path (per Rule 1) for the literal `Lens-switch:` attestation line in the implementer's response:

> Lens-switch: applied **<target-repo>** conventions for files under `/<target-repo>/`. Read `<absolute-path>/.ruler/skills/repo-conventions/SKILL.md` before editing.

If the diff modifies non-primary-repo files but the response lacks this line, that is a **HIGH finding** — the implementer cannot have followed Rule 1 without attesting to it. The attestation IS the evidence that Rule 1 was followed; absence of attestation = absence of evidence = treat as Rule 1 violation.

### ENFORCE-4: Bare ADR-NNN in cross-repo context (any subagent reviewing cross-repo artifacts)

Per Rule 2, cross-repo artifacts (coordination docs, cross-repo PR descriptions, responses that compare both sides) MUST qualify every ADR reference with the repo name (`api-velocity ADR-XXX` or `spa-velocity ADR-XXX`). Any subagent reviewing a cross-repo artifact MUST grep the artifact for bare `ADR-[0-9]+` references not preceded by a repo qualifier. Each bare reference in a cross-repo context is a **MED finding** — Rule 2 violation, recoverable by adding the qualifier.

## Anti-patterns

- **Applying api-velocity rules to spa-velocity code** (or vice versa) because the active doctrine got loaded from the primary cwd. The whole point of this skill.
- **Bare ADR-NNN citations in workspace context.** Always qualify.
- **Bundling cross-repo work into one PR.** Each repo gets its own branch + PR + reviewers.
- **Forgetting to read the target repo's `repo-conventions` when crossing.** The active session's `repo-conventions` describes the wrong codebase for the target file.
- **Running `npm test` from one cwd and claiming it covers the other.** Different runtimes, different scripts.
- **Guessing target repo from an ambiguous prompt.** Ask instead.
- **Treating ADR-007 in api-velocity as equivalent to ADR-007 in spa-velocity** because they share a number. They don't share meaning.

## Cross-references

- `repo-conventions` (both repos) — the per-repo binding facts each lens routes to.
- `documentation-and-adrs` — ADR format and citation flow. The cross-repo qualification rule above extends `documentation-and-adrs` § "How to cite ADRs."
- `plan-mode` — coordination plan structure for Rule 3.
- `decision-rules` — when an active-skill conflict arises across repos, this skill takes precedence (it's the workspace-aware authority); the conflict-resolution rule in `decision-rules` § 6 then operates within the chosen lens.

## Future work (not yet built)

- Workspace-level memory shared across repos.
- A pre-commit hook that detects cross-repo work in a single commit and warns.
- A CI check that flags bare ADR-NNN references in cross-repo docs.

These are out of scope for this skill body; they're potential improvements when the cross-repo workload grows enough to justify them.
