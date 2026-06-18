# ADR-013: Specification-first documentation workflow

- **Status:** Accepted (amended 2026-06-17: paired documentation widened to ADRs)
- **Date:** 2026-06-04
- **Deciders:** Mariano Ravinale (with architect-reviewer)

> **Amendment 1 (2026-06-17) — paired documentation widened from SPEC-only to SPEC-or-ADR.** The
> `spec-gate` originally accepted only a `docs/specs/**` SPEC as the documentation paired with a
> behavioral `src/**` change. It now also accepts a `docs/decisions/**` **ADR** (new or amended): a
> change documented via a decision record — common for bug fixes and decision changes — satisfies the
> gate without a separate SPEC. SPECs remain the preferred artifact (intended behavior + acceptance
> criteria → tests); ADRs capture decisions/rationale. Unrelated docs (README, coordination plans) do
> NOT count, and the three `[skip-spec: type-only|config-no-behavior|non-code]` waivers are unchanged.
> Residual risk — pairing a behavioral change with an unrelated/trivial ADR edit — is a code-review
> concern; the gate is deliberately a coarse net. Implemented in `scripts/spec-gate.sh` (fixture AC2b
> in `scripts/__tests__/spec-gate.test.sh`) and recorded in `SPEC-000`. Mirrored in `spa-velocity`.

## Context

The LLM jumped straight to code, leaving no durable SPEC/PRD history, stale docs after fixes,
undocumented or wrong assumptions, and code↔doc drift. CLAUDE.md enforced TDD, review subagents,
and a definition of done, but nothing required *documentation* before code. This is the
api-velocity (`contract` layer) half of a cross-repo workflow; the spa-velocity counterpart is
`spa-velocity ADR-011`, and the full design lives in `spa-velocity:docs/spec-first-workflow-proposal.md`.
This decision is load-bearing — it adds a force-fire skill (P3.4), a review subagent (P4), a
definition-of-done clause (P8.0), a new priority subsection (P3.0), a doc folder, a CI gate, and a new agent.

## Decision

Every **behavioral** code change MUST create or update a Markdown SPEC under `docs/specs/`
(layer `contract`: entities, endpoints, DTOs, RBAC, migrations) BEFORE implementation, with
material ambiguities resolved with the user, and reconcile it with what shipped AFTER. The
`spec-workflow` skill is the procedure; the write-capable `spec-steward` agent (scoped to
`docs/specs/**`) is the single writer; the `spec-gate` CI workflow + completeness/links lints are
the deterministic guarantee. The only exemptions are the `tdd-workflow` waiver categories
(non-code / type-only / config-no-behavior); "small/obvious/trivial" are never exempt.

## Alternatives considered

- **Plan-mode only (no persisted artifact):** rejected — ephemeral; no durable record, cannot be gated in CI; docs drift as before.
- **Specs only in spa-velocity / single shared docs repo:** rejected — a spec detached from a repo's own CI can't be gated when that repo changes alone; a backend-only change would not trigger any spec update (silent drift). Per-repo layer-split closes that gap.
- **Read-only spec author:** deferred as the fallback — the write-capable steward owns docs end-to-end; if "judge + fix" in one agent proves too much, the read-only variant is a drop-in.

## Consequences

- **Positive:** durable spec history; assumptions surfaced + corrected; code↔doc drift caught by a hard gate; entity changes forced to ship a migration; specs are the artifact `architect-reviewer` reviews pre-implementation.
- **Negative:** two specs per cross-cutting feature (one per layer) + cross-links to maintain; a first write-capable subagent (precedent) — contained mechanically to `docs/specs/**`; the T13 CLAUDE.md word gate was raised 3350→3850 (master was already 3704 pre-existing; spec-first added P3.0).
- **Follow-ups:** feature backfill (separate PRs); the OpenAPI machine-link deferred pending cross-repo CI Phase C.

## References

- Source files where the rule manifests: the `spec-workflow` skill, the `spec-steward` agent, the `spec-gate` workflow, `scripts/spec-*.sh`, `docs/specs/`.
- Skills that cite this ADR: `spec-workflow`, `documentation-and-adrs`.
- CLAUDE.md sections: P3.0, P3.4, P4, P8.0.
- Related: `api-velocity SPEC-000`; cross-repo counterpart `spa-velocity ADR-011` + `spa-velocity#SPEC-000` (qualify per `cross-repo-workspace` Rule 2).
