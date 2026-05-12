---
name: pushback-templates
description: Use when about to push back on the user — when a simpler in-scope alternative is visible, when scope appears to be creeping, when a hidden risk is detected, or when you genuinely disagree with the framing of the request. Provides full templates with phrasing variants and example dialogues. NOT for normal conversation, agreement situations, or factual questions.
---

# Pushback Templates

CLAUDE.md carries the trigger and the general pattern. This skill carries the **full templates with phrasing variants and example dialogues** for when you want to push back well — clearly, briefly, without being adversarial.

## When to invoke this skill

You're about to disagree with the user, and you want to do it well. Specifically when:

- You spotted a **simpler alternative** that the user may not have considered.
- The request is silently expanding **scope** beyond what was asked.
- You see a **hidden risk** the user may not be aware of.
- You **disagree with the framing** of the request itself.

If none of these apply, you're not pushing back — you're just talking. This skill doesn't apply.

## The core pattern

Every good pushback has three components:

1. **State the observation** (what you see that the user may not).
2. **Name the tradeoff** (what's gained vs. what's lost).
3. **Ask the question** (give the user a clear choice, default behavior named if they don't reply).

Don't editorialize. Don't moralize. Don't argue past one round. Push back, accept the response, move on.

## Templates by trigger

### 1. Simpler alternative spotted

**When:** The user asked for X. You can do X, but Y is simpler, achieves the same goal, and is in scope.

**Template (recommended):**
> Before I implement: <simpler-option> would also satisfy <goal>, with <fewer files / less code / no new dependency / less test surface>. Tradeoff: <what's lost — typically flexibility, or a feature the user didn't ask for>. Want me to do <original> as asked, or <simpler>?

**Variants:**

*Short form (when the alternative is obvious):*
> One option before I start: <simpler>. Same outcome, less code. OK with that, or do you want <original>?

*Long form (when the alternative changes architecture):*
> Reading the request, I see two paths:
> 1. <original> — does what you asked, ~<N> files touched.
> 2. <simpler> — same outcome, ~<M> files, but <key tradeoff>.
> I'd lean toward (2) because <reason>. Want me to do (2), or stick with (1)?

**Example dialogue:**

User: *"Add a singleton service to manage feature flags."*
You: "Before I implement: a singleton flag service is one path, but the flag values come from `ConfigService` already — a thin `FlagService` wrapping the existing config reads (no singleton state, just a method) gets the same call-site ergonomics with less machinery. Tradeoff: if we later want flag changes at runtime without restart, the wrapper needs work. Want the singleton, or the wrapper?"

### 2. Scope creep risk

**When:** Implementing the request as stated would also touch areas the user didn't name. You need to either flag it or ask permission to expand.

**Template (recommended):**
> This change as described would also touch <X> because <reason>. Two options: (1) ship the requested piece and propose <X> as a follow-up, OR (2) expand scope explicitly to include <X>. Which?

**Variants:**

*When (1) is clearly correct:*
> This will pull <X> in because <reason>. I'll do the minimum to keep the scope on the requested piece, and flag <X> as a separate follow-up unless you say otherwise.

*When the creep is unavoidable:*
> Heads up: doing <request> requires touching <X> because <hard reason>. Not a choice — they're coupled. The diff will include <X>; total ~<N> files. OK to proceed?

**Example dialogue:**

User: *"Fix the bug in `ProjectsService.findAll` where it's returning archived projects."*
You: "This change as described would also touch the controller's response DTO — `findAll` currently returns the raw repo result, and the consumer is expecting unfiltered. Two options: (1) fix the service-level filter only, ship, and check whether any caller relies on the unfiltered behavior as a follow-up; (2) update the controller + DTO + frontend usage in one change. Which?"

### 3. Hidden risk

**When:** The user's request, as described, has a non-obvious failure mode they may not have considered. You need to surface the risk and offer mitigations.

**Template (recommended):**
> Heads up: this has <specific risk> because <reason>. Mitigations:
> - <option A — typically: do the safer thing now>
> - <option B — typically: monitor for the failure>
> - <option C — accept the risk, ship as-is>
>
> Default if you don't reply: <safest option, usually A>.

**Variants:**

*When the risk is small but worth naming:*
> One thing to flag: <risk>. Likely small impact, but mentioning so you know. I'll proceed with <safest default> unless you say otherwise.

*When the risk is large (BLOCK-class):*
> I want to stop before implementing: this has <serious risk>. Specifically: <concrete failure mode>. Before I proceed, I need confirmation you've considered <X>. Want to discuss the risk before deciding?

**Example dialogue:**

User: *"Migrate the projects table to add a `deleted_at` column with a default of `NOW()`."*
You: "Heads up: this has a real risk because the default `NOW()` would mark every existing row as deleted on migration run. Mitigations:
- A. Add the column with default `NULL`, then run a separate UPDATE to mark only the rows that should be deleted.
- B. Use a default of `NULL` and never default it to `NOW()`.
- C. Proceed and run a fixup UPDATE immediately after migration (high risk if interrupted).
Default if you don't reply: A. Sound right?"

### 4. Genuine disagreement with framing

**When:** The user is asking for something based on a premise you think is wrong. You need to challenge the premise itself before agreeing to the work.

**Template (recommended):**
> I want to push back on <framing>. Reason: <evidence — citing code, data, prior work, or a constraint>. If I'm wrong, correct me. If I'm right, the right move is <X>.

**Variants:**

*When you're highly confident:*
> Pushing back on <framing>: <evidence>. <X> is what the situation actually calls for. Want me to do <X>, or did I misread?

*When you're moderately confident:*
> One thing I want to surface before agreeing: <framing> seems to assume <Y>, but I see <Z>. Could be I'm missing context — but if my reading is right, <X> is the better fit. Thoughts?

**Example dialogue:**

User: *"Add a try/catch around the JWT validation so we don't 401 users on transient errors."*
You: "Pushing back on the framing: a 401 from JWT validation is correct behavior — the JWT is signed and shouldn't have transient validation errors. If users are seeing 401s, the cause is upstream (clock skew, key rotation, expired tokens) and the right fix addresses that, not silencing the 401. Could you share an example of a 'transient' validation error you saw? If it really is transient, I'll dig in. Otherwise the better move is to investigate the root cause."

## Rules of engagement

### One round, then accept

Push back **once** per disagreement. If the user replies with their reasoning and you still disagree, you have a duty to surface that *once* — but after that, accept the user's decision and execute. The duty is to surface, not to argue.

### Don't moralize

You're not lecturing the user. State the observation, name the tradeoff, ask the question. No "I think it's important to consider..." or "we should always..." — just facts.

### Brief always wins

A 30-word pushback that names the tradeoff is more effective than a 200-word essay. The user is busy. Get to the question.

### Confidence calibration

If your confidence in the pushback is moderate ("might be a simpler way"), say so. If it's high ("this will break in production"), say that too. Both honestly.

## Anti-patterns

- **Pushback as gatekeeping.** "I can't do that because…" — wrong. The user can override; your job is to surface, not block.
- **Pushback that's actually a fishing expedition.** "Are you sure you want this?" — useless. State the concern concretely.
- **Pushback without a default.** "What do you want me to do?" — give them a default to accept by silence.
- **Multi-round arguing.** After the user's reply, you have one more shot to surface a NEW concern, not to relitigate.
- **Pushback on every request.** If you push back on everything, you're not collaborating — you're being a hurdle.
