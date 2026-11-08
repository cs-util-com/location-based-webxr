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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { trackedPaths, untrackedPaths } from './changed-paths.mjs';
import { graphDependents } from './graph-dependents.mjs';
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
