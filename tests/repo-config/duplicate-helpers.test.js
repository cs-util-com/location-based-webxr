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
// WHAT IT CANNOT DO, stated here rather than discovered later:
//
//  - **It is blind to the same helper under a different name.** The `el(id)`
//    family exists as `el`, `requireEl` and `getRequiredElement`; a fourth
//    `smoothstep` was found by a human reviewer as an inline, unnamed
//    expression in `terrain-slope.ts`. A name-keyed guard finds neither.
//  - **It only guards names someone listed.** It cannot find the NEXT
//    duplicated helper, only re-duplication of a known one. That is the trade
//    accepted when the cross-package detector (which could find new ones, at an
//    unmeasured noise cost) was deliberately not adopted.
//
// It is still worth having: every entry below is a unification that was paid
// for once, and this is what stops it being undone by the next session that
// does not know the helper exists.
//
// See GpsPlusSlamJs_Docs/docs/2026-08-24-0111-helper-unification-plan.md.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
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
    name: 'clamp01',
    rule: 'perPackage',
    why: 'five copies gave three different answers for NaN and Infinity',
  },
  {
    name: 'smoothstep',
    rule: 'perPackage',
    why: 'three character-identical copies three files apart in one package',
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

/** Source files this guard reads: every package's `src/`, tests included. */
function sourceFiles() {
  return execFileSync('git', ['ls-files', '*/src/**.ts'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.endsWith('.d.ts'));
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
    `(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*[(<]` +
      `|(?:^|\\n)\\s*(?:export\\s+)?(?:const|let)\\s+${escaped}\\s*[:=]`
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
