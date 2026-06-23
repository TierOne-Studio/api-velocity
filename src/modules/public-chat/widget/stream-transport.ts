/**
 * Browser-only transport for the public widget: the `fetch`-based `/config`
 * read and the SSE streaming ask. DOM/fetch-typed, so it is compiled ONLY by
 * esbuild (with tsconfig.widget.json's DOM lib) and exercised by the Playwright
 * e2e — never imported by node jest. The frame parsing it delegates to lives in
 * the pure, node-tested `sse-client.ts`.
 */
import { parseSseBuffer, type WidgetStreamEvent } from './sse-client';

const EMBED_KEY_HEADER = 'X-Velocity-Embed-Key';

export interface WidgetConfig {
  theme: Record<string, unknown> | null;
}

/** GET /config — server theming for the resolved embed site. */
export async function fetchWidgetConfig(
  apiBase: string,
  embedKey: string,
): Promise<WidgetConfig> {
  const response = await fetch(`${apiBase}/api/public/chat/config`, {
    method: 'GET',
    headers: { [EMBED_KEY_HEADER]: embedKey },
  });
  if (!response.ok) {
    throw new Error(`config request failed: ${response.status}`);
  }
  return (await response.json()) as WidgetConfig;
}

/**
 * POST /ask/stream and forward each parsed event to `onEvent`. A non-2xx (the
 * 401/403/429 matrix) is surfaced as a single `error` event carrying the
 * server's public-safe message. A transport drop before the terminal `done`
 * is ALSO surfaced as an `error` (distinct message) rather than leaving the UI
 * hanging — the two partial-failure modes are kept distinct per
 * async-error-handling.
 */
export async function streamAsk(params: {
  apiBase: string;
  embedKey: string;
  question: string;
  onEvent: (event: WidgetStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { apiBase, embedKey, question, onEvent, signal } = params;

  const response = await fetch(`${apiBase}/api/public/chat/ask/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      [EMBED_KEY_HEADER]: embedKey,
    },
    body: JSON.stringify({ question }),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `Request failed (${response.status})`;
    // The error body may not be JSON (e.g. a proxy 502) — fall back to the
    // status-derived message rather than throwing on the parse.
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    if (body && typeof body.message === 'string') {
      message = body.message;
    }
    onEvent({ type: 'error', message });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.remainder;
    for (const event of parsed.events) {
      if (event.type === 'done') {
        sawDone = true;
      }
      onEvent(event);
    }
    if (done) {
      break;
    }
  }

  if (!sawDone) {
    onEvent({
      type: 'error',
      message: 'Connection closed before the answer completed.',
    });
  }
}
