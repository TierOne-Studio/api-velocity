import { describe, expect, it } from '@jest/globals';
import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('parses bold, italic, and code spans', () => {
    expect(parseInline('a **b** c *d* e `f`')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: ' c ' },
      { type: 'italic', children: [{ type: 'text', value: 'd' }] },
      { type: 'text', value: ' e ' },
      { type: 'code', value: 'f' },
    ]);
  });

  it('parses links with their href and label', () => {
    expect(parseInline('see [docs](https://x.com/a)')).toEqual([
      { type: 'text', value: 'see ' },
      {
        type: 'link',
        href: 'https://x.com/a',
        children: [{ type: 'text', value: 'docs' }],
      },
    ]);
  });

  it('treats an unterminated marker as literal text', () => {
    expect(parseInline('a ** b')).toEqual([{ type: 'text', value: 'a ** b' }]);
  });

  it('keeps snake_case identifiers literal (no intraword underscore emphasis)', () => {
    expect(parseInline('call my_func_name now')).toEqual([
      { type: 'text', value: 'call my_func_name now' },
    ]);
  });

  it('still parses _italic_ at word boundaries', () => {
    expect(parseInline('a _b_ c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'italic', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: ' c' },
    ]);
  });

  it('parses italic nested inside bold', () => {
    expect(parseInline('**a *b* c**')).toEqual([
      {
        type: 'bold',
        children: [
          { type: 'text', value: 'a ' },
          { type: 'italic', children: [{ type: 'text', value: 'b' }] },
          { type: 'text', value: ' c' },
        ],
      },
    ]);
  });

  it('leaves an unterminated link literal (partial streaming)', () => {
    expect(parseInline('see [docs](https://x.co')).toEqual([
      { type: 'text', value: 'see [docs](https://x.co' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('parses an ATX heading with its level', () => {
    const [block] = parseMarkdown('### Active customers');
    expect(block).toEqual({
      type: 'heading',
      level: 3,
      children: [{ type: 'text', value: 'Active customers' }],
    });
  });

  it('parses an unordered list of inline items', () => {
    const [block] = parseMarkdown('- **NA:** 49.8%\n- **EU:** 15.3%');
    expect(block.type).toBe('list');
    if (block.type === 'list') {
      expect(block.ordered).toBe(false);
      expect(block.items).toHaveLength(2);
      expect(block.items[0][0]).toEqual({
        type: 'bold',
        children: [{ type: 'text', value: 'NA:' }],
      });
    }
  });

  it('parses an ordered list', () => {
    const [block] = parseMarkdown('1. first\n2. second');
    expect(block).toMatchObject({ type: 'list', ordered: true });
    if (block.type === 'list') expect(block.items).toHaveLength(2);
  });

  it('parses a fenced code block verbatim', () => {
    const [block] = parseMarkdown('```\nconst x = 1;\n```');
    expect(block).toEqual({ type: 'code', value: 'const x = 1;' });
  });

  it('parses a GFM pipe table with header and rows', () => {
    const [block] = parseMarkdown(
      '| Region | Pct |\n| --- | --- |\n| NA | 49.8% |\n| EU | 15.3% |',
    );
    expect(block.type).toBe('table');
    if (block.type === 'table') {
      expect(block.header.map((c) => c[0])).toEqual([
        { type: 'text', value: 'Region' },
        { type: 'text', value: 'Pct' },
      ]);
      expect(block.rows).toHaveLength(2);
      expect(block.rows[1][0][0]).toEqual({ type: 'text', value: 'EU' });
    }
  });

  it('parses a paragraph with inline markup', () => {
    const [block] = parseMarkdown('Hello **world**');
    expect(block).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'Hello ' },
        { type: 'bold', children: [{ type: 'text', value: 'world' }] },
      ],
    });
  });

  it('separates blocks and ignores blank lines', () => {
    const blocks = parseMarkdown('# Title\n\n- a\n- b\n\npara');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'paragraph']);
  });

  it('returns no blocks for empty/blank input (streaming starts empty)', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\n')).toEqual([]);
  });

  it('auto-closes an unterminated fenced code block (partial stream)', () => {
    const [block] = parseMarkdown('```\nconst x = 1;');
    expect(block).toEqual({ type: 'code', value: 'const x = 1;' });
  });
});
