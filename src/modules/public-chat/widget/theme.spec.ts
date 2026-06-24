import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  resolvePreset,
  resolveTheme,
  themeToCssVars,
} from './theme';

describe('DEFAULT_THEME', () => {
  it('is rebranded to "AI Agent" on the default preset', () => {
    expect(DEFAULT_THEME.title).toBe('AI Agent');
    expect(DEFAULT_THEME.launcherLabel).toBe('AI Agent');
    expect(DEFAULT_THEME.preset).toBe('default');
  });

  it('preserves the pre-existing default colors (backward compatible)', () => {
    expect(DEFAULT_THEME.primaryColor).toBe('#2563eb');
    expect(DEFAULT_THEME.textColor).toBe('#0f172a');
    expect(DEFAULT_THEME.surfaceColor).toBe('#ffffff');
  });
});

describe('resolvePreset', () => {
  it('returns a known preset id verbatim', () => {
    expect(resolvePreset('obsidian')).toBe('obsidian');
    expect(resolvePreset('neo-brutalism')).toBe('neo-brutalism');
  });

  it('falls back to "default" for an unknown or non-string id (fail-closed)', () => {
    expect(resolvePreset('totally-made-up')).toBe('default');
    expect(resolvePreset(undefined)).toBe('default');
    expect(resolvePreset(42)).toBe('default');
    expect(resolvePreset('<script>')).toBe('default');
  });
});

describe('resolveTheme', () => {
  it('returns defaults when server theme is null and no data-* overrides', () => {
    expect(resolveTheme(null, {})).toEqual(DEFAULT_THEME);
  });

  it('applies the full palette of a preset selected via data-theme', () => {
    const resolved = resolveTheme(null, { theme: 'obsidian' });
    expect(resolved.preset).toBe('obsidian');
    expect(resolved.primaryColor).toBe(THEME_PRESETS.obsidian.primaryColor);
    expect(resolved.surfaceColor).toBe(THEME_PRESETS.obsidian.surfaceColor);
    expect(resolved.headerBg).toBe(THEME_PRESETS.obsidian.headerBg);
  });

  it.each(['cloud', 'obsidian', 'neo-brutalism', 'mono-chrome'] as const)(
    'resolves the full %s palette when selected via data-theme',
    (preset) => {
      expect(resolveTheme(null, { theme: preset })).toEqual({
        ...DEFAULT_THEME,
        preset,
        ...THEME_PRESETS[preset],
      });
    },
  );

  it('falls back to the default palette when data-theme is unknown', () => {
    const resolved = resolveTheme(null, { theme: 'nope' });
    expect(resolved.preset).toBe('default');
    expect(resolved.surfaceColor).toBe(THEME_PRESETS.default.surfaceColor);
  });

  it('lets data-theme win over a server-supplied preset', () => {
    const resolved = resolveTheme({ preset: 'cloud' }, { theme: 'obsidian' });
    expect(resolved.preset).toBe('obsidian');
  });

  it('uses the server preset when no data-theme is present', () => {
    const resolved = resolveTheme({ preset: 'mono-chrome' }, {});
    expect(resolved.preset).toBe('mono-chrome');
  });

  it('lets an explicit data-primary-color override win over the preset palette', () => {
    const resolved = resolveTheme(null, {
      theme: 'obsidian',
      primaryColor: '#abcdef',
    });
    expect(resolved.preset).toBe('obsidian');
    expect(resolved.primaryColor).toBe('#abcdef');
    // non-overridden palette values still come from the preset
    expect(resolved.headerBg).toBe(THEME_PRESETS.obsidian.headerBg);
  });

  it('applies allowlisted server theme values over defaults', () => {
    const resolved = resolveTheme({ primaryColor: '#ff0000', title: 'Ask us' }, {});
    expect(resolved.primaryColor).toBe('#ff0000');
    expect(resolved.title).toBe('Ask us');
  });

  it('data-* overrides win over server theme', () => {
    const resolved = resolveTheme(
      { primaryColor: '#ff0000' },
      { primaryColor: '#00ff00' },
    );
    expect(resolved.primaryColor).toBe('#00ff00');
  });

  it('ignores unknown server theme keys (allowlist, trust boundary)', () => {
    const resolved = resolveTheme(
      { primaryColor: '#abc', evilKey: '<script>' } as Record<string, unknown>,
      {},
    );
    expect(resolved).not.toHaveProperty('evilKey');
    expect(resolved.primaryColor).toBe('#abc');
  });

  it('ignores non-string server values', () => {
    const resolved = resolveTheme(
      { primaryColor: 123 as unknown as string },
      {},
    );
    expect(resolved.primaryColor).toBe(DEFAULT_THEME.primaryColor);
  });

  it('falls back to default position when value is not left/right', () => {
    expect(resolveTheme({ position: 'top' }, {}).position).toBe(
      DEFAULT_THEME.position,
    );
    expect(resolveTheme({ position: 'left' }, {}).position).toBe('left');
  });
});

describe('themeToCssVars', () => {
  it('maps colors to namespaced CSS custom properties', () => {
    const vars = themeToCssVars(DEFAULT_THEME);
    expect(vars['--vw-primary']).toBe(DEFAULT_THEME.primaryColor);
    expect(vars['--vw-text']).toBe(DEFAULT_THEME.textColor);
    expect(vars['--vw-surface']).toBe(DEFAULT_THEME.surfaceColor);
  });

  it('does not emit CSS vars for content/layout fields', () => {
    const vars = themeToCssVars(DEFAULT_THEME);
    const keys = Object.keys(vars);
    expect(keys.every((k) => k.startsWith('--vw-'))).toBe(true);
    expect(JSON.stringify(vars)).not.toContain(DEFAULT_THEME.greeting);
    expect(JSON.stringify(vars)).not.toContain(DEFAULT_THEME.title);
  });

  it('emits the expanded palette vars (header, bubbles, border, radius, shadow, launcher)', () => {
    const vars = themeToCssVars(resolveTheme(null, { theme: 'obsidian' }));
    expect(vars['--vw-header-bg']).toBe(THEME_PRESETS.obsidian.headerBg);
    expect(vars['--vw-ai-bubble-bg']).toBe(THEME_PRESETS.obsidian.aiBubbleBg);
    expect(vars['--vw-radius']).toBe(THEME_PRESETS.obsidian.radius);
    expect(vars['--vw-shadow']).toBe(THEME_PRESETS.obsidian.shadow);
    expect(vars['--vw-launcher-bg']).toBe(THEME_PRESETS.obsidian.launcherBg);
  });
});
