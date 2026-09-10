// Repo-meta test: a canonical helper is not re-implemented under its own name.
//
// WHY THIS EXISTS. `check:dup` already runs jscpd on every commit, and it
// cannot see any of what this guards: it is invoked per package, so it compares
// a package only against ITSELF, and its floor is 50 tokens, which every helper
// below is far under. That is not a misconfiguration — it is a reasonable
// default nobody revisited as the workspace grew to twelve packages — but it
// means the repo had a copy-paste detector and four toasts, five `clamp01`s and
// four `smoothstep`s at the same time.
//
// THE RULE IT ENFORCES (owner decision DEC-H3, 2026-08-24): shared BEHAVIOUR is
// unified across packages; a pure one-liner may exist once per package. So the
// guard has two shapes, `shared` and `perPackage`, and which one a name gets is
// the decision, not an implementation detail.
//
// WHAT IT CANNOT DO. Stated in full, because a guard whose limits are unwritten
// gets read as covering everything. A review found most of these by trying to
// construct violations that slip past — which is the right way to read a
// source-text guard, and the right way to extend this list.
//
//  - **It is blind to the same helper under a different name.** The `el(id)`
//    family exists as `el`, `requireEl` and `getRequiredElement`; a fourth
//    `smoothstep` was found by a human reviewer as an inline, unnamed
//    expression in `terrain-slope.ts`. A name-keyed guard finds neither.
//  - **It only guards names someone listed.** It cannot find the NEXT
//    duplicated helper, only re-duplication of a known one. That is the trade
//    accepted when the cross-package detector (which could find new ones, at an
//    unmeasured noise cost) was deliberately not adopted.
//  - **It sees ONE workspace root.** `git ls-files` runs at the webxr repo
//    root, so `c:\gps\gps-plus-slam\GpsPlusSlamJs` — the core library, and the
//    largest single body of code the rule covers — is invisible to it. Making
//    it cross-root would mean a test in one repository reading another by
//    hardcoded sibling path, which is the coupling the pnpm-override rule
//    exists to keep out of CI. The rule still applies there; this guard does
//    not enforce it.
//  - **It sees `<pkg>/src/**.ts` only.** A copy in `scripts/`, `config/`, at a
//    package root, or in a `.js`/`.mjs`/`.tsx` file is out of scope.
//  - **A class method or object-literal shorthand is not matched.**
//    `class Util { clamp01(v) {} }` reads as a member, and matching that shape
//    would collide with every ordinary method name.
//  - **An UNTRACKED file is invisible.** `git ls-files` lists tracked paths
//    only, so a canonical helper newly created and not yet `git add`ed is not
//    found — which surfaces as the non-vacuity check below failing rather than
//    as a missed duplicate, i.e. it fails loudly and in the safe direction.
//    Staging the file fixes it; CI is unaffected because it only ever sees
//    committed trees. Found on 2026-08-29 while adding `normalizeBearingDeg`.
//
// It is still worth having: every entry below is a unification that was paid
// for once, and this is what stops it being undone by the next session that
// does not know the helper exists.
//
// See GpsPlusSlamJs_Docs/docs/2026-08-24-0111-helper-unification-plan.md.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The canonical helpers, and the rule each one is held to.
 *
 * `shared` — exactly one definition in the whole repo, at `home`.
 * `perPackage` — at most one definition in any single package.
 */
