// git's view of what changed in a working tree: the tracked paths that differ
// from a ref (staged and unstaged) plus the untracked ones, which `git diff`
// never lists. Shared by test-changed.mjs (the package selection) and
// scripts/e2e/run-projects.mjs (the e2e area selection), so both see the
// same set.

import { execFileSync } from 'node:child_process';

/**
 * @param {string[]} gitArgs
 * @param {string} cwd
 * @returns {string[]} non-empty output lines
 */
function gitLines(gitArgs, cwd) {
  return execFileSync('git', gitArgs, { cwd, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {string} cwd - any directory inside the work tree; paths are
 *   relative to the repo root (git's own output).
 * @returns {string[]} untracked repo-relative paths (`??` entries)
 */
export function untrackedPaths(cwd) {
  // `--porcelain` paths are relative to the repo root whatever the cwd.
  return gitLines(['status', '--porcelain'], cwd).flatMap((line) =>
    line.startsWith('??') ? [line.slice(2).trim()] : []
  );
}

/**
 * @param {string} ref - the diff base (`HEAD`, a branch, a commit)
 * @param {string} cwd - the repo root (`git diff` paths are root-relative)
 * @returns {string[]} tracked paths that differ from `ref`, staged or not
 * @throws when git fails (an unknown ref, not a work tree)
 */
export function trackedPaths(ref, cwd) {
  // Without rename detection a moved file is listed under its old name too,
  // which a selection needs: the old path's importers are what break.
  return gitLines(['diff', '--name-only', '--no-renames', ref], cwd);
}

/**
 * @param {string} ref - the diff base (`HEAD`, a branch, a commit)
 * @param {string} cwd - the repo root
 * @returns {string[]} tracked changes vs `ref`, then untracked paths
 * @throws when git fails (an unknown ref, not a work tree)
 */
export function changedPaths(ref, cwd) {
  return [...trackedPaths(ref, cwd), ...untrackedPaths(cwd)];
}
