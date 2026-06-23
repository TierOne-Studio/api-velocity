/**
 * Theme resolution for the public widget. Pure (no DOM) so it runs under node
 * jest. Precedence: built-in defaults < server `/config` theme < host-page
 * `data-*` overrides.
 *
 * Trust boundary (SPEC-003 §10.4): the server theme is org-admin-authored and
 * echoed to anonymous clients. We accept ONLY an allowlisted set of keys, ONLY
 * when the value is a string, and the visual ones are applied solely as CSS
 * custom properties (see `themeToCssVars`) — never interpolated into HTML/JS.
 */

export interface ResolvedTheme {
  primaryColor: string;
  textColor: string;
  surfaceColor: string;
  position: 'left' | 'right';
  title: string;
  greeting: string;
  launcherLabel: string;
}

export const DEFAULT_THEME: ResolvedTheme = {
  primaryColor: '#2563eb',
  textColor: '#0f172a',
  surfaceColor: '#ffffff',
  position: 'right',
  title: 'Chat with us',
  greeting: 'Hi! Ask me anything about this site.',
  launcherLabel: 'Chat',
};

// Keys that may be overridden by server theme / data-* attributes. Anything
// outside this set is dropped (the trust-boundary allowlist).
const STRING_KEYS: ReadonlyArray<
  Exclude<keyof ResolvedTheme, 'position'>
> = ['primaryColor', 'textColor', 'surfaceColor', 'title', 'greeting', 'launcherLabel'];

function applyOverrides(
  base: ResolvedTheme,
  overrides: Record<string, unknown>,
): ResolvedTheme {
  const next: ResolvedTheme = { ...base };
  for (const key of STRING_KEYS) {
    const value = overrides[key];
    if (typeof value === 'string' && value.length > 0) {
      next[key] = value;
    }
  }
  if (overrides.position === 'left' || overrides.position === 'right') {
    next.position = overrides.position;
  }
  return next;
}

/**
 * Merge defaults, the server theme, and `data-*` overrides into a fully
 * resolved theme. `serverTheme` is the raw JSONB from `/config` (may be null);
 * `dataset` is the host `<script>`'s `data-*` attributes as camelCase keys.
 */
export function resolveTheme(
  serverTheme: Record<string, unknown> | null,
  dataset: Record<string, string>,
): ResolvedTheme {
  const withServer = applyOverrides(DEFAULT_THEME, serverTheme ?? {});
  return applyOverrides(withServer, dataset);
}

/**
 * Project the visual fields onto namespaced CSS custom properties. The UI
 * applies these via `style.setProperty` on the shadow host — the only channel
 * theme values reach the page.
 */
export function themeToCssVars(theme: ResolvedTheme): Record<string, string> {
  return {
    '--vw-primary': theme.primaryColor,
    '--vw-text': theme.textColor,
    '--vw-surface': theme.surfaceColor,
  };
}
