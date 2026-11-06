// Repo-meta test: a gate never changes a versioned file.
//
// Why this test matters: every gate used to rewrite the versioned
// `docs/test-timings.md` of the root and of each package, and every run
// committed the result. Those files were the one thing all branches touched,
// so reviewed, green pull requests went into conflict with `main` after any
// other merge, and each then needed a new branch and a new CI run. The tables
// are gitignored files now, and these tests run the real writer in a throwaway
// repository, because the failure is a property of git and the writer
// together: neither one alone shows it.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { PROJECTS } from '../../scripts/test-timing/projects.mjs';
import { repoRoot, trackedFiles } from './tracked-tree.js';

/** @param {string} dir @returns {string} repo-relative path of a project's table */
const tableOf = (dir) => (dir === '.' ? 'docs/test-timings.md' : `${dir}/docs/test-timings.md`);

/** The environment of a gate outside the GitHub runner, without the machine slot. */
const gateEnv = {
  ...process.env,
  CI: '1',
  GITHUB_ACTIONS: '',
  TIMING_RECORD_ON_RUNNER: '',
  GATE_SLOT_DIR: 'off',
};

describe('the timing tables are not versioned', () => {
  it('tracks no table and ignores the table of every project', () => {
    const tracked = trackedFiles().filter((file) => file.endsWith('docs/test-timings.md'));
    expect(tracked).toEqual([]);
    for (const { dir } of PROJECTS) {
      const ignored = spawnSync('git', ['check-ignore', '-q', tableOf(dir)], { cwd: repoRoot });
      expect(ignored.status, tableOf(dir)).toBe(0);
    }
  });
});

describe('a gate in a throwaway repository', () => {
  const repo = realpathSync(mkdtempSync(join(os.tmpdir(), 'timing-local-')));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  /** @param {string[]} args @returns {string} */
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();

  /** @param {Record<string, string>} [env] */
  const gate = (env = {}) => {
    const run = spawnSync(
      process.execPath,
      ['scripts/test-timing/timed-stage.mjs', 'check:deadcode'],
      { cwd: repo, env: { ...gateEnv, ...env }, encoding: 'utf8' },
    );
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  };

  const table = join(repo, 'docs/test-timings.md');

  // The real scripts and the real ignore rules, and a stand-in for the one
  // tool the root's dead-code stage starts.
  git('init', '-q', '-b', 'main');
  cpSync(join(repoRoot, '.gitignore'), join(repo, '.gitignore'));
  writeFileSync(join(repo, 'package.json'), '{}\n');
  for (const dir of ['test-timing', 'e2e', 'test-changed']) {
    cpSync(join(repoRoot, 'scripts', dir), join(repo, 'scripts', dir), { recursive: true });
  }
  const bin = join(repo, 'node_modules/.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'knip'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'knip'), 0o755);
  writeFileSync(join(bin, 'knip.cmd'), '@exit /b 0\r\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');

  it('leaves git status clean on two branches, with no diff between them', () => {
    git('checkout', '-q', '-b', 'one');
    gate();
    expect(git('status', '--porcelain')).toBe('');
    git('checkout', '-q', '-b', 'two', 'main');
    gate();
    gate();
    expect(git('status', '--porcelain')).toBe('');
    expect(git('diff', '--name-only', 'one', 'two')).toBe('');
    // Not vacuous: the writer ran, and a developer can read the run.
    expect(readFileSync(table, 'utf8')).toContain('check:deadcode');
  }, 60_000);

  it('writes no table on the GitHub runner unless the run asks for one', () => {
    rmSync(table, { force: true });
    gate({ GITHUB_ACTIONS: 'true' });
    expect(existsSync(table)).toBe(false);
    gate({ GITHUB_ACTIONS: 'true', TIMING_RECORD_ON_RUNNER: '1' });
    expect(readFileSync(table, 'utf8')).toContain('check:deadcode');
  }, 60_000);
});
