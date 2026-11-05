#!/usr/bin/env node
// The unit stage of a CHANGED package in the per-commit fast gate: runs only
// the tests related to what changed against the gate's ref (related-tests.mjs
// decides which), or the full command when the related set cannot be
// computed. Either way it says so in ONE line, so a slice never reads as the
// suite.
//
// Usage (from a package dir, as `gateBaseCommand` in
// scripts/test-timing/projects.mjs builds it):
//   node ../scripts/test-changed/related-unit.mjs vitest run [--coverage] [args...]
// with GATE_UNIT_RELATED_REF set to the diff base. Without it (or on any git
// failure) the given command runs unchanged.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { UNIT_RELATED_ENV } from '../test-timing/projects.mjs';
import { trackedPaths } from './changed-paths.mjs';
import { planRelatedRun, relatedVitestArgs } from './related-tests.mjs';

const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/;

const fullCommand = process.argv.slice(2);
const pkgDir = process.cwd();

/**
 * @param {string[]} args
 * @returns {string[]} non-empty output lines of a git command in the package
 */
function git(args) {
  return execFileSync('git', args, { cwd: pkgDir, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** @returns {{ files: string[] } | { reason: string }} */
function computePlan() {
  const ref = process.env[UNIT_RELATED_ENV];
  if (!ref) return { reason: `${UNIT_RELATED_ENV} is not set` };
  try {
    const root = git(['rev-parse', '--show-toplevel'])[0];
    const prefix = path.relative(root, pkgDir).replaceAll('\\', '/') + '/';
    const inPackage = (/** @type {string} */ p) =>
      p.startsWith(prefix) ? [p.slice(prefix.length)] : [];
    const changed = [
      ...trackedPaths(ref, root).flatMap(inPackage),
      // Files, not the collapsed directories `git status` shows for a new dir.
      ...git(['ls-files', '--others', '--exclude-standard', '--full-name', '.']).flatMap(
        inPackage
      ),
    ];
    const deleted = changed.filter((p) => !existsSync(path.join(pkgDir, p)));
    const testFiles = git(['ls-files', '--cached', '--others', '--exclude-standard', '.'])
      .filter((p) => TEST_FILE_RE.test(p) && !p.startsWith('playwright-tests/'))
      .filter((p) => existsSync(path.join(pkgDir, p)))
      .map((p) => ({ path: p, text: readFileSync(path.join(pkgDir, p), 'utf8') }));
    const plan = planRelatedRun({ changed, deleted, testFiles });
    if (plan.mode === 'full') return { reason: plan.reason };
    return { files: plan.files };
  } catch (error) {
    return { reason: `the related set could not be computed (${String(error).split('\n')[0]})` };
  }
}

/** @param {string[]} args @returns {number} */
function runVitest(args) {
  // Through node, not a shell: a long file list must not meet cmd.exe's
  // 8 191-character limit.
  const require = createRequire(path.join(pkgDir, 'package.json'));
  const pkgJson = require.resolve('vitest/package.json');
  const bin = /** @type {{ bin: { vitest: string } }} */ (
    JSON.parse(readFileSync(pkgJson, 'utf8'))
  ).bin.vitest;
  const child = spawnSync(process.execPath, [path.join(path.dirname(pkgJson), bin), ...args], {
    stdio: 'inherit',
    cwd: pkgDir,
  });
  return child.status ?? 1;
}

/** @returns {number} */
function runFull() {
  const child = spawnSync(fullCommand.join(' '), { stdio: 'inherit', cwd: pkgDir, shell: true });
  return child.status ?? 1;
}

const plan = computePlan();
const related = 'files' in plan ? relatedVitestArgs(fullCommand, plan.files) : null;
if (!('files' in plan) || related === null) {
  const reason = 'reason' in plan ? plan.reason : 'the command is not a plain vitest run';
  console.log(`related-unit: full suite - ${reason}`);
  process.exit(runFull());
}
if (plan.files.length === 0) {
  console.log(
    'related-unit: no unit test can read this change, so none runs (the full suite runs at the milestone and in CI)'
  );
  process.exit(0);
}
console.log(
  `related-unit: only the tests related to ${plan.files.length} changed or reading file(s) (the full suite runs at the milestone and in CI)`
);
process.exit(runVitest(related));