const CANONICAL = [
  {
    name: 'escapeHtml',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/utils/escape-html.ts',
    why: 'two escapers means two chances to miss a character class, and the second one did miss `\'`',
  },
  {
    name: 'formatDistance',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/utils/format-distance.ts',
    why: 'the same quantity was shown to the same user under three rounding rules',
  },
  {
    name: 'createToast',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/utils/toast-core.ts',
    why: 'the announcement contract cost three review rounds and is invisible in finished code',
  },
  {
    name: 'formatDistanceLabel',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/visualization/wayfinding-placement.ts',
    why: 'the same helper under a second name — it is a thin wrapper over format-distance now, and it is the only one of the three wrappers still wearing a formatter name, because it is published API and renaming it would break consumers',
  },
  {
    name: 'clamp01',
    rule: 'perPackage',
    why: 'five copies gave three different answers for NaN and Infinity',
  },
  {
    name: 'smoothstep',
    rule: 'perPackage',
    why: 'three character-identical copies three files apart in one package',
  },
  // The median family. `utils/median.ts` was created by the 2026-07-10
  // quality review to replace SIX private copies carrying two silently
  // different even-length rules, which is the most expensive unification in
  // this list — and it was the one name the guard never learned, so a
  // seventh copy appeared in the same package. Named exports get the
  // `shared` rule because picking the wrong rule is the whole failure mode;
  // the generic `median` gets `perPackage` for packages that cannot reach
  // the framework.
  {
    name: 'interpolatingMedian',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/utils/median.ts',
    why: 'the even-length rule is a contract — averaging two middles fabricates a value that was never observed',
  },
  {
    name: 'lowerMedian',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/utils/median.ts',
    why: 'the counterpart rule, and the copy that came back: elevation-offset-estimator.ts had its own by 2026-08-29',
  },
  {
    name: 'weightedMedian',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/utils/median.ts',
    why: 'its tie-breaking matches the core library’s private solver median, cross-checked in Investigation; a second copy here would drift from a helper it cannot see',
  },
  {
    name: 'cubicBezierEasing',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/utils/cubic-bezier-easing.ts',
    why: 'the wayfinding HUD mirrors a CSS animation whose easing is the token `--ease-out`; a second evaluator (or a look-alike `easeOutCubic`, of which Landing already has one) would drift from the sheet in every frame between the endpoints',
  },
  {
    name: 'normalizeBearingDeg',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/utils/bearing-degrees.ts',
    why: 'six unnamed copies of `((deg % 360) + 360) % 360` in one package, and the early return that separates the correct form from them is a CONTRACT — without it `360 − ε` snaps to 0, a full turn that never happened (core-library fast-check counterexample −2.842e−14). A guard entry cannot see the unnamed form, but it can stop the seventh NAMED one',
  },
  {
    name: 'bearingDeltaDeg',
    rule: 'shared',
    home: 'GpsPlusSlamJs_AppFramework/src/utils/bearing-degrees.ts',
    why: 'the recorder and the framework each had an unnamed signed-delta expression, and they disagreed at exactly 180° - two conventions for one quantity, one of them on the bare double-mod the sibling normalizer exists to replace',
  },
  {
    name: 'median',
    rule: 'perPackage',
    why: 'the unqualified name says nothing about the even-length rule, so two of them in one package is two rules nobody chose between - which is what GpsPlusSlamJs_Osm had',
  },
];

/**
 * Permanent, justified exceptions, keyed on `(name, file)`.
 *
 * The file path is what makes staleness decidable: an entry naming a definition
 * that no longer exists FAILS the test, so an exception cannot outlive the file
 * it excuses. That is the difference between an allowlist and a graveyard.
 */
const JUSTIFIED = [
  {
    name: 'escapeHtml',
    file: 'GpsPlusSlamJs_Landing/src/chapter-dots.ts',
    why: 'the landing page does not depend on the framework, and will not gain that dependency to share ten lines; held to the same contract by escape-html-copies.test.js',
  },
  {
    name: 'smoothstep',
    file: 'GpsPlusSlamJs_AppFramework/src/visualization/occlusion-mesh.ts',
    why: 'the three-argument GLSL form, mirroring the shader beside it line for line — related to the one-argument curve but not interchangeable with it',
  },
];

/**
 * Source files this guard reads: every package's production `src/`.
 *
 * **Test files are excluded**, and that is a decision rather than an oversight.
 * A test-local stub — `const clamp01 = vi.fn()`, or a differential test
 * re-implementing an old body under its real name — is not duplication of
 * production behaviour, but it IS a second definition in the package, so
 * including tests would fail the gate for a legitimate technique. M6 of the
 * unification plan used exactly that technique and only escaped by naming its
 * re-implementation `previous`; the next person would not be so lucky.
 */
function sourceFiles() {
  return execFileSync('git', ['ls-files', '*/src/**.ts'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.endsWith('.d.ts'))
    .filter((file) => !/\.(test|spec)\.ts$/.test(file))
    // The mirror of "an untracked file is invisible": a tracked file DELETED
    // but not yet staged is still listed, and reading it threw ENOENT, so the
    // gate crashed on every deletion until the deletion was staged (found
    // 2026-09-04 deleting `ref-point-importer.ts`). A missing file defines
    // nothing; skip it. CI is unaffected — it only sees committed trees.
    .filter((file) => existsSync(resolve(repoRoot, file)));
}

/**
 * Does `source` DEFINE `name` at the top level?
 *
 * Deliberately narrow. It matches a declaration — `function name(`,
 * `const name = `, `let name = ` — and nothing else, so a call, an import, a
 * property, or a mention in prose does not count. A wider match is how a
 * source-text guard starts reporting comments: the overlay-contract guard did
 * exactly that on 2026-08-24, and a comment saying a package does NOT depend on
 * the framework failed the gate.
 */
export function definesHelper(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    // `export default async function name(` and every shorter form of it. A
    // review found `export default` and `var` slipping past the first version:
    // both are working ways to re-duplicate a canonical helper.
    `(?:^|\\n)\\s*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s+${escaped}\\s*[(<]` +
      `|(?:^|\\n)\\s*(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*[:=]`
  ).test(source);
}

