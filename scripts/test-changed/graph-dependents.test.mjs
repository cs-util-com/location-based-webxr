// Why this test matters: it is the fast gate's dependent path end to end on a
// real (throwaway) git workspace, with no mock between git, the files on
// disk, the import graph and the emitted pnpm command. A unit test of each
// piece passes while the pieces disagree on a path form (root-relative or
// not, a slash style, a package dir or its pnpm name); here the commit's
// change must come out as `--filter <the one reached package>`, never as the
// full cascade and never as pnpm's whole `...<name>` closure.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { trackedPaths, untrackedPaths } from './changed-paths.mjs';
import { IMPACT_FILE_ENV, graphDependents, readImpactCache, writeImpactCache } from './graph-dependents.mjs';
import { gateCommands, selectPackages } from './select.mjs';

let root = '';
/** @param {string[]} args */
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
/** @param {string} rel @param {string} text */
const write = (rel, text) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
};
const DIRS = ['Fw', 'Tour', 'Other', 'Dts', 'Rec'];

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'graph-dependents-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'test']);
  write('pnpm-workspace.yaml', 'packages:\n  - Fw\n  - Tour\n  - Other\n  - Dts\n  - Rec\n');
  write('Fw/package.json', JSON.stringify({ name: 'fw', exports: { './*': './dist/*.js' } }));
  write('Fw/src/a.ts', 'export const a = 1;\n');
  write('Fw/src/b.ts', 'export const b = 1;\n');
  write('Fw/src/a.test.ts', "import { a } from './a';\n");
  write('Tour/package.json', JSON.stringify({ name: 'tour', dependencies: { fw: 'workspace:*' } }));
  write('Tour/src/view.ts', "import { a } from 'fw/a';\n");
  write('Tour/src/view.test.ts', "import './view';\n");
  write('Other/package.json', JSON.stringify({ name: 'other', dependencies: { fw: 'workspace:*' } }));
  write('Other/src/o.ts', "import { b } from 'fw/b';\n");
  write('Other/src/o.test.ts', "import './o';\n");
  // Type-level couplings only: a declaration file's import, and a tsconfig
  // that compiles another package's file (the Recorder and the globe do).
  write('Dts/package.json', JSON.stringify({ name: 'dts', dependencies: { fw: 'workspace:*' } }));
  write('Dts/src/global.d.ts', "import type { b } from 'fw/b';\n");
  write('Rec/package.json', JSON.stringify({ name: 'rec' }));
  write('Rec/tsconfig.json', JSON.stringify({ files: ['../Fw/src/b.ts'] }));
  // The Recorder's shape: a base that includes all framework sources, and the
  // programs that extend it excluding the framework tests.
  write('Rec/tsconfig.base.json', JSON.stringify({ include: ['src/**/*.ts', '../Fw/src/**/*.ts'] }));
  write('Rec/tsconfig.app.json', JSON.stringify({ extends: './tsconfig.base.json', exclude: ['../Fw/src/**/*.test.ts'] }));
  write('Fw/src/a.ts.md', '# a\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The fast gate's commands for the work tree's current change. */
function fastGate() {
  const selection = selectPackages({
    trackedChanges: trackedPaths('HEAD', root),
    untracked: untrackedPaths(root),
    packageDirs: DIRS,
  });
  const dependents = graphDependents({ root, ref: 'HEAD', changedDirs: selection.packages ?? [] });
  const nameOf = (/** @type {string} */ dir) => ({ Fw: 'fw', Tour: 'tour', Other: 'other', Dts: 'dts', Rec: 'rec' })[dir];
  return {
    selection,
    dependents,
    commands: gateCommands((selection.packages ?? []).map(nameOf), {
      skipBrowserEnv: 'SKIP',
      ref: 'HEAD',
      relatedUnitEnv: 'REF',
      dependentTrimEnv: 'TRIM',
      dependents: dependents.dirs?.map(nameOf),
    }).map((c) => c.command),
  };
}

describe('the fast gate on a real workspace', () => {
  it('runs only the dependent the change reaches, by an explicit filter', () => {
    write('Fw/src/a.ts', 'export const a = 2;\n');
    const { selection, dependents, commands } = fastGate();
    expect(selection.mode).toBe('packages');
    // Rec compiles every framework source (its tsconfig.base.json include).
    expect(dependents.dirs).toEqual(['Rec', 'Tour']);
    expect(dependents.line).toMatch(/reaches Rec, Tour \(1 unit test file/);
    expect(commands.some((c) => c.includes('--filter tour test'))).toBe(true);
    expect(commands.some((c) => c.includes('other') || c.includes('...fw'))).toBe(false);
    git(['checkout', '-q', '--', 'Fw/src/a.ts']);
  });

  // Why: the r1125 review found that a coupling only tsc sees (a declaration
  // file's import, a tsconfig that compiles another package's file) reached
  // no dependent, so that dependent's typecheck never ran in the fast gate.
  it('runs the dependents that only the type checker couples to the change', () => {
    write('Fw/src/b.ts', 'export const b = 2;\n');
    const { dependents, commands } = fastGate();
    expect(dependents.dirs).toEqual(['Dts', 'Other', 'Rec']);
    expect(commands.some((c) => c.includes('--filter rec test'))).toBe(true);
    git(['checkout', '-q', '--', 'Fw/src/b.ts']);
  });

  // Why: a framework test file and a markdown sidecar sit under Rec's include
  // glob, but no program of Rec compiles either (its programs exclude the
  // framework tests, and markdown is no TypeScript).
  it('runs no dependent for a test-only change', () => {
    write('Fw/src/a.test.ts', "import { a } from './a';\n// more\n");
    write('Fw/src/a.ts.md', '# a, changed\n');
    const { dependents, commands } = fastGate();
    expect(dependents.dirs).toEqual([]);
    expect(dependents.line).toMatch(/no other package/);
    expect(commands.filter((c) => /--filter (tour|other)\b|\.\.\.fw/.test(c))).toEqual([]);
    git(['checkout', '-q', '--', 'Fw/src/a.test.ts', 'Fw/src/a.ts.md']);
  });

  it('falls back to every dependent when the graph cannot be built', () => {
    expect(graphDependents({ root: path.join(root, 'no-such-dir'), ref: 'HEAD', changedDirs: ['Fw'] })).toMatchObject({
      dirs: undefined,
      line: expect.stringMatching(/could not be built/),
    });
  });
});

// Why: every package's unit stage rebuilt the whole graph (about 3.4k file
// reads in this workspace) although test-changed.mjs had just built it for
// the same ref. The gate now builds it once and hands the reached set down;
// a cache written for another ref or root must never be read.
describe('the impact cache the fast gate hands to each unit stage', () => {
  it('round-trips the impact for its ref and root, and is refused for any other', () => {
    const file = path.join(root, 'impact.json');
    const impact = { tests: ['Tour/src/view.test.ts'], packages: ['Tour'], fullSuite: [] };
    const changed = ['Fw/src/a.ts', 'Fw\\src\\b.ts'];
    writeImpactCache(file, { ref: 'HEAD', root, changed, impact });
    expect(readImpactCache(file, { ref: 'HEAD', root, changed })).toEqual(impact);
    // The same list in another order or slash style is the same change set.
    expect(readImpactCache(file, { ref: 'HEAD', root, changed: ['Fw/src/b.ts', 'Fw/src/a.ts'] })).toEqual(impact);
    expect(readImpactCache(file, { ref: 'main', root, changed })).toBeNull();
    expect(readImpactCache(file, { ref: 'HEAD', root: `${root}-other`, changed })).toBeNull();
    expect(readImpactCache(path.join(root, 'missing.json'), { ref: 'HEAD', root, changed })).toBeNull();
    rmSync(file);
  });

  // Why: the ref and root alone do not pin the reached set. A file edited
  // while the gate runs (or a cache file reused by a later run on the same
  // ref) has another change set, and its stale impact would select the wrong
  // tests; a reader must rebuild instead (PR #877 review).
  it('is refused for another set of changed files', () => {
    const file = path.join(root, 'impact.json');
    const impact = { tests: [], packages: ['Tour'], fullSuite: [] };
    writeImpactCache(file, { ref: 'HEAD', root, changed: ['Fw/src/a.ts'], impact });
    expect(readImpactCache(file, { ref: 'HEAD', root, changed: ['Fw/src/a.ts', 'Fw/src/b.ts'] })).toBeNull();
    expect(readImpactCache(file, { ref: 'HEAD', root, changed: [] })).toBeNull();
    rmSync(file);
  });

  it("related-unit takes the reached set from the cache instead of building the graph", () => {
    write('Fw/src/a.ts', 'export const a = 3;\n');
    const file = path.join(tmpdir(), `impact-${process.pid}.json`);
    const impact = { tests: [], packages: ['Tour'], fullSuite: [{ dir: 'Tour', reason: 'the cached reason' }] };
    // The changed list exactly as test-changed.mjs hands it to the cache.
    const { changed } = graphDependents({ root, ref: 'HEAD', changedDirs: ['Fw'] });
    expect(changed).toEqual(['Fw/src/a.ts']);
    writeImpactCache(file, { ref: 'HEAD', root, changed: changed ?? [], impact });
    const script = fileURLToPath(new URL('./related-unit.mjs', import.meta.url));
    const out = execFileSync(process.execPath, [script, 'node', '-e', '0'], {
      cwd: path.join(root, 'Tour'),
      encoding: 'utf8',
      env: { ...process.env, GATE_UNIT_RELATED_REF: 'HEAD', [IMPACT_FILE_ENV]: file },
    });
    expect(out).toMatch(/full suite - the cached reason/);
    rmSync(file);
    git(['checkout', '-q', '--', 'Fw/src/a.ts']);
  });
});
