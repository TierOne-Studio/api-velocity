# Changelog

All notable changes to api-velocity that warrant operator/SRE awareness.
Format adapted from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Observability

- **Airweave read-path lockdown** — wired but in observe-only mode by default.
  The new `AIRWEAVE_READ_LOCKDOWN_ENFORCE` env flag (default `false`) controls
  whether `AirweaveOwnershipGuard` enforces per-collection ownership on the
  read endpoints (`GET /collections/:id`, `POST /collections/:id/search`,
  `GET /sources/:collectionId`, `POST /connect/session`). While the flag is
  `false`, a structured warning is logged (`airweave.read_would_403`) for
  every cross-org or legacy-collection read, capturing `{userId, userRole,
  orgId, collectionReadableId, route, method, source}`. Pipe to log aggregator
  and watch for ≥5 business days of zero events before flipping the flag —
  see ADR-011 § Decision 4 and the `feat/airweave-collections-crud` Step 10b.
  No behavior change yet; this entry MOVES to "Breaking" when Step 10b ships.
