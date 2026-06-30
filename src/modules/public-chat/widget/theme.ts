/**
 * Theme resolution for the public widget. Pure (no DOM) so it runs under node
 * jest. Precedence: preset palette < server `/config` theme < host-page
 * `data-*` overrides.
 *
 * A preset is selected by a `data-theme` (or server `theme.preset`) id, which
 * is validated against a fixed allowlist (`resolvePreset`) and used ONLY to
 * look up a code-defined palette — never interpolated. Unknown ids fall back
 * to `default` (fail-closed). Individual `data-primary-color` etc. still layer
 * on top of the preset.
 *
 * Trust boundary (SPEC-003 §10.4): the server theme is org-admin-authored and
 * echoed to anonymous clients. We accept ONLY an allowlisted set of keys, ONLY
 * when the value is a string, and the visual ones are applied solely as CSS
 * custom properties (see `themeToCssVars`) — never interpolated into HTML/JS.
 */

export type ThemePreset =
  | 'default'
  | 'cloud'
  | 'obsidian'
  | 'neo-brutalism'
  | 'mono-chrome';

/**
 * The visual palette of a theme — every value is emitted as a `--vw-*` CSS
 * custom property and nothing else. `primaryColor`/`textColor`/`surfaceColor`
 * keep their legacy names because they are also individually overridable via
 * `data-*` attributes (the historical theming channel).
 */
export interface ThemePalette {
  primaryColor: string;
  surfaceColor: string;
  textColor: string;
  mutedColor: string;
  headerBg: string;
  headerText: string;
  aiBubbleBg: string;
  aiBubbleText: string;
  userBubbleBg: string;
  userBubbleText: string;
  border: string;
  borderWidth: string;
  radius: string;
  shadow: string;
  launcherBg: string;
  launcherText: string;
  inputBg: string;
}

/**
 * Canonical palette values. The SPA embed-modal preview keeps a byte-identical
 * copy of the four selectable presets in
 * `spa-velocity/src/features/EmbedSites/widget-theme-presets.json`
 * — this module is the source of truth; the preview is a cosmetic mirror.
 */
export const THEME_PRESETS: Record<ThemePreset, ThemePalette> = {
  // Backward-compatible baseline (no `data-theme`): the pre-existing look.
  default: {
    primaryColor: '#2563eb',
    surfaceColor: '#ffffff',
    textColor: '#0f172a',
    mutedColor: '#64748b',
    headerBg: '#2563eb',
    headerText: '#ffffff',
    aiBubbleBg: '#f1f5f9',
    aiBubbleText: '#0f172a',
    userBubbleBg: '#2563eb',
    userBubbleText: '#ffffff',
    border: '#e2e8f0',
    borderWidth: '1px',
    radius: '12px',
    shadow: '0 12px 32px rgba(0,0,0,.18)',
    launcherBg: '#2563eb',
    launcherText: '#ffffff',
    inputBg: '#ffffff',
  },
  cloud: {
    primaryColor: '#6366f1',
    surfaceColor: '#f5f6fb',
    textColor: '#1e293b',
    mutedColor: '#94a3b8',
    headerBg: '#ffffff',
    headerText: '#1e293b',
    aiBubbleBg: '#ffffff',
    aiBubbleText: '#1e293b',
    userBubbleBg: '#ffffff',
    userBubbleText: '#1e293b',
    border: '#e5e7eb',
    borderWidth: '1px',
    radius: '16px',
    shadow: '0 16px 40px rgba(99,102,241,.20)',
    launcherBg: '#6366f1',
    launcherText: '#ffffff',
    inputBg: '#ffffff',
  },
  obsidian: {
    primaryColor: '#3b82f6',
    surfaceColor: '#161616',
    textColor: '#e5e5e5',
    mutedColor: '#8a8a8a',
    headerBg: '#0a0a0a',
    headerText: '#fafafa',
    aiBubbleBg: '#1f1f1f',
    aiBubbleText: '#f0f0f0',
    userBubbleBg: '#2d2d2d',
    userBubbleText: '#fafafa',
    border: '#2e2e2e',
    borderWidth: '1px',
    radius: '12px',
    shadow: '0 16px 40px rgba(0,0,0,.55)',
    launcherBg: '#1a1a1a',
    launcherText: '#fafafa',
    inputBg: '#161616',
  },
  'neo-brutalism': {
    primaryColor: '#facc15',
    surfaceColor: '#ffffff',
    textColor: '#000000',
    mutedColor: '#52525b',
    headerBg: '#000000',
    headerText: '#ffffff',
    aiBubbleBg: '#ffffff',
    aiBubbleText: '#000000',
    userBubbleBg: '#facc15',
    userBubbleText: '#000000',
    border: '#000000',
    borderWidth: '2px',
    radius: '6px',
    shadow: '4px 4px 0 #000000',
    launcherBg: '#000000',
    launcherText: '#facc15',
    inputBg: '#ffffff',
  },
  'mono-chrome': {
    primaryColor: '#000000',
    surfaceColor: '#ffffff',
    textColor: '#111111',
    mutedColor: '#6b7280',
    headerBg: '#000000',
    headerText: '#ffffff',
    aiBubbleBg: '#f3f4f6',
    aiBubbleText: '#111111',
    userBubbleBg: '#000000',
    userBubbleText: '#ffffff',
    border: '#111111',
    borderWidth: '1px',
    radius: '14px',
    shadow: '0 14px 32px rgba(0,0,0,.18)',
    launcherBg: '#000000',
    launcherText: '#ffffff',
    inputBg: '#ffffff',
  },
};

