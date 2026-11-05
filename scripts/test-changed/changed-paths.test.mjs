// Why this test matters: test:changed and the Tour Viewer's e2e area
// selection must see the same set of changed files, and the one that is easy
// to lose is the untracked file: `git diff` never lists it, so a brand-new
// module or spec would otherwise count as no change at all and its checks
// would be skipped. Run against a real throwaway repository, because the
// point is git's own output, which a mock would only restate.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { changedPaths, trackedPaths, untrackedPaths } from './changed-paths.mjs';

let repo = '';
/** @param {string[]} args */
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'changed-paths-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'test']);
  mkdirSync(path.join(repo, 'pkg'));
  writeFileSync(path.join(repo, 'pkg', 'kept.txt'), 'a\n');
  writeFileSync(path.join(repo, 'pkg', 'edited.txt'), 'a\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  writeFileSync(path.join(repo, 'pkg', 'edited.txt'), 'b\n');
  writeFileSync(path.join(repo, 'pkg', 'new.txt'), 'n\n');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('changed-paths', () => {
  it('lists an edited tracked file, not an unchanged one', () => {
    expect(trackedPaths('HEAD', repo)).toEqual(['pkg/edited.txt']);
  });

  it('lists an untracked file, which git diff never does', () => {
    expect(untrackedPaths(repo)).toEqual(['pkg/new.txt']);
  });

  it('gives repo-relative paths from a subdirectory too', () => {
    expect(changedPaths('HEAD', path.join(repo, 'pkg')).sort()).toEqual([
      'pkg/edited.txt',
      'pkg/new.txt',
    ]);
  });

  it('throws on an unknown ref instead of reporting no change', () => {
    expect(() => trackedPaths('no-such-ref', repo)).toThrow();
  });
});

// Why: after `git mv` a diff with rename detection lists only the NEW name,
// so the old path never reaches the selection: an unedited test that still
// imports it would not be selected, and the deletion would not force the
// full suite. Both names must be listed.
describe('changed-paths: a rename', () => {
  let moved = '';
  /** @param {string[]} args */
  const gitIn = (args) => execFileSync('git', args, { cwd: moved, encoding: 'utf8' });
  beforeAll(() => {
    moved = mkdtempSync(path.join(tmpdir(), 'changed-paths-mv-'));
    gitIn(['init', '-q']);
    gitIn(['config', 'user.email', 'test@example.invalid']);
    gitIn(['config', 'user.name', 'test']);
    writeFileSync(path.join(moved, 'old.ts'), 'export const a = 1;\n'.repeat(20));
    gitIn(['add', '.']);
    gitIn(['commit', '-q', '-m', 'base']);
    gitIn(['mv', 'old.ts', 'new.ts']);
  });
  afterAll(() => {
    rmSync(moved, { recursive: true, force: true });
  });
  it('lists the old and the new name of a moved file', () => {
    expect(trackedPaths('HEAD', moved).sort()).toEqual(['new.ts', 'old.ts']);
  });
});
