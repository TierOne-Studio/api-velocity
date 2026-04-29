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

### 4. Contradictions

Skill rule contradicts CLAUDE.md or another skill.

Symptom: model gives inconsistent answers depending on which skill fires.
Fix: resolve at the higher-priority layer (CLAUDE.md > hook > skill).

### 5. Dead skills

Skill never fires. Either the trigger description doesn't match real prompts, or the situation it covers doesn't occur in this codebase.

Fix: rewrite trigger or remove.

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