export interface ResolvedTheme extends ThemePalette {
  preset: ThemePreset;
  position: 'left' | 'right';
  title: string;
  greeting: string;
  launcherLabel: string;
}

export const DEFAULT_THEME: ResolvedTheme = {
  preset: 'default',
  position: 'right',
  title: 'AI Agent',
  greeting: 'Hi! Ask me anything about this site.',
  launcherLabel: 'AI Agent',
  ...THEME_PRESETS.default,
};

// Keys that may be overridden by server theme / data-* attributes. Anything
// outside this set is dropped (the trust-boundary allowlist). The preset id is
// resolved separately (see `resolvePreset`) and is NOT part of this allowlist.
const STRING_KEYS: ReadonlyArray<
  Exclude<keyof ResolvedTheme, 'position' | 'preset'>
> = [
  'primaryColor',
  'textColor',
  'surfaceColor',
  'title',
  'greeting',
  'launcherLabel',
];

/**
 * Validate an untrusted preset id against the known set. Returns `default` for
 * any non-string or unknown value (fail-closed). The id is used only to index
 * `THEME_PRESETS` — never interpolated into markup.
 */
export function resolvePreset(value: unknown): ThemePreset {
  if (typeof value === 'string' && Object.hasOwn(THEME_PRESETS, value)) {
    return value as ThemePreset;
  }
  return 'default';
}

function applyOverrides(
  base: ResolvedTheme,
  overrides: Record<string, unknown>,
): ResolvedTheme {
  const next: ResolvedTheme = { ...base };
  for (const key of STRING_KEYS) {
    const value = overrides[key];
    // Any string overrides — including '' so an admin can clear a title/greeting
    // (the contract only requires a string). Non-strings are dropped.
    if (typeof value === 'string') {
      next[key] = value;
    }
  }
  if (overrides.position === 'left' || overrides.position === 'right') {
    next.position = overrides.position;
  }
  return next;
}

/**
 * Merge the resolved preset palette, the server theme, and `data-*` overrides
 * into a fully resolved theme. `serverTheme` is the raw JSONB from `/config`
 * (may be null); `dataset` is the host `<script>`'s `data-*` attributes as
 * camelCase keys. Preset precedence: `data-theme` over server `theme.preset`.
 */
export function resolveTheme(
  serverTheme: Record<string, unknown> | null,
  dataset: Record<string, string>,
): ResolvedTheme {
  const preset = resolvePreset(dataset.theme ?? serverTheme?.preset);
  const base: ResolvedTheme = {
    ...DEFAULT_THEME,
    preset,
    ...THEME_PRESETS[preset],
  };
  const withServer = applyOverrides(base, serverTheme ?? {});
  return applyOverrides(withServer, dataset);
}

/**
 * Project the visual palette onto namespaced CSS custom properties. The UI
 * applies these via `style.setProperty` on the shadow host — the only channel
 * theme values reach the page. Content/layout fields (title, greeting,
 * launcherLabel, position, preset) are deliberately excluded.
 */
export function themeToCssVars(theme: ResolvedTheme): Record<string, string> {
  return {
    '--vw-primary': theme.primaryColor,
    '--vw-surface': theme.surfaceColor,
    '--vw-text': theme.textColor,
    '--vw-muted': theme.mutedColor,
    '--vw-header-bg': theme.headerBg,
    '--vw-header-text': theme.headerText,
    '--vw-ai-bubble-bg': theme.aiBubbleBg,
    '--vw-ai-bubble-text': theme.aiBubbleText,
    '--vw-user-bubble-bg': theme.userBubbleBg,
    '--vw-user-bubble-text': theme.userBubbleText,
    '--vw-border': theme.border,
    '--vw-border-width': theme.borderWidth,
    '--vw-radius': theme.radius,
    '--vw-shadow': theme.shadow,
    '--vw-launcher-bg': theme.launcherBg,
    '--vw-launcher-text': theme.launcherText,
    '--vw-input-bg': theme.inputBg,
  };
}
