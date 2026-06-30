/**
 * Pure SSE frame parser for the public widget. No DOM/fetch references, so it
 * compiles and runs under the existing node jest (the byte-stream transport
 * that feeds it lives in the browser-only `stream-transport.ts`).
 *
 * The public ask endpoint reuses the internal chat stream event shapes
 * (SPEC-003 §6): `thinking | searching | chunk | done` plus a terminal
 * `error`. `sql_*` cannot occur on this channel and any unknown event type is
 * ignored (the additive contract the SPA also follows).
 */
import { dedupeSources, type WidgetSource } from './sources';

export type WidgetStreamEvent =
  | { type: 'thinking' }
  | { type: 'searching'; query: string }
  | { type: 'chunk'; content: string }
  | { type: 'done'; sources: WidgetSource[] }
  | { type: 'error'; message: string };

interface RawFrame {
  event: string;
  data: string;
}

function splitFrames(buffer: string): { raw: RawFrame[]; remainder: string } {
  const blocks = buffer.split('\n\n');
  const remainder = blocks.pop() ?? '';
  const raw = blocks
    .map((block) => {
      const lines = block.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event:'));
      const dataLines = lines.filter((line) => line.startsWith('data:'));
      if (!eventLine || dataLines.length === 0) {
        return null;
      }
      return {
        event: eventLine.replace(/^event:\s*/, '').trim(),
        data: dataLines.map((line) => line.replace(/^data:\s*/, '')).join('\n'),
      };
    })
    .filter((frame): frame is RawFrame => frame !== null);
  return { raw, remainder };
}

function toEvent(frame: RawFrame): WidgetStreamEvent | null {
  const payload = JSON.parse(frame.data) as Record<string, unknown>;
  // Read a string field, failing fast on a present-but-non-string value instead
  // of coercing (`String({})` → "[object Object]") and masking a protocol bug.
  const readString = (key: string, fallback = ''): string => {
    const value = payload[key];
    if (value == null) return fallback;
    if (typeof value !== 'string') {
      throw new Error(
        `SSE protocol violation: "${frame.event}" payload.${key} must be a string`,
      );
    }
    return value;
  };
  switch (frame.event) {
    case 'thinking':
      return { type: 'thinking' };
    case 'searching':
      return { type: 'searching', query: readString('query') };
    case 'chunk':
      return { type: 'chunk', content: readString('content') };
    case 'done': {
      const reply = payload.reply as
        | { metadata?: { sources?: WidgetSource[] } }
        | undefined;
      const sources = reply?.metadata?.sources ?? [];
      return { type: 'done', sources: dedupeSources(sources) };
    }
    case 'error':
      return { type: 'error', message: readString('message', 'Stream failed') };
    default:
      // Unknown/`sql_*` events are ignored — additive contract.
      return null;
  }
}

/**
 * Parse complete SSE frames out of a decoded buffer. Returns the typed events
 * and the trailing partial frame to carry into the next read. Malformed JSON
 * in a complete frame throws (fail-fast — a protocol violation, not a transient
 * read boundary).
 */
export function parseSseBuffer(buffer: string): {
  events: WidgetStreamEvent[];
  remainder: string;
} {
  const { raw, remainder } = splitFrames(buffer);
  const events = raw
    .map(toEvent)
    .filter((event): event is WidgetStreamEvent => event !== null);
  return { events, remainder };
}
