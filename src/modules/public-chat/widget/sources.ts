/**
 * Source-chip helpers for the public widget. Pure (no DOM), so they run under
 * the existing node jest. Mirrors the SPA's SPEC-002 dedupe semantics so the
 * widget renders the same chips as the first-party chat.
 */

/** Shape of a source as emitted in the terminal `done` event's metadata. */
export interface WidgetSource {
  name: string;
  webUrl: string;
  sourceName: string;
  entityType: string;
}

/**
 * Collapse sources that are identical on `name`/`sourceName`/`webUrl` (SPEC-002).
 * The backend can return the same logical document multiple times across
 * retrieval passes; this keeps the chip row clean. First-seen order preserved.
 * The key is encoded structurally (JSON tuple) so a field containing the former
 * `|` delimiter can no longer collapse two distinct sources.
 */
export function dedupeSources(sources: WidgetSource[]): WidgetSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = JSON.stringify([source.name, source.sourceName, source.webUrl]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * A url is safe to render as an anchor only when it is http(s). Anything else
 * (`javascript:`, `data:`, relative, empty) is rendered as plain text — the
 * XSS guard for LLM/source-provided urls.
 */
export function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
