/**
 * Why this test matters: a long text is read on a phone while an AR
 * session runs, and the body comes from a file anyone can edit, so the
 * parser must stay linear in the body's length whatever it holds. Each
 * pattern below is a shape that makes a naive Markdown parser rescan what
 * it has already read (unclosed emphasis, brackets, link openings, nested
 * markers, a link closing over a long delimiter stack).
 *
 * The measure is the parser's walk steps
 * (`__tourMarkdownWalkStepsForTests`), not time: timed ratios on a loaded
 * machine spread from 0.2 to 6 for the same linear shape, which no bound
 * can tell from a mild quadratic. The steps are exact, so the bound can be
 * tight: per character they must stay the same from 8 k to 128 k
 * characters, where a quadratic walk reads about 16.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { __tourMarkdownWalkStepsForTests as walkStepsOf } from './tour-markdown';
import { TOUR_MARKDOWN_CHUNK_ALPHABET as CHUNK_ALPHABET } from '../test-utils/tour-markdown-chunks';

const SMALL = 8_000;
const LARGE = 128_000;
/** Steps per character at LARGE over those at SMALL; quadratic reads ~16. */
const MAX_SLOPE_RATIO = 1.5;

const PATTERNS: Record<string, string> = {
  prose:
    'Lorem ipsum dolor sit amet, *consectetur* adipiscing [elit](https://x.org). ',
  'links after open emphasis': '[a](https://x.org) *b ',
  'unclosed emphasis': '*a ',
  'unclosed strong': '**a ',
  // Closers that no opener of their kind precedes: without the openers'
  // bottom, each would walk back over every opener of the other kind.
  'closers of the other kind': '*a b_ ',
  'closers of the other kind, reversed': '_a b* ',
  'intraword underscores': '_a_b',
  // A `__` closer whose openers' bottom a later `_` pair removes from the
  // stack: a bound kept as that delimiter, rather than its position, was
  // never met again, and each closer walked every unclosed `*` below it.
  // Found by the megabyte property, at 53 s for 650 k characters.
  'closers past a removed bottom': '[_*1__[',
  'open brackets': '[',
  'open picture brackets': '![',
  'link openings': '[a](',
  'link openings without spaces': '[](',
  'unbalanced parentheses': '[a](b(',
  'close brackets': ']',
  'nested links': '[[[a](https://x.org)',
  backslashes: '\\',
  'quote markers': '> ',
  'list and quote markers': '- - - 1. > ',
  'nested list lines': '- a\n  - b\n    - c\n',
  'hard breaks': 'a  \n',
  // Many leaves: P is built and walked once per paragraph or item.
  'short paragraphs': 'a\n\n',
  'short list items': '- a\n',
  'emoji next to stars': '\u{1F600}*',
  'picture lines': '![a](asset:a)\n',
  // One long line: the block parser scans a line once per block it tries
  // to open there, which stays linear only while those attempts are few.
  'one line of list markers': '- ',
  'one line of digits': '1',
  'one line of hashes': '#',
  'one heading with closing hashes': '# a #',
};

function grow(seed: string, size: number): string {
  return seed.repeat(Math.ceil(size / seed.length)).slice(0, size);
}

/** The inline marks alone: the emphasis and bracket passes, where every
 *  quadratic shape found so far lived. With `(` and `)` a link can close,
 *  so the bracket pass's link-closing walk is searched too. */
const INLINE_ALPHABET = '*_[]()! a';

/** Steps per character at `large` over those at `small` characters. A body
 *  that costs no steps at either size counts as flat. */
function slopeRatio(seed: string, small = SMALL, large = LARGE): number {
  const perCharSmall = walkStepsOf(grow(seed, small)) / small;
  const perCharLarge = walkStepsOf(grow(seed, large)) / large;
  if (perCharSmall > 0) return perCharLarge / perCharSmall;
  return perCharLarge === 0 ? 1 : Number.POSITIVE_INFINITY;
}

function chunkOf(alphabet: string): fc.Arbitrary<string> {
  return fc.string({
    unit: fc.constantFrom(...alphabet.split('')),
    minLength: 1,
    maxLength: 12,
  });
}

describe('tour markdown parse work', () => {
  for (const [name, seed] of Object.entries(PATTERNS)) {
    it(`stays linear on ${name}`, () => {
      const small = walkStepsOf(grow(seed, SMALL)) / SMALL;
      const large = walkStepsOf(grow(seed, LARGE)) / LARGE;
      expect(small).toBeGreaterThan(0);
      expect(large / small).toBeLessThan(MAX_SLOPE_RATIO);
    });
  }

  // Why: the named patterns hold only the shapes someone already thought
  // of. A random chunk of the marks, repeated, finds a quadratic shape
  // nobody listed, as a time-bounded property once did, but by steps, so a
  // loaded machine cannot flake it. The seed is fixed so a red run names
  // the same chunk every time.
  it('stays linear on random chunks of the marks', () => {
    fc.assert(
      fc.property(chunkOf(CHUNK_ALPHABET), (chunk) => {
        expect(slopeRatio(chunk)).toBeLessThan(MAX_SLOPE_RATIO);
      }),
      { numRuns: 50, seed: 7 }
    );
  });

  // Why: over every mark, only about 2 chunks in 1000 reached the
  // quadratic emphasis walk this parser once had, so 50 runs would miss a
  // defect that rare. Over the inline marks alone about 4 in 1000 do (22 of
  // 5 000 sampled chunks; 10 in 1000 without `(` and `)`, which dilute the
  // emphasis marks but let a link close), and the slope already shows from
  // 2 k to 32 k characters at a quarter of the cost, so 700 runs here find
  // it with about 95 % odds (every seed of 1 to 4 and 7 did).
  it('stays linear on random chunks of the inline marks', () => {
    fc.assert(
      fc.property(chunkOf(INLINE_ALPHABET), (chunk) => {
        expect(slopeRatio(chunk, 2_000, 32_000)).toBeLessThan(MAX_SLOPE_RATIO);
      }),
      { numRuns: 700, seed: 7 }
    );
  });

  it('counts the same for the same body, whatever was read before', () => {
    const body = grow(PATTERNS.prose ?? '', 2_000);
    expect(walkStepsOf(body)).toBe(walkStepsOf(body));
  });
});
