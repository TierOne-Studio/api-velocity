/**
 * Tiny, safe-by-construction Markdown parser for the public widget. Pure (no
 * DOM), so it runs under the existing node jest. It produces a small AST that
 * the browser-only `markdown-render.ts` turns into DOM via createElement +
 * textContent — never innerHTML — so LLM/source-provided text can never inject
 * markup (SPEC-003 §10.4 trust boundary).
 *
 * Supported subset (what the platform chat renders via remark-gfm, minus the
 * exotic): headings, paragraphs, bold, italic, inline code, fenced code
 * blocks, unordered/ordered lists, links, and GFM pipe tables.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: 'heading'; level: number; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'code'; value: string }
  | { type: 'table'; header: InlineNode[][]; rows: InlineNode[][][] };

const LIST_ITEM = /^\s*([-*+]|\d+\.)\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

/** Parse inline markup (bold/italic/code/links) within a single text span. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = '';
  let i = 0;
  const flush = (): void => {
    if (buffer) {
      nodes.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (i < text.length) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        nodes.push({ type: 'code', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 1) {
        flush();
        nodes.push({
          type: 'bold',
          children: parseInline(text.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
      // Unterminated `**` — emit literally and skip both stars so the italic
      // rule below doesn't treat the second star as an opening marker.
      buffer += '**';
      i += 2;
      continue;
    }
    if (text[i] === '*' || text[i] === '_') {
      const marker = text[i];
      // `_` delimits emphasis only at word boundaries, so `snake_case`
      // identifiers stay literal; `*` may be intraword (CommonMark).
      const prevOk = marker === '*' || !/\w/.test(text[i - 1] ?? ' ');
      if (prevOk) {
        const end = text.indexOf(marker, i + 1);
        const nextOk =
          end > i && (marker === '*' || !/\w/.test(text[end + 1] ?? ' '));
        if (end > i && nextOk) {
          flush();
          nodes.push({
            type: 'italic',
            children: parseInline(text.slice(i + 1, end)),
          });
          i = end + 1;
          continue;
        }
      }
    }
    if (text[i] === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2);
        if (paren > close) {
          flush();
          nodes.push({
            type: 'link',
            href: text.slice(close + 2, paren),
            children: parseInline(text.slice(i + 1, close)),
          });
          i = paren + 1;
          continue;
        }
      }
    }
    buffer += text[i];
    i++;
  }
  flush();
  return nodes;
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((cell) => cell.trim());
}

function isBlockStart(line: string): boolean {
  return HEADING.test(line) || /^```/.test(line) || LIST_ITEM.test(line);
}

/** Parse a Markdown document into a flat list of block nodes. */
export function parseMarkdown(md: string): BlockNode[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({ type: 'code', value: code.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR.test(lines[i + 1])
    ) {
      const header = splitTableRow(line).map(parseInline);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (
        i < lines.length &&
        lines[i].includes('|') &&
        lines[i].trim() !== ''
      ) {
        rows.push(splitTableRow(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: InlineNode[][] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        const m = LIST_ITEM.exec(lines[i]);
        items.push(parseInline((m?.[2] ?? '').trim()));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isBlockStart(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) });
  }

  return blocks;
}
