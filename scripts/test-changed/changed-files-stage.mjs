#!/usr/bin/env node
// The format or lint stage of a package in the per-commit fast gate: runs the
// stage's own command on only the files changed against the gate's ref
// (changed-files-command.mjs decides how), skips it when none of them is in
// the stage, or runs it whole when the rewrite is unsure. It says which in
// ONE line, so a narrowed check never reads as the package-wide one.
//
// Usage (from a package dir, as `gateBaseCommand` in
// scripts/test-timing/projects.mjs builds it):
//   node ../scripts/test-changed/changed-files-stage.mjs <command...>
// with GATE_UNIT_RELATED_REF set to the diff base. Without it (or on any git
// failure) the given command runs unchanged.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { UNIT_RELATED_ENV } from '../test-timing/projects.mjs';
import { changedFiles } from './changed-paths.mjs';
import { narrowCommand } from './changed-files-command.mjs';

const fullCommand = process.argv
  .slice(2)
  .map((a) => (/[\s*?{}[\]]/.test(a) ? `"${a}"` : a))
  .join(' ');
const pkgDir = process.cwd();

/** @returns {ReturnType<typeof narrowCommand>} */
function plan() {
  const ref = process.env[UNIT_RELATED_ENV];
  if (!ref) return { mode: 'full', reason: `${UNIT_RELATED_ENV} is not set` };
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: pkgDir, encoding: 'utf8' }).trim();
    const prefix = path.relative(root, pkgDir).replaceAll('\\', '/') + '/';
    const changed = changedFiles(ref, root)
      .map((p) => p.replaceAll('\\', '/'))
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length))
      .filter((p) => existsSync(path.join(pkgDir, p)));
    return narrowCommand(fullCommand, changed);
  } catch (error) {
    return { mode: 'full', reason: `the changed files could not be listed (${String(error).split('\n')[0]})` };
  }
}

/** @param {string} command @returns {number} */
function run(command) {
  return spawnSync(command, { stdio: 'inherit', cwd: pkgDir, shell: true }).status ?? 1;
}

const p = plan();
if (p.mode === 'skip') {
  console.log(`changed-files: ${p.reason}, so it does not run (the whole package is checked at the milestone and in CI)`);
  process.exit(0);
}
if (p.mode === 'full') {
  console.log(`changed-files: whole package - ${p.reason}`);
  process.exit(run(fullCommand));
}
console.log(
  `changed-files: only the ${p.files.length} changed file(s) (the whole package is checked at the milestone and in CI)`
);
process.exit(run(p.command));
