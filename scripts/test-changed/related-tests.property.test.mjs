// Why this test matters: the examples pin known cases; these properties pin
// the shape of the plan for arbitrary inputs. A related plan must never drop
// a changed source, never miss a whole-tree scanner when a source changed,
// never return anything but changed files and existing test files, and must
// not depend on the order git lists the changes in.
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { planRelatedRun } from './related-tests.mjs';

const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
const pathArb = fc
  .tuple(
    fc.constantFrom('src/', 'src/editor/', 'playwright-tests/', 'docs/', 'config/', ''),
    segment,
    fc.constantFrom('.ts', '.test.ts', '.mjs', '.css', '.html', '.md', '.json', '.spec.js')
  )
  .map(([dir, name, ext]) => `${dir}${name}${ext}`);
const testFileArb = fc.record({
  path: fc.tuple(segment).map(([n]) => `src/${n}.test.ts`),
  text: fc.constantFrom(
    "import { x } from './x';",
    'readdirSync(dir)',
    "readFileSync('index.html')",
    'import.meta.glob("./*.ts")'
  ),
});
const inputArb = fc.record({
  changed: fc.array(pathArb, { maxLength: 12 }),
  testFiles: fc.array(testFileArb, { maxLength: 8 }),
});

describe('planRelatedRun properties', () => {
  it('a related plan keeps every changed source and adds only known files', () => {
    fc.assert(
      fc.property(inputArb, ({ changed, testFiles }) => {
        const plan = planRelatedRun({ changed, deleted: [], testFiles });
        if (plan.mode !== 'related') return;
        for (const p of changed) {
          if (p.startsWith('src/') && /\.(?:[cm]?[jt]sx?)$/.test(p)) {
            expect(plan.files).toContain(p);
          }
        }
        const known = new Set([...changed, ...testFiles.map((t) => t.path)]);
        for (const f of plan.files) expect(known.has(f)).toBe(true);
      })
    );
  });

  it('every scanner runs whenever a source changed', () => {
    fc.assert(
      fc.property(inputArb, ({ changed, testFiles }) => {
        const plan = planRelatedRun({ changed, deleted: [], testFiles });
        const sourceChanged = changed.some(
          (p) => p.startsWith('src/') && /\.(?:[cm]?[jt]sx?)$/.test(p)
        );
        if (plan.mode !== 'related' || !sourceChanged) return;
        for (const t of testFiles) {
          if (/readdirSync|import\.meta\.glob/.test(t.text)) {
            expect(plan.files).toContain(t.path);
          }
        }
      })
    );
  });

  it('only a path outside the source, style, page and Playwright classes forces the full suite', () => {
    fc.assert(
      fc.property(inputArb, ({ changed, testFiles }) => {
        const plan = planRelatedRun({ changed, deleted: [], testFiles });
        const outside = changed.some(
          (p) =>
            !p.endsWith('.md') &&
            !(p.startsWith('src/') && /\.(?:[cm]?[jt]sx?)$/.test(p)) &&
            !/\.(?:css|html)$/.test(p) &&
            !p.startsWith('playwright-tests/')
        );
        expect(plan.mode === 'full').toBe(outside);
      })
    );
  });

  it('does not depend on the order of the changes or the test files', () => {
    fc.assert(
      fc.property(inputArb, ({ changed, testFiles }) => {
        const a = planRelatedRun({ changed, deleted: [], testFiles });
        const b = planRelatedRun({
          changed: [...changed].reverse(),
          deleted: [],
          testFiles: [...testFiles].reverse(),
        });
        expect(b.mode).toBe(a.mode);
        if (a.mode === 'related' && b.mode === 'related') expect(b.files).toEqual(a.files);
      })
    );
  });
});
