// Why this test matters: the examples pin known edges; these properties pin
// the shape of the walk for arbitrary trees. A changed unit test always runs
// itself, and adding a change can only add tests and full suites, never drop
// one: a selection that shrinks when more changed would skip a test the
// smaller change already needed.
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { buildImpactGraph, impactOf } from './impact-graph.mjs';

const DIRS = ['A', 'B', 'C'];
const PACKAGES = [
  { dir: 'A', name: 'a', deps: [] },
  { dir: 'B', name: 'b', deps: ['a'] },
  { dir: 'C', name: 'c', deps: ['b'] },
];
const fileArb = fc
  .tuple(fc.constantFrom(...DIRS), fc.constantFrom('x', 'y', 'z', 'w'), fc.boolean())
  .map(([dir, name, test]) => `${dir}/src/${name}${test ? '.test' : ''}.ts`);
const specOf = (/** @type {string} */ from, /** @type {string} */ to) => {
  const [fd] = from.split('/');
  const [td, , file] = to.split('/');
  const base = file.replace(/\.ts$/, '');
  return fd === td ? `./${base}` : `${td.toLowerCase()}/${base}`;
};
const treeArb = fc
  .uniqueArray(fileArb, { minLength: 1, maxLength: 10 })
  .chain((files) =>
    fc.record({
      files: fc.constant(files),
      edges: fc.array(fc.tuple(fc.constantFrom(...files), fc.constantFrom(...files)), { maxLength: 15 }),
      changed: fc.subarray(files, { minLength: 1 }),
      extra: fc.subarray(files),
    })
  );

/** @param {{ files: string[], edges: [string, string][] }} t */
function graphOf({ files, edges }) {
  const texts = new Map(files.map((f) => [f, '']));
  for (const [from, to] of edges) texts.set(from, `${texts.get(from)}\nimport '${specOf(from, to)}';`);
  const packages = PACKAGES.map((p) => ({ ...p, exports: { './*': './src/*.ts' } }));
  return buildImpactGraph({ packages, files, texts });
}

describe('impactOf properties', () => {
  it('every changed unit test is selected', () => {
    fc.assert(
      fc.property(treeArb, (t) => {
        const r = impactOf(graphOf(t), t.changed);
        for (const f of t.changed) if (f.endsWith('.test.ts')) expect(r.tests).toContain(f);
      })
    );
  });

  it('is monotone: more changes never select fewer tests or full suites', () => {
    fc.assert(
      fc.property(treeArb, (t) => {
        const g = graphOf(t);
        const small = impactOf(g, t.changed);
        const big = impactOf(g, [...t.changed, ...t.extra]);
        for (const x of small.tests) expect(big.tests).toContain(x);
        for (const x of small.packages) expect(big.packages).toContain(x);
        const bigFull = big.fullSuite.map((f) => f.dir);
        for (const x of small.fullSuite) expect(bigFull).toContain(x.dir);
      })
    );
  });

  it('does not depend on the order of the changes', () => {
    fc.assert(
      fc.property(treeArb, (t) => {
        const g = graphOf(t);
        expect(impactOf(g, [...t.changed].reverse())).toEqual(impactOf(g, t.changed));
      })
    );
  });
});
