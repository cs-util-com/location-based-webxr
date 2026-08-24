// Repo-meta test: the two HTML escapers escape the same characters.
//
// WHY THERE ARE TWO AT ALL. `GpsPlusSlamJs_Landing` does not depend on
// `gps-plus-slam-app-framework` — its dependencies are three, animejs,
// postprocessing and uqr — and adding that edge to a marketing site so it can
// share ten lines of string replacement is the worse trade. So the copy stays,
// and this guard is what makes it safe.
//
// WHY IT COMPARES THE TABLE AND NOT THE TEXT. The obvious guard —
// "character-identical modulo whitespace" — is unachievable: the framework sets
// `singleQuote: true` and the landing page takes prettier's default, so the two
// files disagree on every quote in the table and always will. A guard that
// cannot be satisfied is a guard nobody writes. What must actually agree is the
// CONTRACT: the same characters mapped to the same entities, and the same
// character class in the regex.
//
// WHAT IT IS FOR. Until 2026-08-24 the landing page's copy escaped FOUR of the
// five characters — `'` was missing. It was safe only by accident of its single
// call site, an `aria-label="…"` where an apostrophe cannot break out; a second
// call site would have inherited a hole. Two implementations mean two chances
// to miss a character class, and one of them had already taken it.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CANONICAL = 'GpsPlusSlamJs_AppFramework/src/utils/escape-html.ts';
const COPY = 'GpsPlusSlamJs_Landing/src/chapter-dots.ts';

/**
 * The `character -> entity` pairs of a `REPLACEMENTS` table, quote-agnostic.
 *
 * Matches `'&': '&amp;'` and `"&": "&amp;"` alike, and returns them sorted so
 * the comparison does not depend on declaration order either.
 */
export function replacementPairs(source) {
  const pairs = [];
  const entry = /(['"])(.)\1\s*:\s*(['"])(&[a-z#0-9]+;)\3/gi;
  let match;
  while ((match = entry.exec(source)) !== null) {
    pairs.push(`${match[2]} -> ${match[4]}`);
  }
  return pairs.sort();
}

/** The character class of the first `/[...]/g`-style literal in `source`. */
export function escapedCharacterClass(source) {
  const match = /\.replace\(\s*\/\[([^\]]+)\]\/g/.exec(source);
  return match ? [...match[1]].sort().join('') : null;
}

const read = (file) => readFileSync(resolve(repoRoot, file), 'utf8');

describe('escapeHtml copies', () => {
  describe('replacementPairs', () => {
    // The extractor is the guard; tested against both quote styles so a green
    // result cannot mean "the regex matched nothing in either file".
    it('reads either quote style', () => {
      expect(replacementPairs(`{ '&': '&amp;', '<': '&lt;' }`)).toEqual([
        '& -> &amp;',
        '< -> &lt;',
      ]);
      expect(replacementPairs(`{ "&": "&amp;", "<": "&lt;" }`)).toEqual([
        '& -> &amp;',
        '< -> &lt;',
      ]);
    });

    it('is order-independent', () => {
      expect(replacementPairs(`{ '<': '&lt;', '&': '&amp;' }`)).toEqual(
        replacementPairs(`{ '&': '&amp;', '<': '&lt;' }`)
      );
    });

    it('notices a missing character', () => {
      const five = replacementPairs(
        `{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }`
      );
      const four = replacementPairs(
        `{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }`
      );

      expect(five).toHaveLength(5);
      expect(four).not.toEqual(five);
    });
  });

  it('both files really contain a table (so the guard is not vacuous)', () => {
    // The failure this repo has been bitten by: a source-text guard whose
    // pattern matches nothing passes silently and forever.
    expect(replacementPairs(read(CANONICAL))).toHaveLength(5);
    expect(replacementPairs(read(COPY))).toHaveLength(5);
  });

  it('escape the same characters to the same entities', () => {
    expect(replacementPairs(read(COPY))).toEqual(
      replacementPairs(read(CANONICAL))
    );
  });

  it('match the same character class in the regex', () => {
    // The table is only half the contract: a character present in the map but
    // absent from the class is never looked up.
    const canonical = escapedCharacterClass(read(CANONICAL));

    expect(canonical).not.toBeNull();
    expect(escapedCharacterClass(read(COPY))).toBe(canonical);
  });
});
