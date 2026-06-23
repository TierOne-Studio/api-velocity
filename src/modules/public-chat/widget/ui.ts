/**
 * Shadow-DOM UI for the public widget. Browser-only (DOM-typed) — compiled by
 * esbuild and exercised by Playwright, never by node jest.
 *
 * Trust boundary (SPEC-003 §10.4): theme values reach the page ONLY as CSS
 * custom properties via `style.setProperty`; all text (answer, greeting,
 * source labels) is written with `textContent`, and source links render an
 * `href` only for http(s) urls. No theme/source/LLM value is ever interpolated
 * into HTML or JS.
 */
import { isSafeUrl, type WidgetSource } from './sources';
import { themeToCssVars, type ResolvedTheme } from './theme';

export interface WidgetUi {
  open(): void;
  close(): void;
  setStatus(text: string): void;
  startAnswer(): void;
  appendAnswer(text: string): void;
  renderSources(sources: WidgetSource[]): void;
  showError(message: string): void;
  onSubmit(handler: (question: string) => void): void;
}

const STYLES = `
:host { all: initial; }
.launcher {
  position: fixed; bottom: 20px; z-index: 2147483000;
  background: var(--vw-primary); color: #fff; border: none; border-radius: 999px;
  padding: 12px 18px; font: 600 14px system-ui, sans-serif; cursor: pointer;
}
.panel {
  position: fixed; bottom: 76px; width: 360px; max-width: calc(100vw - 32px);
  height: 480px; max-height: calc(100vh - 110px); display: none; flex-direction: column;
  background: var(--vw-surface); color: var(--vw-text); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,.18); font: 14px system-ui, sans-serif; overflow: hidden;
}
.panel.open { display: flex; }
.header { background: var(--vw-primary); color: #fff; padding: 12px 16px; font-weight: 600; }
.body { flex: 1; overflow-y: auto; padding: 12px 16px; }
.status { color: #64748b; font-style: italic; min-height: 18px; }
.answer { white-space: pre-wrap; margin-top: 8px; }
.error { color: #b91c1c; margin-top: 8px; }
.sources { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid #cbd5e1; border-radius: 999px; padding: 3px 10px; font-size: 12px; color: var(--vw-text); text-decoration: none; }
.footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #e2e8f0; }
.footer input { flex: 1; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.footer button { background: var(--vw-primary); color: #fff; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
`;

export function mountWidget(host: HTMLElement, theme: ResolvedTheme): WidgetUi {
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);

  for (const [key, value] of Object.entries(themeToCssVars(theme))) {
    host.style.setProperty(key, value);
  }
  const side = theme.position === 'left' ? 'left: 20px;' : 'right: 20px;';

  const launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.setAttribute('data-testid', 'vw-launcher');
  launcher.style.cssText = side;
  launcher.textContent = theme.launcherLabel;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('data-testid', 'vw-panel');
  panel.style.cssText = side;

  const header = document.createElement('div');
  header.className = 'header';
  header.textContent = theme.title;

  const body = document.createElement('div');
  body.className = 'body';
  const greeting = document.createElement('div');
  greeting.textContent = theme.greeting;
  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('data-testid', 'vw-status');
  const answer = document.createElement('div');
  answer.className = 'answer';
  answer.setAttribute('data-testid', 'vw-answer');
  const sources = document.createElement('div');
  sources.className = 'sources';
  sources.setAttribute('data-testid', 'vw-sources');
  body.append(greeting, status, answer, sources);

  const footer = document.createElement('form');
  footer.className = 'footer';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Ask a question…';
  input.setAttribute('data-testid', 'vw-input');
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Send';
  send.setAttribute('data-testid', 'vw-send');
  footer.append(input, send);

  panel.append(header, body, footer);
  root.append(launcher, panel);

  let submitHandler: ((question: string) => void) | null = null;
  const open = (): void => panel.classList.add('open');
  const close = (): void => panel.classList.remove('open');
  launcher.addEventListener('click', () =>
    panel.classList.contains('open') ? close() : open(),
  );
  footer.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || !submitHandler) {
      return;
    }
    input.value = '';
    submitHandler(question);
  });

  return {
    open,
    close,
    setStatus: (text) => {
      status.textContent = text;
    },
    startAnswer: () => {
      answer.textContent = '';
      sources.textContent = '';
      const stale = body.querySelector('.error');
      if (stale) {
        stale.remove();
      }
    },
    appendAnswer: (text) => {
      answer.textContent = (answer.textContent ?? '') + text;
    },
    renderSources: (items) => {
      sources.textContent = '';
      for (const item of items) {
        const label = `${item.name} · ${item.sourceName}`;
        if (isSafeUrl(item.webUrl)) {
          const chip = document.createElement('a');
          chip.className = 'chip';
          chip.href = item.webUrl;
          chip.target = '_blank';
          chip.rel = 'noopener noreferrer';
          chip.textContent = label;
          sources.appendChild(chip);
        } else {
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.textContent = label;
          sources.appendChild(chip);
        }
      }
    },
    showError: (message) => {
      const el = document.createElement('div');
      el.className = 'error';
      el.setAttribute('data-testid', 'vw-error');
      el.textContent = message;
      body.appendChild(el);
    },
    onSubmit: (handler) => {
      submitHandler = handler;
    },
  };
}
