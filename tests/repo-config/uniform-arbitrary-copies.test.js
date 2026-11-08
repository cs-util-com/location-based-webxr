// Repo-meta test: the two uniform-draw helpers for property tests are the
// same code.
//
// WHY THERE ARE TWO AT ALL. `GpsPlusSlamJs_Osm` does not depend on
// `gps-plus-slam-app-framework` (the framework depends on it, not the other
// way round), so it cannot import the framework's
// `test-utils/uniform-arbitrary.ts`. It keeps a copy, and this guard is what
// keeps the copy honest.
//
// WHY IT COMPARES THE TEXT. Unlike the HTML escapers (see
// escape-html-copies.test.js), these files differ only in what the two
// packages' prettier settings make of the same code: quote style, trailing
// commas and line wrapping. So the guard can be strict: with comments,
// whitespace, quote style, trailing commas and the `.js` import suffix
// normalised away, the code must be identical. The distribution is the
// contract (the grid, the inward rounding, the `fc.noBias` wrapper, the 9:1
// seam weight), and a change to one copy alone would make the two packages
// sample different worlds while both claim "uniform". The test files are held
// the same way, so "held to the same tests" in the sidecars stays true.
//
// WHAT IT CANNOT DO. It compares source text, not behaviour; both copies'
// behaviour is what their `uniform-arbitrary.test.ts` measures.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PAIRS = [
  [
    'GpsPlusSlamJs_AppFramework/src/test-utils/uniform-arbitrary.ts',
    'GpsPlusSlamJs_Osm/src/test-utils/uniform-arbitrary.ts',
  ],
  [
    'GpsPlusSlamJs_AppFramework/src/test-utils/uniform-arbitrary.test.ts',
    'GpsPlusSlamJs_Osm/src/test-utils/uniform-arbitrary.test.ts',
  ],
];

/**
 * `source` with everything prettier settings or a header comment may change
 * removed: comments, whitespace, quote style, trailing commas and a `.js`
 * suffix on relative imports. What is left is the code.
 */
export function normalisedCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'/g, '"')
    .replace(/(from\s*"\.[^"]*)\.js"/g, '$1"')
    .replace(/\s+/g, '')
    .replace(/,([)\]}])/g, '$1');
}

const read = (file) => readFileSync(resolve(repoRoot, file), 'utf8');

describe('the uniform-draw helper copies', () => {
  it('normalises formatting but not code (so the comparison can fail)', () => {
    // Why this test matters: a normaliser that erased too much would make the
    // guard below pass for any two files.
    expect(normalisedCode("f('a', 1,)\n// note")).toBe(normalisedCode('f("a", 1)'));
    expect(normalisedCode('import { a } from "./x.js";')).toBe(
      normalisedCode("import { a } from './x';"),
    );
    expect(normalisedCode('weight: 9')).not.toBe(normalisedCode('weight: 8'));
    expect(normalisedCode('Math.ceil(min)')).not.toBe(normalisedCode('Math.round(min)'));
  });

  it.each(PAIRS)('%s and %s carry the same code', (canonical, copy) => {
    // Why this test matters: the OSM copy exists only because that package
    // cannot reach the framework. If this fails, make the same change in both
    // files rather than letting them sample differently.
    expect(normalisedCode(read(copy))).toBe(normalisedCode(read(canonical)));
  });
});
