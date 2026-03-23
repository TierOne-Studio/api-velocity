---
name: code-simplifier
description: 'Simplify and refine recently modified code for clarity, consistency, and maintainability while preserving exact behavior. Use after edits, during cleanup, or when reviewing touched files. Prefer explicit readable code, follow project standards, avoid nested ternaries, and keep scope limited to changed code unless asked otherwise.'
argument-hint: 'Describe the changed files, diff, or scope to simplify.'
user-invocable: true
disable-model-invocation: false
---

# Code Simplifier

## Purpose

Refine code so it is easier to read, more consistent with project standards, and simpler to maintain without changing what it does.

## When to Use

- After writing or modifying code and you want a cleanup pass.
- When a diff works but feels unnecessarily complex or inconsistent.
- When recently touched code has redundant branching, awkward naming, or avoidable nesting.
- When you need to align a local change with repository conventions without broad refactoring.

## Core Rules

1. Preserve exact functionality.
2. Focus on recently modified code unless the user explicitly broadens scope.
3. Prefer clarity over brevity.
4. Keep useful abstractions and remove only the ones that add noise.
5. Follow active project instructions such as AGENTS.md, CLAUDE.md, or generated workspace instruction files before simplifying.

## Simplification Standards

- Use explicit, readable control flow.
- Avoid nested ternary operators; prefer if/else chains or switch when conditions branch in multiple directions.
- Reduce unnecessary nesting when guard clauses or smaller helper functions improve readability.
- Remove redundant code, duplicated condition checks, and needless wrappers.
- Use clear variable and function names that describe intent.
- Keep responsibilities separated; do not merge unrelated concerns just to reduce line count.
- Remove comments that only restate obvious code.
- Keep error handling consistent with repository patterns and avoid adding unnecessary try/catch blocks.
- For top-level APIs and components, keep types explicit when the project conventions require them.

## What Not to Do

- Do not change behavior, side effects, return values, or public contracts.
- Do not broaden the refactor into unrelated files.
- Do not replace readable code with clever one-liners.
- Do not collapse separate concepts into one function if that makes debugging harder.
- Do not remove abstractions that provide meaningful organization.

## Procedure

1. Identify the target scope from the current diff, changed files, or explicit user request.
2. Read the repository instructions that govern style and architecture.
3. Mark the parts of the changed code that are redundant, overly nested, inconsistently named, or harder to follow than necessary.
4. Apply the smallest set of edits that improves clarity while preserving behavior.
5. Re-check types, tests, and edge cases affected by the cleanup.
6. Summarize only the meaningful simplifications that affect understanding or maintenance.

## Review Checklist

- Functionality preserved
- Scope limited to touched code
- Repository conventions followed
- Naming improved where needed
- Branching simplified without becoming clever
- No nested ternaries introduced
- Comments kept only when they add information
- Result is easier to debug and extend
