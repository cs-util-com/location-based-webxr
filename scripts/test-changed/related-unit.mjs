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
import { changedFiles } from './changed-paths.mjs';
import { IMPACT_FILE_ENV, readImpactCache } from './graph-dependents.mjs';
import { impactOf, isUnitTest } from './impact-graph.mjs';
import { mergeImpact, planRelatedRun, relatedVitestArgs } from './related-tests.mjs';
import { loadImpactGraph } from './workspace-tree.mjs';

/**
 * The gate run's reached set: from the cache test-changed.mjs wrote for this
 * ref and root (graph-dependents.mjs), else built here.
 * @param {string} root @param {string} ref @param {string[]} everyChange
 */
function impactFor(root, ref, everyChange) {
  const file = process.env[IMPACT_FILE_ENV];
  return (file && readImpactCache(file, { ref, root })) || impactOf(loadImpactGraph(root), everyChange);
}

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
    const everyChange = changedFiles(ref, root);
    const changed = everyChange.flatMap(inPackage);
    const deleted = changed.filter((p) => !existsSync(path.join(pkgDir, p)));
    const testFiles = git(['ls-files', '--cached', '--others', '--exclude-standard', '.'])
      .filter((p) => isUnitTest(p))
      .filter((p) => existsSync(path.join(pkgDir, p)))
      .map((p) => ({ path: p, text: readFileSync(path.join(pkgDir, p), 'utf8') }));
    const own = planRelatedRun({ changed, deleted, testFiles });
    // A change outside this package (upstream, or a file one of its tests
    // reads): add the tests of this package that the import graph reaches.
    const outside = everyChange.some((p) => !p.replaceAll('\\', '/').startsWith(prefix));
    const plan = outside
      ? mergeImpact({ plan: own, impact: impactFor(root, ref, everyChange), packageDir: prefix.slice(0, -1) })
      : own;
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
