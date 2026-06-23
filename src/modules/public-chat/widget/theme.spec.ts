import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_THEME,
  resolveTheme,
  themeToCssVars,
} from './theme';

describe('resolveTheme', () => {
  it('returns defaults when server theme is null and no data-* overrides', () => {
    expect(resolveTheme(null, {})).toEqual(DEFAULT_THEME);
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
  });
});
