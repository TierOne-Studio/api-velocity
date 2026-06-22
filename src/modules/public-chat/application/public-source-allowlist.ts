/**
 * Source kinds the anonymous public channel is permitted to retrieve from.
 *
 * Fail-closed allowlist (SPEC-003 §3/§6, ADR-018): only document-RAG kinds answer
 * publicly. The `database` (SQL sub-agent) and `external` kinds are excluded, and
 * any FUTURE source kind is excluded by default until explicitly admitted here —
 * a denylist would silently expose new kinds.
 */
export const PUBLIC_ALLOWED_SOURCE_KINDS = [
  'airweave_collection',
  'vector_db',
] as const;

/**
 * Strip every source whose kind is not in {@link PUBLIC_ALLOWED_SOURCE_KINDS}.
 * Applied to a project's resolved sources BEFORE they reach the chat agent, so
 * the SQL tool, its routing prose, and the keyless fallback fan-out (all keyed on
 * `kind`) are never built for the public channel. Order is preserved.
 */
export function filterPublicSources<T extends { kind: string }>(
  sources: readonly T[],
): T[] {
  const allow = new Set<string>(PUBLIC_ALLOWED_SOURCE_KINDS);
  return sources.filter((source) => allow.has(source.kind));
}
