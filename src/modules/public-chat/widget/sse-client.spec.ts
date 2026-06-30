import { describe, expect, it } from '@jest/globals';
import { parseSseBuffer } from './sse-client';

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe('parseSseBuffer', () => {
  it('parses a chunk event into a typed content event', () => {
    const { events } = parseSseBuffer(
      frame('chunk', { type: 'chunk', content: 'Hello' }),
    );
    expect(events).toEqual([{ type: 'chunk', content: 'Hello' }]);
  });

  it('parses thinking and searching events', () => {
    const buffer =
      frame('thinking', { type: 'thinking' }) +
      frame('searching', { type: 'searching', query: 'pricing' });
    const { events } = parseSseBuffer(buffer);
    expect(events).toEqual([
      { type: 'thinking' },
      { type: 'searching', query: 'pricing' },
    ]);
  });

  it('extracts deduped sources from the terminal done event metadata', () => {
    const { events } = parseSseBuffer(
      frame('done', {
        type: 'done',
        reply: {
          content: 'answer',
          metadata: {
            sources: [
              {
                name: 'A',
                webUrl: 'https://x/a',
                sourceName: 'S',
                entityType: 'page',
              },
              {
                name: 'A',
                webUrl: 'https://x/a',
                sourceName: 'S',
                entityType: 'page',
              },
            ],
          },
        },
      }),
    );
    expect(events).toEqual([
      {
        type: 'done',
        sources: [
          {
            name: 'A',
            webUrl: 'https://x/a',
            sourceName: 'S',
            entityType: 'page',
          },
        ],
      },
    ]);
  });

  it('treats a done event without sources as an empty source list', () => {
    const { events } = parseSseBuffer(
      frame('done', {
        type: 'done',
        reply: { content: 'answer', metadata: {} },
      }),
    );
    expect(events).toEqual([{ type: 'done', sources: [] }]);
  });

  it('maps an error event to a typed error', () => {
    const { events } = parseSseBuffer(
      frame('error', {
        statusCode: 429,
        message: 'Monthly request cap exceeded',
      }),
    );
    expect(events).toEqual([
      { type: 'error', message: 'Monthly request cap exceeded' },
    ]);
  });

  it('retains an incomplete trailing frame as the remainder', () => {
    const buffer =
      frame('chunk', { type: 'chunk', content: 'a' }) +
      'event: chunk\ndata: {"type":"ch';
    const { events, remainder } = parseSseBuffer(buffer);
    expect(events).toEqual([{ type: 'chunk', content: 'a' }]);
    expect(remainder).toBe('event: chunk\ndata: {"type":"ch');
  });

  it('ignores unknown event types (additive contract)', () => {
    const { events } = parseSseBuffer(
      frame('sql_executed', { type: 'sql_executed' }),
    );
    expect(events).toEqual([]);
  });

  it('throws on malformed JSON in a complete frame (fail-fast on protocol violation)', () => {
    expect(() => parseSseBuffer('event: chunk\ndata: {not-json\n\n')).toThrow();
  });

  it('throws when a string field is present but not a string (protocol violation)', () => {
    expect(() =>
      parseSseBuffer(frame('chunk', { type: 'chunk', content: { evil: 1 } })),
    ).toThrow(/payload\.content must be a string/);
  });

  it('drops a frame missing the event or data line', () => {
    const buffer =
      'data: {"type":"chunk","content":"x"}\n\n' + ': comment only\n\n';
    const { events } = parseSseBuffer(buffer);
    expect(events).toEqual([]);
  });

  it('joins multiple data lines in a single frame before parsing', () => {
    const buffer =
      'event: chunk\ndata: {"type":"chunk",\ndata: "content":"multiline"}\n\n';
    const { events } = parseSseBuffer(buffer);
    expect(events).toEqual([{ type: 'chunk', content: 'multiline' }]);
  });
});
