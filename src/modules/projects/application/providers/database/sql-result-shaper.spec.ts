import { shapeQueryResult } from './sql-result-shaper';

const wide = {
  maxRows: 100,
  maxBytes: 64 * 1024,
  maxFieldBytes: 4 * 1024,
};

describe('shapeQueryResult', () => {
  it('returns empty result for non-array input', () => {
    const result = shapeQueryResult(undefined as never, wide);
    expect(result).toEqual({ rowCount: 0, rows: [], truncated: false });
  });

  it('passes through rows within all caps', () => {
    const rows = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ];
    const result = shapeQueryResult(rows, wide);
    expect(result.rowCount).toBe(2);
    expect(result.rows).toEqual(rows);
    expect(result.truncated).toBe(false);
    expect(result.note).toBeUndefined();
  });

  it('truncates by row count', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ i }));
    const result = shapeQueryResult(rows, {
      maxRows: 3,
      maxBytes: 64_000,
      maxFieldBytes: 1024,
    });
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.note).toMatch(/truncated/);
  });

  it('truncates by total byte budget', () => {
    const rows = Array.from({ length: 5 }, () => ({ blob: 'x'.repeat(1000) }));
    const result = shapeQueryResult(rows, {
      maxRows: 100,
      maxBytes: 1500,
      maxFieldBytes: 10_000,
    });
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBeLessThan(5);
  });

  it('truncates a single oversized field', () => {
    const rows = [{ blob: 'x'.repeat(10_000) }];
    const result = shapeQueryResult(rows, {
      maxRows: 100,
      maxBytes: 64_000,
      maxFieldBytes: 100,
    });
    const firstRow = result.rows[0] as { blob: string };
    expect(firstRow.blob.length).toBeLessThanOrEqual(101); // 100 bytes + ellipsis
    expect(firstRow.blob.endsWith('…')).toBe(true);
  });

  it('serializes Date values to ISO strings', () => {
    const d = new Date('2024-01-02T03:04:05.000Z');
    const result = shapeQueryResult([{ at: d }], wide);
    expect((result.rows[0] as { at: string }).at).toBe(d.toISOString());
  });

  it('renders Buffers as summary tag', () => {
    const buf = Buffer.from([1, 2, 3]);
    const result = shapeQueryResult([{ data: buf }], wide);
    expect((result.rows[0] as { data: string }).data).toMatch(
      /^<buffer 3 bytes>$/,
    );
  });
});
