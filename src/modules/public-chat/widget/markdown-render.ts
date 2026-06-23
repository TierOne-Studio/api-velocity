/**
 * Browser-only Markdown renderer for the public widget. Turns the pure
 * `parseMarkdown` AST into DOM using ONLY createElement + textContent — never
 * innerHTML — so LLM/source text cannot inject markup (SPEC-003 §10.4). Links
 * render an href only for http(s) urls (`isSafeUrl`); anything else degrades to
 * plain text. Compiled by esbuild + exercised by Playwright; never imported by
 * node jest.
 */
import { isSafeUrl } from './sources';
import { parseMarkdown, type BlockNode, type InlineNode } from './markdown';

function renderInline(nodes: InlineNode[], parent: Node): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parent.appendChild(document.createTextNode(node.value));
        break;
      case 'bold': {
        const el = document.createElement('strong');
        renderInline(node.children, el);
        parent.appendChild(el);
        break;
      }
      case 'italic': {
        const el = document.createElement('em');
        renderInline(node.children, el);
        parent.appendChild(el);
        break;
      }
      case 'code': {
        const el = document.createElement('code');
        el.textContent = node.value;
        parent.appendChild(el);
        break;
      }
      case 'link': {
        if (isSafeUrl(node.href)) {
          const a = document.createElement('a');
          a.href = node.href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          renderInline(node.children, a);
          parent.appendChild(a);
        } else {
          // Unsafe/relative url → render the label as plain text, no anchor.
          renderInline(node.children, parent);
        }
        break;
      }
    }
  }
}

function renderBlock(block: BlockNode): HTMLElement {
  switch (block.type) {
    case 'heading': {
      const el = document.createElement(`h${Math.min(Math.max(block.level, 1), 6)}`);
      renderInline(block.children, el);
      return el;
    }
    case 'paragraph': {
      const el = document.createElement('p');
      renderInline(block.children, el);
      return el;
    }
    case 'code': {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.value;
      pre.appendChild(code);
      return pre;
    }
    case 'list': {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        renderInline(item, li);
        list.appendChild(li);
      }
      return list;
    }
    case 'table': {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const cell of block.header) {
        const th = document.createElement('th');
        renderInline(cell, th);
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const row of block.rows) {
        const tr = document.createElement('tr');
        for (const cell of row) {
          const td = document.createElement('td');
          renderInline(cell, td);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      return table;
    }
  }
}

/** Replace `container`'s content with the rendered Markdown DOM. */
export function renderMarkdownInto(container: HTMLElement, md: string): void {
  container.textContent = '';
  for (const block of parseMarkdown(md)) {
    container.appendChild(renderBlock(block));
  }
}
