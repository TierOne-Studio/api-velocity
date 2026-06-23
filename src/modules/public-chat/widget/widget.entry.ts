/**
 * Public web-chat widget entry (SPEC-003 Slice 3). Bundled by esbuild into a
 * single self-contained IIFE served at `/api/public/widget/v1/widget.js`. A
 * customer embeds it with:
 *
 *   <script src="https://api.example.com/api/public/widget/v1/widget.js"
 *           data-embed-key="wgt_pub_..." data-primary-color="#0a7"></script>
 *
 * `data-embed-key` is required; `data-api-base` defaults to the script's own
 * origin; remaining `data-*` attributes are theme overrides (see theme.ts).
 */
import { fetchWidgetConfig, streamAsk } from './stream-transport';
import { resolveTheme } from './theme';
import { mountWidget } from './ui';

(function init(): void {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) {
    return;
  }

  const embedKey = script.dataset.embedKey;
  if (!embedKey) {
    // No key → nothing to authenticate as. Fail loud in the console; render
    // nothing (the host page is misconfigured).
    console.error(
      '[velocity-widget] missing required data-embed-key attribute',
    );
    return;
  }

  const apiBase = script.dataset.apiBase ?? new URL(script.src).origin;
  // `document.currentScript` is only valid during this synchronous execution,
  // so capture the script's dataset NOW; the actual mount is deferred below.
  const dataset: Record<string, string> = { ...script.dataset };

  const mount = (): void => {
    const host = document.createElement('div');
    host.setAttribute('data-velocity-widget', '');
    document.body.appendChild(host);
    void boot(embedKey, apiBase, dataset, host);
  };

  // The snippet may be pasted in <head> (or anywhere before </body>), where
  // `document.body` is still null at script-execution time. Defer the mount
  // until the DOM is ready so placement doesn't matter.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();

async function boot(
  embedKey: string,
  apiBase: string,
  dataset: Record<string, string>,
  host: HTMLElement,
): Promise<void> {
  let serverTheme: Record<string, unknown> | null = null;
  try {
    const config = await fetchWidgetConfig(apiBase, embedKey);
    serverTheme = config.theme;
  } catch {
    // /config is best-effort styling; fall back to defaults + data-* overrides.
    serverTheme = null;
  }

  const theme = resolveTheme(serverTheme, dataset);
  const ui = mountWidget(host, theme);

  ui.onSubmit((question) => {
    ui.startAnswer();
    ui.setStatus('Thinking…');
    let streamed = false;

    void streamAsk({
      apiBase,
      embedKey,
      question,
      onEvent: (event) => {
        switch (event.type) {
          case 'searching':
            ui.setStatus('Searching…');
            break;
          case 'chunk':
            if (!streamed) {
              ui.setStatus('');
              streamed = true;
            }
            ui.appendAnswer(event.content);
            break;
          case 'done':
            ui.setStatus('');
            ui.renderSources(event.sources);
            break;
          case 'error':
            ui.setStatus('');
            ui.showError(event.message);
            break;
          default:
            break;
        }
      },
    }).catch(() => {
      ui.setStatus('');
      ui.showError('Something went wrong. Please try again.');
    });
  });
}
