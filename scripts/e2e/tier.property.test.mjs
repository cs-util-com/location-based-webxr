// Why these properties matter: the tier's selection is a set of regular
// expressions built from file names, and a wrong one either drops a changed
// spec (a silent loss of checks) or pulls in an unchanged one (a slower PR
// nobody chose). Example tests cannot cover every name a spec may carry
// (dots, dashes, a name that ends another name), so these state the rules
// over generated names.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TIER_ENV, changedSpecNames, specsImporting, tierGrep } from './tier.mjs';

const segment = fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,11}$/);
const specName = fc
  .tuple(segment, fc.constantFrom('.spec.js', '.spec.mjs'))
  .map(([stem, ext]) => `${stem}${ext}`);
const title = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,20}[A-Za-z]$/);

/** Playwright's grep string: "project file describe title tags". */
const line = (/** @type {string} */ file, /** @type {string} */ t) => `dom playwright-tests/${file} ${t}`;

describe('tier selection properties', () => {
  it('runs every test of each named spec, and no untagged test of another spec', () => {
    fc.assert(
      fc.property(fc.uniqueArray(specName, { maxLength: 5 }), specName, title, (whole, other, t) => {
        const grep = tierGrep({}, whole);
        if (!grep) throw new Error('the tier has a grep');
        const selects = (/** @type {string} */ s) => grep.some((re) => re.test(s));
        for (const name of whole) {
          expect(selects(line(name, t))).toBe(true);
          expect(selects(`webgl playwright-tests\\${name} ${t}`)).toBe(true);
        }
        if (!whole.includes(other)) expect(selects(line(other, t))).toBe(false);
        // A longer name ending in a named one is another file.
        for (const name of whole) {
          if (!whole.includes(`x${name}`)) expect(selects(line(`x${name}`, t))).toBe(false);
        }
      }),
    );
  });

  it('always runs a tagged test, and the full set has no grep at all', () => {
    fc.assert(
      fc.property(fc.uniqueArray(specName, { maxLength: 3 }), specName, title, (whole, file, t) => {
        const grep = tierGrep({}, whole);
        expect(grep?.some((re) => re.test(`${line(file, t)} @pr`))).toBe(true);
        expect(tierGrep({ [TIER_ENV]: 'full' }, whole)).toBeUndefined();
      }),
    );
  });

  it("reads a package's changed specs the same in either slash style, and only that package's", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom('P', 'Q'), fc.array(segment, { maxLength: 2 }), fc.oneof(specName, segment)), {
          maxLength: 6,
        }),
        (entries) => {
          const paths = entries.map(([pkg, dirs, file]) => [pkg, ...dirs, file].join('/'));
          const names = changedSpecNames(paths, 'P');
          expect(changedSpecNames(paths.map((p) => p.replaceAll('/', '\\')), 'P')).toEqual(names);
          const expected = entries
            .filter(([pkg, , file]) => pkg === 'P' && /\.spec\.m?js$/.test(file))
            .map(([, , file]) => file);
          expect(names).toEqual(expected);
        },
      ),
    );
  });

  it('selects a spec for a changed helper exactly when the spec imports it, and more changes never select fewer', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(specName, { minLength: 1, maxLength: 4 }),
        fc.uniqueArray(fc.stringMatching(/^h[0-9]$/), { minLength: 1, maxLength: 4 }),
        fc.func(fc.boolean()),
        fc.integer({ min: 0, max: 3 }),
        (specs, helpers, imports, pick) => {
          /** @type {Record<string, string>} */
          const sources = {};
          for (const h of helpers) sources[`P/t/${h}.js`] = '';
          for (const s of specs) {
            sources[`P/t/${s}`] = helpers
              .filter((h) => imports(s, h))
              .map((h) => `import "./${h}.js";`)
              .join('\n');
          }
          const changed = [`P/t/${helpers[pick % helpers.length]}.js`];
          const selected = specsImporting(changed, sources);
          const h = helpers[pick % helpers.length];
          expect(selected).toEqual(specs.filter((s) => imports(s, h)).sort());
          const more = specsImporting([...changed, ...helpers.map((x) => `P/t/${x}.js`)], sources);
          for (const s of selected) expect(more).toContain(s);
        },
      ),
    );
  });
});
