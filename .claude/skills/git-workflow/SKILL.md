---
name: git-workflow
description: Use when committing, pushing, branching, creating PRs, merging, rebasing, or any git operation that mutates remote or local repository state. NOT for read-only operations like status, log, diff, show, blame, or branch listing.
---

# Git Workflow

`main`/`master` is off-limits — mechanically enforced by `guard-main.sh`. All writes need explicit user approval.

## Hard rule (restated)

Never commit, push, force-push, merge, or rebase to `main` or `master`. No exceptions. If something needs to land on `main`, the user creates a hotfix branch and PR and approves it themselves.

## Branching model

- Branch from `main` (after `git fetch origin && git checkout main && git pull --ff-only`).
- Naming: `<type>/<short-description>` where type ∈ {`feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `ci`}.
- Examples: `feat/add-org-scoped-rbac`, `fix/projects-cross-org-guard`, `refactor/chat-agent-source-filter`.
- One branch per logical change. Don't accumulate unrelated work on a feature branch.

## Commit discipline

- **Atomic commits.** One conceptual change per commit. Tests + implementation can be one commit.
- **Conventional Commits format:**

```
<type>(<scope>): <imperative summary>

<optional body>

<optional footer — refs, breaking-change notes>
```

Examples:
- `feat(rbac): scope=all contract for cross-org permissions`
- `fix(projects): exclude unready sources from chat agent`
- `refactor(chat): extract source-filter into pure function`

- Imperative mood ("add", "fix", "remove" — not "added" or "adds").
- Subject ≤ 72 chars.
- Body explains *why*, not *what* (the diff already shows what).

## Impact summary for git operations (use in the pre-action protocol)

When outputting the impact summary for any approval-required git operation, include all of:

- **Branch affected** — current branch name, target if different.
- **Files changed** — count and one-line per file (or summary if many).
- **Remote impact** — which remote, what state changes there.
- **Reversibility** — can this be undone? How? (force-push reverses, normal push doesn't easily.)
- **Affected reviewers / collaborators** — for shared branches: who has work based on this branch?

Example:
```
Awaiting approval for: git push origin feat/scope-fix
Branch:        feat/scope-fix (local) → origin/feat/scope-fix (remote)
Files changed: 4 (projects.controller.ts, projects.service.ts, projects.controller.spec.ts, project.dto.ts)
Remote impact: pushes 3 new commits to origin/feat/scope-fix; no shared base affected.
Reversibility: easy — git push --force on the same branch (with approval).
Collaborators: solo branch.
Awaiting approval (reply 'approve' or 'yes' to proceed)
```

For commit/branch creation, scale the summary to what's relevant — `git commit` doesn't have remote impact; `git push --force` to a shared branch does.

## Approval-required operations (NEVER without explicit user "approve" / "yes" / "go ahead")

- `git commit` (and `git commit --amend`)
- `git push` (any flavor)
- Branch creation (`git checkout -b`, `git switch -c`, `git branch <name>`)
- Pull requests (`gh pr create`, web UI)
- Merges (`git merge`, PR merge)
- Rebases (`git rebase`, especially `-i`)
- Force operations (`--force`, `--force-with-lease`, `-f`)
- Tag creation / deletion / push
- `git reset --hard`, `git clean -f`, `git checkout -- <files>`

## Free operations (no approval needed)

- `git status`, `git log`, `git diff`, `git show`, `git blame`
- `git fetch` (read-only against remote)
- `git stash list`, `git branch` (list)
- `gh pr view`, `gh pr list`, `gh pr diff`
- `gh issue view`, `gh issue list`

## PR format

Title: same Conventional Commits format as the primary commit.

Body:

```
## What
<one-paragraph user-visible description>

## Why
<motivation: ticket, incident, decision link>

## How verified
- <test command and result>
- <manual steps if applicable>

## Risk
<rollout concerns, dependencies, data shape changes, backward compat>
```

## Anti-patterns

- "Just this once" pushes to `main`. The hook will block; if you find yourself trying to bypass it, stop and ask.
- Force-pushing a shared branch without telling the team.
- Bundling unrelated changes into one commit because "they're all part of the same task".
- Skipping hooks (`--no-verify`) without an explicit user instruction.
- Rewriting public history (`rebase` on a shared branch after others have based work on it).
- Generic commit messages: "fixes", "wip", "updates", "tests".
