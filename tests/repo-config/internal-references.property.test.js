// Properties of the internal-reference line matcher.
//
// Why these properties matter: the guard blocks a branch, so a match on a
// line that holds no pattern token at all would stop work for nothing, and
// a token the matcher misses inside ordinary text would let the reference
// through. The example tests pin known shapes; these pin the two directions
// for any surrounding text.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { matchLine } from './internal-references.js';

/**
 * The substrings every pattern needs one of: a line containing none of them
 * cannot match (the first property), whatever else it holds.
 */
const TOKEN_CORE = /owner|DEC-|r\d|#\d/i;

// Built from parts, so this file carries no hit of its own.
const TOKENS = [
  ['the', 'owner'].join(' '),
  `${'DE'}C-PE-10`,
  `${'r'}1320`,
  `${'P'}R #983`,
  `(#${'983'})`,
];

describe('matchLine properties', () => {
  it('never matches a line without a pattern token', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (line) => {
        fc.pre(!TOKEN_CORE.test(line));
        expect(matchLine(line)).toEqual([]);
      }),
      { numRuns: 2000 },
    );
  });

  it('finds a token set off by spaces in any token-free text', () => {
    const tokenFree = fc
      .string({ maxLength: 60 })
      .filter((s) => !TOKEN_CORE.test(s) && !/[\r\n]/.test(s));
    fc.assert(
      fc.property(tokenFree, fc.constantFrom(...TOKENS), tokenFree, (before, token, after) => {
        expect(matchLine(`${before} ${token} ${after}`).length).toBeGreaterThan(0);
      }),
    );
  });
});
