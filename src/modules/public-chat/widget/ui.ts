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
import { renderMarkdownInto } from './markdown-render';

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
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--vw-launcher-bg); color: var(--vw-launcher-text);
  border: var(--vw-border-width) solid var(--vw-border); border-radius: 999px;
  padding: 12px 18px; font: 600 14px system-ui, sans-serif; cursor: pointer;
  box-shadow: var(--vw-shadow);
}
.launcher svg, .header svg { display: block; flex: none; }
.panel {
  position: fixed; bottom: 76px; width: 360px; max-width: calc(100vw - 32px);
  height: 520px; max-height: calc(100vh - 110px); display: none; flex-direction: column;
  background: var(--vw-surface); color: var(--vw-text);
  border: var(--vw-border-width) solid var(--vw-border); border-radius: var(--vw-radius);
  box-shadow: var(--vw-shadow); font: 14px system-ui, sans-serif; overflow: hidden;
}
.panel.open { display: flex; }
.header {
  display: flex; align-items: center; gap: 8px;
  background: var(--vw-header-bg); color: var(--vw-header-text);
  padding: 12px 16px; font-weight: 600;
  border-bottom: var(--vw-border-width) solid var(--vw-border);
}
.body { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.greeting, .answer {
  background: var(--vw-ai-bubble-bg); color: var(--vw-ai-bubble-text);
  border: var(--vw-border-width) solid var(--vw-border); border-radius: var(--vw-radius);
  padding: 8px 12px; align-self: flex-start; max-width: 85%;
}
.answer:empty { display: none; }
.status { color: var(--vw-muted); font-style: italic; min-height: 18px; }
.answer > :first-child { margin-top: 0; }
.answer p { margin: 8px 0; white-space: pre-wrap; }
.answer h1, .answer h2, .answer h3, .answer h4, .answer h5, .answer h6 { margin: 14px 0 6px; font-weight: 600; line-height: 1.25; }
.answer h1 { font-size: 1.25em; } .answer h2 { font-size: 1.15em; } .answer h3 { font-size: 1.05em; }
.answer h4, .answer h5, .answer h6 { font-size: 1em; }
.answer ul, .answer ol { margin: 8px 0; padding-left: 20px; }
.answer li { margin: 2px 0; }
.answer a { color: var(--vw-primary); text-decoration: underline; }
.answer code { background: rgba(128,128,128,.16); border-radius: 4px; padding: 1px 4px; font-family: ui-monospace, monospace; font-size: 0.9em; }
.answer pre { background: rgba(128,128,128,.16); border-radius: 8px; padding: 10px; overflow-x: auto; margin: 8px 0; }
.answer pre code { background: none; padding: 0; }
.answer table { border-collapse: collapse; margin: 8px 0; font-size: 0.92em; width: 100%; }
.answer th, .answer td { border: 1px solid var(--vw-border); padding: 4px 8px; text-align: left; }
.answer th { background: rgba(128,128,128,.12); font-weight: 600; }
.error { color: #b91c1c; margin-top: 8px; }
.sources { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: var(--vw-border-width) solid var(--vw-border); border-radius: 999px; padding: 3px 10px; font-size: 12px; color: var(--vw-text); text-decoration: none; }
.footer { display: flex; gap: 8px; padding: 12px 16px; border-top: var(--vw-border-width) solid var(--vw-border); }
.footer input { flex: 1; padding: 8px 10px; background: var(--vw-input-bg); color: var(--vw-text); border: var(--vw-border-width) solid var(--vw-border); border-radius: 8px; font: inherit; }
.footer input::placeholder { color: var(--vw-muted); }
.footer button { background: var(--vw-launcher-bg); color: var(--vw-launcher-text); border: var(--vw-border-width) solid var(--vw-border); border-radius: 8px; padding: 8px 14px; cursor: pointer; }
.powered { padding: 8px 16px 12px; text-align: center; color: var(--vw-muted); font: 11px system-ui, sans-serif; }
.powered strong { color: var(--vw-text); font-weight: 700; }
`;

// Static, inline robot icon built via the SVG DOM API — no innerHTML, no
// interpolated value. Inherits the surrounding text color via `currentColor`.
function createRobotIcon(size: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const antenna = document.createElementNS(NS, 'line');
  antenna.setAttribute('x1', '12');
  antenna.setAttribute('y1', '3.5');
  antenna.setAttribute('x2', '12');
  antenna.setAttribute('y2', '7');

  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', '12');
  dot.setAttribute('cy', '3');
  dot.setAttribute('r', '1.2');
  dot.setAttribute('fill', 'currentColor');
  dot.setAttribute('stroke', 'none');

  const head = document.createElementNS(NS, 'rect');
  head.setAttribute('x', '4');
  head.setAttribute('y', '7');
  head.setAttribute('width', '16');
  head.setAttribute('height', '12');
  head.setAttribute('rx', '3');

  const eyeL = document.createElementNS(NS, 'circle');
  eyeL.setAttribute('cx', '9.5');
  eyeL.setAttribute('cy', '13');
  eyeL.setAttribute('r', '1.3');
  eyeL.setAttribute('fill', 'currentColor');
  eyeL.setAttribute('stroke', 'none');

  const eyeR = document.createElementNS(NS, 'circle');
  eyeR.setAttribute('cx', '14.5');
  eyeR.setAttribute('cy', '13');
  eyeR.setAttribute('r', '1.3');
  eyeR.setAttribute('fill', 'currentColor');
  eyeR.setAttribute('stroke', 'none');

  svg.append(antenna, dot, head, eyeL, eyeR);
  return svg;
}

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
  const launcherLabel = document.createElement('span');
  launcherLabel.textContent = theme.launcherLabel;
  launcher.append(createRobotIcon(18), launcherLabel);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('data-testid', 'vw-panel');
  panel.style.cssText = side;

  const header = document.createElement('div');
  header.className = 'header';
  const headerTitle = document.createElement('span');
  headerTitle.textContent = theme.title;
  header.append(createRobotIcon(20), headerTitle);

  const body = document.createElement('div');
  body.className = 'body';
  const greeting = document.createElement('div');
  greeting.className = 'greeting';
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

  const powered = document.createElement('div');
  powered.className = 'powered';
  powered.setAttribute('data-testid', 'vw-powered');
  const poweredBrand = document.createElement('strong');
  poweredBrand.textContent = 'Velocity';
  powered.append(document.createTextNode('Powered by '), poweredBrand);

  panel.append(header, body, footer, powered);
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

  // Accumulated raw markdown for the current answer. Each streamed chunk is
  // appended and the answer area is re-rendered from the full markdown so
  // partial syntax (an unclosed **, a heading mid-line) resolves as it arrives.
  let rawAnswer = '';

  return {
    open,
    close,
    setStatus: (text) => {
      status.textContent = text;
    },
    startAnswer: () => {
      rawAnswer = '';
      answer.textContent = '';
      sources.textContent = '';
      const stale = body.querySelector('.error');
      if (stale) {
        stale.remove();
      }
    },
    appendAnswer: (text) => {
      rawAnswer += text;
      renderMarkdownInto(answer, rawAnswer);
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
