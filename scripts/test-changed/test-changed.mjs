#!/usr/bin/env node
// Dependency-aware ITERATION gate (speedup plan Phase B): runs the gates of
// changed packages plus every package that depends on them, instead of the
// full 8-package cascade. Iteration-only by design — THE FULL `pnpm test`
// CASCADE REMAINS THE COMMIT GATE; nothing here may replace it before a
// commit is declared ready.
//
// Usage: pnpm run test:changed [--all] [--ref <git-ref>] [--dry-run]
//   --all      run the full cascade (escape hatch, e.g. after a change to
//              the sibling gps-plus-slam-js library consumed via a pnpm
//              link: override, which is invisible to this repo's git)
//   --ref      diff base for tracked changes (default: HEAD — uncommitted
//              work against the last commit)
//   --dry-run  print the selection decision without running anything
//
// Selection guard rails live in select.mjs (pure, tested). This shell only
// gathers git's view of the tree and executes the decision:
// - `git diff --name-only <ref>` for tracked changes (staged + unstaged);
// - `git status --porcelain` `??` entries for untracked files, which git
//   diff never lists — a brand-new test file must still count as a change;
// - selected packages run via `pnpm --filter ...<name>` (the package AND its
//   dependents — pnpm's workspace graph provides the safety closure) with
//   --workspace-concurrency=1 (parallel gates would race e2e ports);
// - the root repo-config tests always run first: they are seconds-cheap and
//   guard the root config this selection logic itself depends on.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectPackages } from './select.mjs';

const WORKSPACE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const args = process.argv.slice(2).filter((a) => a !== '--');
const dryRun = args.includes('--dry-run');
const runAll = args.includes('--all');
const refIdx = args.indexOf('--ref');
const ref = refIdx !== -1 ? args[refIdx + 1] : 'HEAD';
if (refIdx !== -1 && !ref) {
  console.error('test-changed: --ref requires a git ref argument');
  process.exit(2);
}

/** @param {string[]} gitArgs @returns {string[]} non-empty output lines */
function gitLines(gitArgs) {
  return execFileSync('git', gitArgs, {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** @returns {string[]} workspace package dir names from pnpm-workspace.yaml */
function packageDirs() {
  // The workspace file lists plain directory names (no globs); parse the
  // simple `- Name` list defensively rather than pulling in a yaml parser.
  const yaml = readFileSync(
    path.join(WORKSPACE_ROOT, 'pnpm-workspace.yaml'),
    'utf8'
  );
  const dirs = [...yaml.matchAll(/^\s*-\s+(\S+)\s*$/gm)].map((m) => m[1]);
  if (dirs.length === 0) {
    throw new Error('no packages parsed from pnpm-workspace.yaml');
  }
  return dirs.filter((dir) => {
    try {
      return readdirSync(path.join(WORKSPACE_ROOT, dir)).includes(
        'package.json'
      );
    } catch {
      return false;
    }
  });
}

/** @param {string} dir @returns {string} the package's pnpm name */
function packageName(dir) {
  return JSON.parse(
    readFileSync(path.join(WORKSPACE_ROOT, dir, 'package.json'), 'utf8')
  ).name;
}

/** @param {string} command @returns {never} exits with the command's code */
function execAndExit(command) {
  console.log(`test-changed: ${command}`);
  const child = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    cwd: WORKSPACE_ROOT,
  });
  process.exit(child.status ?? 1);
}

function warnOnLibraryLinkOverride() {
  try {
    const yaml = readFileSync(
      path.join(WORKSPACE_ROOT, 'pnpm-workspace.yaml'),
      'utf8'
    );
    if (/gps-plus-slam-js:\s*link:/.test(yaml)) {
      console.warn(
        'test-changed: ⚠ gps-plus-slam-js is link-overridden to the sibling repo — library changes are INVISIBLE to this selection. After a library change, use `pnpm run test:changed --all` (or at least the framework+consumer gates).'
      );
    }
  } catch {
    // Advisory only — never block the gate on the warning path.
  }
}

warnOnLibraryLinkOverride();

if (runAll) {
  if (dryRun) {
    console.log('test-changed: --all ⇒ full cascade (pnpm test)');
    process.exit(0);
  }
  execAndExit('pnpm test');
}

const dirs = packageDirs();
const selection = selectPackages({
  trackedChanges: gitLines(['diff', '--name-only', ref]),
  untracked: gitLines(['status', '--porcelain']).flatMap((line) =>
    line.startsWith('??') ? [line.slice(2).trim()] : []
  ),
  packageDirs: dirs,
});

if (selection.mode === 'all') {
  console.log(
    `test-changed: change outside the package dirs ("${selection.reason}") ⇒ full cascade`
  );
  if (dryRun) {
    process.exit(0);
  }
  execAndExit('pnpm test');
}

const names = selection.packages.map(packageName);
console.log(
  names.length === 0
    ? `test-changed: no package changes vs ${ref} — running repo-config tests only`
    : `test-changed: changed vs ${ref}: ${selection.packages.join(', ')} (+ dependents)`
);
if (dryRun) {
  process.exit(0);
}

const filters = names.map((name) => `--filter "...${name}"`).join(' ');
const command =
  names.length === 0
    ? 'pnpm run test:repo-config'
    : `pnpm run test:repo-config && pnpm --workspace-concurrency=1 ${filters} test`;
const child = spawnSync(command, {
  shell: true,
  stdio: 'inherit',
  cwd: WORKSPACE_ROOT,
});
if ((child.status ?? 1) === 0 && names.length > 0) {
  console.log(
    '\ntest-changed: ✔ iteration gate green — remember: the full `pnpm test` cascade is still the commit gate.'
  );
}
process.exit(child.status ?? 1);
