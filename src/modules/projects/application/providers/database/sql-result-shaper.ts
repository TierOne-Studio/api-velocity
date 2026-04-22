import type { ShapedQueryResult } from './types';

function truncateString(value: string, maxBytes: number): string {
  // Byte-length truncation; cheap approximation via Buffer.
  const buf = Buffer.from(value, 'utf8');
  if (buf.byteLength <= maxBytes) return value;
  return buf.subarray(0, maxBytes).toString('utf8') + '…';
}

function shapeValue(value: unknown, maxFieldBytes: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateString(value, maxFieldBytes);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) {
    return `<buffer ${value.byteLength} bytes>`;
  }
  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value);
      return truncateString(str, maxFieldBytes);
    } catch {
      return '<unserializable>';
    }
  }
  return value;
}

function shapeRow(
  row: Record<string, unknown>,
  maxFieldBytes: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = shapeValue(value, maxFieldBytes);
  }
  return out;
}

export function shapeQueryResult(
  rows: unknown[],
  limits: { maxRows: number; maxBytes: number; maxFieldBytes: number },
): ShapedQueryResult {
  if (!Array.isArray(rows)) {
    return { rowCount: 0, rows: [], truncated: false };
  }

  let truncated = false;
  let shaped: unknown[] = rows;
  if (rows.length > limits.maxRows) {
    shaped = rows.slice(0, limits.maxRows);
    truncated = true;
  }

  const shapedRows = shaped.map((row) =>
    row && typeof row === 'object' && !Array.isArray(row)
      ? shapeRow(row as Record<string, unknown>, limits.maxFieldBytes)
      : shapeValue(row, limits.maxFieldBytes),
  );

  let byteBudget = limits.maxBytes;
  const kept: unknown[] = [];
  for (const row of shapedRows) {
    const size = Buffer.byteLength(JSON.stringify(row) ?? '', 'utf8');
    if (byteBudget - size < 0) {
      truncated = true;
      break;
    }
    byteBudget -= size;
    kept.push(row);
  }

  const result: ShapedQueryResult = {
    rowCount: kept.length,
    rows: kept,
    truncated,
  };
  if (truncated) {
    result.note = `result truncated: original ${rows.length} row(s), returning ${kept.length}`;
  }
  return result;
}
