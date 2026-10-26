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

import { describe, expect, it } from 'vitest';

import { __tourMarkdownWalkStepsForTests as walkStepsOf } from './tour-markdown';

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

describe('tour markdown parse work', () => {
  for (const [name, seed] of Object.entries(PATTERNS)) {
    it(`stays linear on ${name}`, () => {
      const small = walkStepsOf(grow(seed, SMALL)) / SMALL;
      const large = walkStepsOf(grow(seed, LARGE)) / LARGE;
      expect(small).toBeGreaterThan(0);
      expect(large / small).toBeLessThan(MAX_SLOPE_RATIO);
    });
  }

  it('counts the same for the same body, whatever was read before', () => {
    const body = grow(PATTERNS.prose ?? '', 2_000);
    expect(walkStepsOf(body)).toBe(walkStepsOf(body));
  });
});
