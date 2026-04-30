---
name: meta-skill-hygiene
description: Use when reviewing the skill library for quality — typically monthly, after 5+ approved curator proposals, or when skills feel like they're misfiring or overlapping. NOT a routine skill. NOT for adding individual skills (that's lessons-curator). Invoke deliberately for an audit.
---

# Meta-Skill Hygiene

Periodic audit of the skill library. Goal: prevent rot, overlap, and trigger misfires.

## Six audit checks

### 1. Overlap

Two skills with descriptions that could trigger on the same prompt.

Symptom: model picks one inconsistently.
Fix: merge, or sharpen description disambiguation.

### 2. Vague descriptions

Description missing "Use when…" or "NOT for…" clause, or using soft words ("maybe", "sometimes", "could").

Fix: rewrite description to be specific and exclusive.

### 3. Bloat

Skill body has grown past ~200 lines or contains content that's actually CLAUDE.md material (always-on rules) or hook material (mechanical rules).

Fix: extract to the right layer.

**~500-line split threshold.** When a SKILL.md exceeds ~500 lines, the skill is too dense to be loaded efficiently — split into a directory with this layout (canonical example: `nestjs-patterns/`):

```
skill-name/
├── SKILL.md           ← entry point: description + index of sub-files (≤200 lines)
├── REFERENCE.md       ← deep-detail reference (loaded on-demand)
├── EXAMPLES.md        ← worked examples (loaded on-demand)
├── patterns/          ← named sub-patterns the entry point routes to
│   ├── pattern-a.md
│   └── pattern-b.md
└── rules/             ← when the skill is rule-catalog-shaped (e.g., nestjs-best-practices)
    └── rule-name.md
```

The parent SKILL.md tells the agent which sub-file to load for which situation; the model loads only what's relevant. Don't pre-emptively split — apply this when the skill genuinely passes ~500 lines OR when distinct sub-shapes (patterns, rules, references) emerge.

### 4. Contradictions

Skill rule contradicts CLAUDE.md or another skill.

Symptom: model gives inconsistent answers depending on which skill fires.
Fix: resolve at the higher-priority layer (CLAUDE.md > hook > skill).

### 5. Dead skills

Skill never fires. Either the trigger description doesn't match real prompts, or the situation it covers doesn't occur in this codebase.

Fix: rewrite trigger or remove.

### 7. CLAUDE.md cross-coupling (Layered-router principle)

CLAUDE.md is a pure router — it points to skills and subagents but does NOT enumerate Layer-3 artifacts. The principle is owned by `documentation-and-adrs` § "Layered-router principle" and enforced by acceptance test T74. Audit drift:

- Scan CLAUDE.md for `ADR-[0-9]{3}` regex matches → flag MED, propose moving citation to `repo-conventions` ADR table or the relevant meta-skill.
- Scan for file paths (`src/`, `docs/`, `.claude/skills/`, `.claude/agents/`) → flag MED.
- Scan for code symbols (decorators like `@RequirePermissions`, class names like `PermissionsGuard`, function names like `resolveOrgScope`) → flag MED. Boundary case: literal command tokens that ARE the rule (`git push`, `INSERT`, AI-attribution trailer strings) are allowed because the rule literally matches those strings.
- Scan for subagent internal step references (e.g., "see code-reviewer Step 5") → flag LOW.

Fix: move the citation into the relevant skill or subagent file; CLAUDE.md keeps only the skill/subagent name. Each artifact citation lives in exactly one place.

### 6. Missing disambiguation

A frequent prompt fires no skill, or fires the wrong one.

Fix: add a new skill with a precise description, or sharpen an existing one.

## Process

1. **List** — enumerate every skill in `.claude/skills/`.
2. **Walk** — apply each of the six checks across the library.
3. **Propose** — produce a prioritized cleanup list (HIGH / MED / LOW).
4. **STOP** — do **not** edit any skill file. The user reviews the proposals and approves before any change.

## Output format

```
Audit summary:
- Skills reviewed: <N>
- Issues found: <N high / N med / N low>

HIGH:
1. <skill> — <issue> — <proposed fix>
   ...

MED:
1. ...

LOW:
1. ...

Recommended order: <list of skill names in fix order>
```

## Anti-patterns

- Auto-applying changes (always wait for approval).
- Proposing 20 changes at once (cap at ~5 high-priority items per audit).
- "Skill-as-fix" when consolidation works better — if two skills overlap, prefer merging.
- Renaming a skill without updating CLAUDE.md skill-pointer table or hook references.
- Editing skill descriptions cosmetically (changes triggering behavior; treat as load-bearing).
