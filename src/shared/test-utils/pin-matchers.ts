// Custom Jest matcher for behavior-pin tests.
//
// Purpose: lock the SHAPE of a chat-agent turn's streamed event sequence
// without locking the LLM's wording. The matcher accepts a pattern using
// suffix sigils:
//
//   'thinking'      — required, exactly one
//   'searching?'    — optional, zero or one
//   'chunk*'        — zero or more
//   'sql_executed'  — required, exactly one
//
// CRITICAL DESIGN PROPERTY (per proposal §0.2 and §3.6):
// The matcher MUST treat tool-call types as optional so the same pin survives
// later phases. Specifically, after P2 lands schema pre-warming, the sub-agent
// stops calling `list-sql` / `info-sql`; after P3b lands streaming progress
// events, new `sql_planning` / `sql_executing` events appear before
// `sql_executed`. Pins written with `searching?`, `sql_planning?`,
// `sql_executing?` continue to pass under both states. Tests that need
// stricter assertions can use exact-match strings without sigils.

import { expect } from '@jest/globals';
import type { MatcherFunction } from 'expect';

type Sigil = 'required' | 'optional' | 'star';

function parse(pattern: string): { name: string; sigil: Sigil } {
  if (pattern.endsWith('?')) {
    return { name: pattern.slice(0, -1), sigil: 'optional' };
  }
  if (pattern.endsWith('*')) {
    return { name: pattern.slice(0, -1), sigil: 'star' };
  }
  return { name: pattern, sigil: 'required' };
}

export const toMatchPinSequence: MatcherFunction<[expected: readonly string[]]> =
  function (received, expected) {
    if (!Array.isArray(received) || !received.every((v) => typeof v === 'string')) {
      return {
        pass: false,
        message: () =>
          `Expected received to be string[], got ${this.utils.printReceived(received)}`,
      };
    }
    if (!Array.isArray(expected) || !expected.every((v) => typeof v === 'string')) {
      return {
        pass: false,
        message: () =>
          `Expected pattern to be readonly string[], got ${this.utils.printExpected(expected)}`,
      };
    }

    const actual = received as string[];
    let r = 0;
    for (let e = 0; e < expected.length; e++) {
      const { name, sigil } = parse(expected[e]!);
      if (sigil === 'star') {
        while (r < actual.length && actual[r] === name) r++;
      } else if (sigil === 'optional') {
        if (r < actual.length && actual[r] === name) r++;
      } else {
        // required
        if (r >= actual.length || actual[r] !== name) {
          return {
            pass: false,
            message: () =>
              `Pin sequence mismatch at expected index ${e} ("${name}"). ` +
              `Got actual[${r}] = ${actual[r] !== undefined ? `"${actual[r]}"` : '<end>'}. ` +
              `Full actual: [${actual.join(', ')}]. ` +
              `Full expected: [${expected.join(', ')}].`,
          };
        }
        r++;
      }
    }
    if (r < actual.length) {
      return {
        pass: false,
        message: () =>
          `Extra events after pattern completion: [${actual.slice(r).join(', ')}]. ` +
          `Full actual: [${actual.join(', ')}]. ` +
          `Full expected: [${expected.join(', ')}].`,
      };
    }
    return {
      pass: true,
      message: () =>
        `Pin sequence matched. Actual: [${actual.join(', ')}]. Expected: [${expected.join(', ')}].`,
    };
  };

/**
 * Registers the matcher on the global `expect`. Call once per spec file
 * (idempotent — Jest dedupes via `expect.extend`).
 */
export function registerPinMatcher(): void {
  expect.extend({ toMatchPinSequence });
}

// TypeScript augmentation so `expect(events).toMatchPinSequence([...])`
// type-checks in spec files. Spec files use the global `expect` (they import
// only `jest` from '@jest/globals'), so the augmentation targets the global
// `jest.Matchers` interface that Jest 29 exposes for global expect.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toMatchPinSequence(expected: readonly string[]): R;
    }
  }
}

// Required for global augmentation files; without this empty export the file
// would be treated as a script not a module and the augmentation wouldn't
// apply.
export {};
