# ADR-020: Standalone widget build target (esbuild) + browser-test toolchain (Playwright)

**Status:** Proposed
**Date:** 2026-06-23
**Deciders:** Engineering team

## Context

SPEC-003 Slice 3 ships an embeddable public web-chat **widget**: a standalone,
browser-targeted, vanilla-TS bundle served by the API at the version-pinned path
`GET /api/public/widget/v1/widget.js`. A customer embeds it on their own site with
a single `<script>` tag.

This is the first **browser** artifact in an otherwise Node-only NestJS backend,
and it creates two toolchain gaps the existing setup cannot fill:

1. **Build.** `npm run build` is `nest build` (tsc, CommonJS, Node target). It
   cannot produce a single self-contained browser IIFE, and the widget's DOM-typed
   source (`document`, `ShadowRoot`, `fetch` streaming) does not type-check under
   the Node `tsconfig` (no `DOM` lib) — compiling it with the rest of `src` would
   break the server build.
2. **Test.** The repo verifies with Jest + supertest (HTTP-level). The widget's
   value is in the browser — shadow-DOM rendering, SSE stream consumption, source
   chips, theming, and the **real** cross-origin CORS + origin-allowlist decision.
   None of that is observable from supertest; it needs a real browser.

## Decision

Add **two build/test tools**, scoped to the widget only:

- **esbuild** (`devDependency`) builds the widget bundle. A dedicated script
  (`scripts/build-widget.mjs`) bundles `src/modules/public-chat/widget/widget.entry.ts`
  into `dist/public-widget/widget.js` (IIFE, minified, `es2019`, browser platform).
  `npm run build` runs it after `nest build`. The widget source is **excluded from
  `tsconfig.build.json`** (kept out of the Node build) and type-checked separately
  via `tsconfig.widget.json` (which adds the `DOM` lib) through
  `npm run typecheck:widget`. The serving controller resolves the bundle path from a
  single `ConfigService` getter (`getWidgetBundlePath()`), overridable by env.

- **@playwright/test** (`devDependency`) drives the built bundle in a real
  browser. The e2e (`e2e/public-widget/`) boots the **real** public-chat HTTP
  surface — real guard, real per-request CORS, real controllers — with an
  in-memory embed-site repo and a deterministic faked agent (no Postgres, no LLM),
  and serves two static host pages on distinct origins (one allowlisted, one not).
  The origin allow/deny is therefore the **real** guard's decision, not a mock's.
  Data/RBAC isolation remains covered by Slice 1's integration tests vs real
  Postgres; this layer owns the browser surface.

The DOM/Node boundary is mechanical: pure, DOM-free helpers (`sources.ts`,
`theme.ts`, `sse-client.ts`) are unit-tested under the existing node Jest; the
DOM-typed modules (`ui.ts`, `stream-transport.ts`, `widget.entry.ts`) are compiled
only by esbuild and exercised only by Playwright, and are excluded from Jest
coverage collection.

**Dependency gate (ADR-006).** Both `esbuild` and `@playwright/test` were
**explicitly approved by the user** before installation, per the asks-first
dependency gate. They are `devDependencies` only — neither ships in the runtime
artifact.

## Alternatives considered

- **Alt A — Compile the widget with the existing `tsc`/`nest build` (no bundler).**
  Rejected: tsc emits per-file CommonJS, not a single self-contained browser IIFE,
  and the DOM-typed source breaks the Node build. A hand-rolled IIFE would still
  need the DOM lib carved out and would forgo minification/bundling.
- **Alt B — Vite library mode for the bundle.** Rejected: heavier config and a
  larger toolchain for a single ~7 KB file; esbuild is the minimal fit. (Vite is
  the SPA's tool; the API has no other use for it.)
- **Alt C — Serve `widget.js` via `useStaticAssets` instead of a controller.**
  Rejected: a controller gives the version-pinned path, explicit public/uncredentialed
  cache headers, and no interaction with the `api/public/*` middleware mount; the
  bundle is read once and served from memory.
- **Alt D — Verify the widget with Juit/jsdom or a mocked-API Playwright test.**
  Rejected: jsdom does not faithfully render shadow DOM or run the real CORS gate;
  a fully-mocked API makes the origin allow/deny assertion vacuous. Booting the
  real guard + CORS against a faked repo keeps the security-relevant assertions
  non-vacuous.
- **Alt E — No browser test (HTTP-only via supertest).** Rejected: the spec's
  Slice 3 acceptance is explicitly browser-level (renders, asks, streams, theming,
  origin reject); supertest cannot observe any of it.

## Consequences

**Positive**
- One self-contained, cacheable bundle a customer embeds with one `<script>` tag.
- The Node server build is untouched; browser code never leaks into `dist/main`.
- The widget's real behavior — including the CORS/origin security boundary — is
  verified in a real browser, deterministically and without LLM cost.

**Negative / costs**
- Two new devDependencies and a second build step (`build:widget`) + a separate
  type-check (`typecheck:widget`) the team must keep green.
- Playwright requires a browser binary in CI (chromium) — a one-time provisioning
  step.
- A second `tsconfig` (`tsconfig.widget.json`) and a coverage-exclusion for the
  widget DOM files are maintenance surface; the DOM/Node split must be respected
  (DOM-typed code stays out of node Jest).

## References

- SPEC-003 §3 (embed script), §4 (`GET …/widget.js`, `GET /config`), §10.4 (theme
  trust boundary), §13 (Slice 3).
- ADR-006 (asks-first dependency gate) — governs the esbuild + Playwright additions.
- ADR-018 (anonymous public-channel auth), ADR-019 (per-request origin-allowlist
  CORS) — the security boundaries the e2e exercises.