/** The workspace package a repo-relative path belongs to. */
function packageOf(file) {
  return file.split('/')[0];
}

/** Every `(name, file)` where a canonical helper is defined. */
function definitions(files, read) {
  const found = [];
  for (const file of files) {
    const source = read(file);
    for (const { name } of CANONICAL) {
      if (definesHelper(source, name)) found.push({ name, file });
    }
  }
  return found;
}

/** Definitions that break the rule, as human-readable strings. */
export function violations(found, canonical, justified) {
  const excused = new Set(justified.map((e) => `${e.name} @ ${e.file}`));
  const problems = [];

  for (const entry of canonical) {
    const mine = found
      .filter((d) => d.name === entry.name)
      .filter((d) => !excused.has(`${d.name} @ ${d.file}`));

    if (entry.rule === 'shared') {
      for (const d of mine) {
        if (d.file !== entry.home) {
          problems.push(
            `${entry.name} is defined at ${d.file}; its one home is ${entry.home}`
          );
        }
      }
    } else {
      const byPackage = new Map();
      for (const d of mine) {
        const pkg = packageOf(d.file);
        byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), d.file]);
      }
      for (const [pkg, paths] of byPackage) {
        if (paths.length > 1) {
          problems.push(
            `${entry.name} is defined ${paths.length} times in ${pkg}: ${paths.join(', ')}`
          );
        }
      }
    }
  }

  return problems.sort();
}

/** Justified entries whose definition no longer exists. */
export function staleExceptions(found, justified) {
  const live = new Set(found.map((d) => `${d.name} @ ${d.file}`));
  return justified
    .filter((e) => !live.has(`${e.name} @ ${e.file}`))
    .map((e) => `${e.name} @ ${e.file}`)
    .sort();
}

