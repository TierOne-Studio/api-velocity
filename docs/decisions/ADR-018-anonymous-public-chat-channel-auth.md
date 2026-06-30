# ADR-018: Anonymous public chat channel authenticates as a site, not a user

**Status:** Proposed
**Date:** 2026-06-19
**Deciders:** Engineering team

## Context

We want to ship an embeddable web chat widget (SPEC-003): a `<script>` snippet an
organization pastes onto its own public websites so anonymous visitors can ask
questions grounded on one project's knowledge base. This is the first **public,
unauthenticated-end-user** surface in the codebase.

The existing chat surface (`src/modules/chat/api/controllers/chat.controller.ts`)
is a private, first-party channel and cannot be reused as-is:

- it is guarded by `PermissionsGuard` and requires a logged-in **better-auth
  session** (`@Session() session: UserSession`);
- every conversation/message carries a mandatory `user_id` (FK to `"user"`), and
  org scope is derived from `getActiveOrganizationId(session)`;
- RBAC scopes `chat:read/create/stream` are resolved against the user's role.

A widget runs on a customer-owned domain with no logged-in user and no session
cookie. There is no human identity to attach, and we do not want to mint
first-party user accounts for anonymous visitors. We need an authentication
principal that represents **the embedding site**, scoped to exactly one
organization + one project, that can be safely published in client-side HTML.

## Decision

The public chat channel authenticates **as an embed site, not as a user.** We
will introduce an `embed_site` entity (org-owned, 1:1 with a project) carrying a
**publishable `public_key`** (an identifier, not a secret) and an
`allowed_origins` allowlist. Public requests present the key via the
`X-Velocity-Embed-Key` header; a dedicated guard resolves the site, checks it is
enabled, validates the request `Origin` against `allowed_origins`, and attaches
the site's `{ organizationId, projectId }` to the request. All downstream
retrieval is re-scoped to those server-resolved values — never to anything the
client supplies. This public channel lives **beside** the session/RBAC channel,
not as an extension of it; the public endpoints carry no `@RequirePermissions`.

Because the key is published in client HTML, it is treated as an identifier and
the origin check is the primary browser-side boundary — but that boundary is
**bypassable by a non-browser client** (Origin is client-set). Therefore rate
limits (per-key + per-IP) and optional org spend caps are load-bearing controls,
not the allowlist alone. The org-isolation invariant from SPEC-001 ("every
read/write re-scoped to the org; cross-org impossible by construction") is
preserved — it is simply sourced from the embed credential instead of a session.

## Alternatives considered

- **Alt A — Reuse `api/chat` + better-auth, mint anonymous user accounts.**
  Rejected: pollutes the first-party identity store with throwaway anonymous
  users, drags the full RBAC/session machinery onto a public surface, and still
  doesn't solve cross-origin (the session cookie + `credentials: true` CORS model
  is incompatible with arbitrary customer domains). Larger attack surface for no
  benefit.
- **Alt B — Signed per-end-user embed tokens (JWT minted by the customer
  backend).** Rejected **for v1**, kept as a Future upgrade. It is more secure and
  enables per-user history, but it requires every customer to run backend code to
  mint tokens — too high a barrier for a paste-a-snippet widget whose v1 goal is
  anonymous ask-only. Revisit when per-user history or stronger anti-abuse is
  required.
- **Alt C — Secret API key (server-to-server style), kept out of the browser.**
  Rejected: the widget is client-side by definition; any key shipped in HTML is
  not secret. Pretending otherwise (hashing it at rest, calling it a secret)
  creates false confidence. We make the key an explicit identifier and put the
  real controls on the allowlist + rate limits + server-side scoping.
- **Alt D — Open endpoint scoped only by project id in the request.** Rejected:
  trusting a client-supplied project id is a cross-tenant data-exposure hole. The
  org/project must be resolved server-side from a credential we issued.

## Consequences

- **Positive:** a clean separation between the private (session/RBAC) and public
  (key/origin) channels; no anonymous accounts in the identity store; the SPEC-001
  org-isolation invariant holds unchanged; the snippet stays paste-only with no
  customer backend required.
- **Negative:** a second auth path to maintain and reason about; the published key
  is enumerable/abusable, so security leans on rate limits and caps rather than
  secrecy; key rotation is a manual admin operation (rotating `public_key`
  invalidates already-deployed snippets).
- **Follow-ups:** signed per-user tokens (Alt B) as a Future opt-in; per-site
  rate-limit configuration; the abuse/cost controls are specified in SPEC-003 §6.
  CORS for this channel is its own decision — see ADR-019.

## References

- `docs/specs/SPEC-003-public-web-chat-widget.md` (§1, §5, §9 data model, §10).
- `feature/proposals/embeddable-web-chat-widget.md` ("Why this is not 'just
  expose the existing chat API'").
- `src/modules/chat/api/controllers/chat.controller.ts` — the private channel this
  sits beside.
- ADR-019 (per-request origin-allowlist CORS) — companion decision.
- ADR-011 (org ownership via metadata) — the isolation invariant this preserves.
