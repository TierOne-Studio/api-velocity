# ADR-019: Per-request origin-allowlist CORS for the public chat channel

**Status:** Proposed
**Date:** 2026-06-19
**Deciders:** Engineering team

## Context

The app configures CORS once at bootstrap (`src/main.ts`):

```ts
app.enableCors({
  origin: configService.getTrustedOrigins(), // static TRUSTED_ORIGINS env list
  credentials: true,
});
```

This is correct for the first-party SPA: a fixed set of operator-controlled
origins, cookie credentials allowed. It is **wrong** for the public chat widget
(SPEC-003, ADR-018):

- The widget runs on **customer-owned origins** that we do not control and that
  are not in `TRUSTED_ORIGINS`. The set of valid origins is **per embed site**
  (its `allowed_origins` column), not global, and changes whenever an admin edits
  a site.
- The public channel authenticates by **key + origin allowlist**, not by session
  cookie, so it must **not** send `Access-Control-Allow-Credentials: true`.
  Combining `credentials: true` with a reflected arbitrary origin is exactly the
  CORS misconfiguration class we must avoid.

We need the `api/public/*` prefix to compute its CORS response **per request**
from the matched embed site, independent of the global policy.

## Decision

The `api/public/*` endpoints use a **per-request, allowlist-driven CORS policy**,
separate from the global `enableCors` in `main.ts`. For each public request we
resolve the embed site (by `X-Velocity-Embed-Key`), and **only if** the request
`Origin` exactly matches an entry in that site's `allowed_origins` do we echo that
origin in `Access-Control-Allow-Origin`. The public channel always responds with
`Access-Control-Allow-Credentials: false` (no cookies are used). A non-matching
origin receives no permissive CORS headers (and the request is rejected `403` by
the guard — ADR-018). Preflight `OPTIONS` for the public prefix is answered by the
same per-request logic.

The global `enableCors({ origin: trustedOrigins, credentials: true })` continues
to govern every non-public route unchanged. The two policies are kept distinct and
must not be merged: a single `enableCors` cannot express "static list with
credentials for the app, dynamic per-site list without credentials for the
widget."

## Alternatives considered

- **Alt A — Add the customer origins to the global `TRUSTED_ORIGINS` list.**
  Rejected: it's a global, deploy-time, operator-managed list; embed-site origins
  are per-tenant, self-service, and change at runtime. It would also grant those
  origins credentialed CORS against the **entire** first-party API, not just the
  public widget endpoints — a major over-grant.
- **Alt B — Wildcard `Access-Control-Allow-Origin: *` on the public prefix.**
  Rejected: defeats the per-site allowlist that ADR-018 relies on as the primary
  browser-side boundary, and removes a cheap layer of abuse friction. We want
  exact-match, not open.
- **Alt C — A single `enableCors` with a dynamic `origin` callback that handles
  both app and widget.** Rejected: it would have to vary `credentials` by route
  (true for app, false for widget), which `enableCors` cannot do per-request;
  conflating the two policies in one callback is error-prone on a security-
  sensitive surface. Keep them separate and obvious.

## Consequences

- **Positive:** customer origins never gain credentialed access to first-party
  routes; the widget's CORS reflects exactly the admin-managed allowlist and
  updates at runtime with no redeploy; the dangerous `credentials: true` +
  reflected-origin combination is structurally impossible on the public channel.
- **Negative:** two CORS code paths to keep correct; the per-request matching adds
  a small amount of logic on the public hot path (an exact-match over a short
  list — negligible); preflight handling for the public prefix must be implemented
  deliberately rather than inherited from the global config.
- **Follow-ups:** decide the mechanism (a scoped middleware/guard on the prefix vs
  a controller-level handler) at implementation; the guard that performs key +
  origin validation is specified in SPEC-003 §5 and sketched in §9-adjacent
  material.

## References

- `src/main.ts` — the global `enableCors` this decision sits beside.
- `docs/specs/SPEC-003-public-web-chat-widget.md` (§4, §5, §6, §7.5).
- ADR-018 (anonymous public chat channel auth) — the companion decision that
  defines the key + origin-allowlist model this CORS policy enforces.
