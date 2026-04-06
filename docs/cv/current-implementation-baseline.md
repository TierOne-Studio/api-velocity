# Current Implementation Baseline

**Date:** April 6, 2026  
**Status:** Active branch baseline for code review

## Summary

The current branch baseline is an **organization-scoped Airweave chat experience**, not the earlier project-scoped Champion Velocity MVP shape.

## What The Current Branch Implements

- Chat is scoped by `organizationId`.
- The active Airweave collection is resolved from `organization.metadata.airweaveCollectionId`.
- Organization admin owns collection assignment.
- Superadmin chooses a target organization inside the chat feature when needed.
- Airweave API endpoints used by the product are gated by organization-level access, not project-level access.

## What Was Removed From The Active Runtime Surface

- Project-scoped chat behavior.
- User-facing Projects pages.
- User-facing Data Sources pages.
- The backend Projects module and its route surface.

## What Remains Deferred

- Destructive schema cleanup for orphaned `project` and `data_source` tables.
- Any broader authorization redesign beyond aligning the surviving org-scoped surfaces.

## How To Read The Older CV Docs

The files `1 - champion-velocity-prd.md` and `2 - champion-velocity-implementation-plan.md` remain useful as historical product/planning context, but they are **not** the authoritative description of the current branch. Review this file first when evaluating the pending implementation.