describe('duplicate-helper guard', () => {
  describe('definesHelper', () => {
    // The matcher is the whole guard, so it is tested against the shapes that
    // must and must not count — a source-text rule that matches nothing passes
    // silently, and one that matches too much fails on prose.
    it('matches real definitions', () => {
      for (const source of [
        'export function clamp01(value: number): number {',
        'function clamp01(x) {',
        'const clamp01 = (v) => v;',
        'export const smoothstep = (t: number): number => t;',
        'export async function createToast(root) {',
        'export function escapeHtml<T>(v: T) {',
      ]) {
        const name = /clamp01|smoothstep|createToast|escapeHtml/.exec(
          source
        )[0];
        expect(definesHelper(source, name)).toBe(true);
      }
    });

    it('matches the shapes the repo really writes', () => {
      // NOT hand-written one-liners: these are the actual bodies that existed
      // before the unification, JSDoc and all. The plan asked for exactly this
      // and the first version of the file did not do it — one-line snippets
      // cannot tell you whether the regex survives a doc comment above the
      // declaration, a generic parameter, or a multi-line signature.
      const historical = [
        [
          'clamp01',
          `/**\n * Pure compute helpers\n */\n\nfunction clamp01(x: number): number {\n  if (!Number.isFinite(x)) return 0;\n  if (x < 0) return 0;\n  if (x > 1) return 1;\n  return x;\n}`,
        ],
        [
          'clamp01',
          `function clamp01(x: number): number {\n  return Math.min(1, Math.max(0, x));\n}`,
        ],
        [
          'clamp01',
          `function clamp01(v: number): number {\n  return v < 0 ? 0 : v > 1 ? 1 : v;\n}`,
        ],
        [
          'smoothstep',
          `/** Smoothstep - zero slope at both ends. */\nconst smoothstep = (t: number): number => t * t * (3 - 2 * t);`,
        ],
        [
          'smoothstep',
          `function smoothstep(edge0: number, edge1: number, x: number): number {\n  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));\n  return t * t * (3 - 2 * t);\n}`,
        ],
        [
          'escapeHtml',
          `function escapeHtml(text: string): string {\n  return text\n    .replaceAll("&", "&amp;");\n}`,
        ],
        [
          'createToast',
          `export function createToast(\n  root: HTMLElement,\n  options: ToastOptions = {}\n): Toast {`,
        ],
      ];

      for (const [name, source] of historical) {
        expect(definesHelper(source, name)).toBe(true);
      }
    });

    it('matches the forms that used to slip past', () => {
      // Each of these was a working way to re-duplicate a canonical helper
      // until a review pointed them out.
      expect(
        definesHelper('export default function clamp01(v) {}', 'clamp01')
      ).toBe(true);
      expect(
        definesHelper('export default async function createToast(r) {}', 'createToast')
      ).toBe(true);
      expect(definesHelper('var clamp01 = (v) => v;', 'clamp01')).toBe(true);
    });

    it('does not match calls, imports, properties or prose', () => {
      for (const source of [
        'return clamp01(value);',
        "import { clamp01 } from './clamp01.js';",
        'const x = { clamp01: 1 };',
        '// clamp01 lives in the framework now',
        'export { clamp01 } from "./clamp01.js";',
        'const clamped = clamp01(v);',
      ]) {
        expect(definesHelper(source, 'clamp01')).toBe(false);
      }
    });
  });

  it('finds the canonical helpers where they live (so the guard is not vacuous)', () => {
    // Without this, a matcher that matched NOTHING would leave every assertion
    // below permanently green. This is the check the plan called for after a
    // review found a precondition test that could not fail.
    const found = definitions(sourceFiles(), (file) =>
      readFileSync(resolve(repoRoot, file), 'utf8')
    );
    const paths = found.map((d) => `${d.name} @ ${d.file}`);

    for (const entry of CANONICAL.filter((e) => e.rule === 'shared')) {
      expect(paths).toContain(`${entry.name} @ ${entry.home}`);
    }
    expect(paths).toContain(
      'clamp01 @ GpsPlusSlamJs_AppFramework/src/utils/clamp01.ts'
    );
    expect(paths).toContain('smoothstep @ GpsPlusSlamJs_OsmDemo/src/easing.ts');
  });

  describe('violations', () => {
    it('flags a shared helper defined away from its home', () => {
      const canonical = [{ name: 'escapeHtml', rule: 'shared', home: 'a/x.ts' }];
      const found = [
        { name: 'escapeHtml', file: 'a/x.ts' },
        { name: 'escapeHtml', file: 'b/y.ts' },
      ];

      expect(violations(found, canonical, [])).toEqual([
        'escapeHtml is defined at b/y.ts; its one home is a/x.ts',
      ]);
    });

    it('allows one per package but not two', () => {
      const canonical = [{ name: 'clamp01', rule: 'perPackage' }];
      const oneEach = [
        { name: 'clamp01', file: 'a/x.ts' },
        { name: 'clamp01', file: 'b/y.ts' },
      ];
      const twoInOne = [...oneEach, { name: 'clamp01', file: 'a/z.ts' }];

      expect(violations(oneEach, canonical, [])).toEqual([]);
      expect(violations(twoInOne, canonical, [])).toHaveLength(1);
    });

    it('excuses a justified definition', () => {
      const canonical = [{ name: 'escapeHtml', rule: 'shared', home: 'a/x.ts' }];
      const found = [
        { name: 'escapeHtml', file: 'a/x.ts' },
        { name: 'escapeHtml', file: 'b/y.ts' },
      ];
      const justified = [{ name: 'escapeHtml', file: 'b/y.ts', why: 'reason' }];

      expect(violations(found, canonical, justified)).toEqual([]);
    });
  });

  it('every justified exception still names a real definition', () => {
    // An exception that outlives its file is a claim nobody checked. Failing on
    // it is what keeps the list from becoming a graveyard.
    const found = definitions(sourceFiles(), (file) =>
      readFileSync(resolve(repoRoot, file), 'utf8')
    );

    expect(staleExceptions(found, JUSTIFIED)).toEqual([]);
  });

  it('every justified exception carries a reason', () => {
    for (const entry of JUSTIFIED) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  it('no canonical helper is re-implemented', () => {
    // A non-empty result names the offending file: import the canonical helper,
    // or add a JUSTIFIED entry saying why this one cannot.
    const found = definitions(sourceFiles(), (file) =>
      readFileSync(resolve(repoRoot, file), 'utf8')
    );

    expect(violations(found, CANONICAL, JUSTIFIED)).toEqual([]);
  });
});
