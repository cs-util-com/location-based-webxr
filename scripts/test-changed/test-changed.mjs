#!/usr/bin/env node
// Dependency-aware COMMIT gate (DEC-G1, 2026-08-15). Runs the changed packages'
// gates in full, plus every package that depends on them WITHOUT their browser
// stages (DEC-G2), instead of the full 11-package cascade.
//
// It was the ITERATION gate until 2026-08-15, and its header said "THE FULL
// `pnpm test` CASCADE REMAINS THE COMMIT GATE". That changed because the
// cascade was measured at 22.7 min run ~10x on an active day — 4+ hours — while
// CI runs the identical cascade on every PR. The full cascade now runs ONCE per
// session before the PR (DEC-G3), and in CI.
//
// WHAT THIS GIVES UP, stated because a weaker gate must never look like a
// stronger one: a change that breaks only a DEPENDENT's rendering (its e2e) is
// not caught here — it is caught by the session-end cascade or by CI.
//
// Scope: `location-based-webxr` only. `GpsPlusSlamJs` and
// `GpsPlusSlamJs_Investigation` have no equivalent and keep their own full gate.
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
// - changed packages run via `pnpm --filter <name> test` (full gate); their
//   dependents run via `--filter "...<name>" --filter "!<name>"` with
//   GATE_SKIP_BROWSER_STAGES set; --workspace-concurrency=1 throughout
//   (parallel gates would race e2e ports);
// - the root repo-config tests always run first: they are seconds-cheap and
//   guard the root config this selection logic itself depends on.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKIP_BROWSER_ENV } from '../test-timing/projects.mjs';
import { gateCommands, selectPackages } from './select.mjs';

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

/** @returns {boolean} is the sibling library link-overridden into this repo? */
function libraryLinkOverrideActive() {
  try {
    const yaml = readFileSync(
      path.join(WORKSPACE_ROOT, 'pnpm-workspace.yaml'),
      'utf8'
    );
    return /gps-plus-slam-js:\s*link:/.test(yaml);
  } catch {
    // Unreadable workspace file: report "not active" and let the run proceed.
    // The alternative — treating an IO error as an override — would block the
    // gate on the diagnostic path.
    return false;
  }
}

const linkOverride = libraryLinkOverrideActive();
if (linkOverride) {
  console.warn(
    'test-changed: ⚠ gps-plus-slam-js is link-overridden to the sibling repo — library changes are INVISIBLE to this selection.'
  );
}

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

// A LIBRARY-ONLY CHANGE MUST NOT PASS AS A 4-SECOND NO-OP. With the override
// installed, webxr consumes the sibling library from source, so a change there
// is real and this selection cannot see any of it — `git` in THIS repo reports
// nothing. Before DEC-G1 that was harmless (the full cascade was still the
// commit gate); now it would be the whole gate. Without the override the repo
// consumes the published library and a library change genuinely cannot affect
// it, so the guard is deliberately conditioned on the override.
if (names.length === 0 && linkOverride) {
  console.error(
    'test-changed: ✖ no webxr package changed, but the gps-plus-slam-js link: override is active.\n' +
      '  A library change is invisible here, so this run would prove almost nothing.\n' +
      '  Run `pnpm run test:changed --all`, or `cd ../gps-plus-slam/GpsPlusSlamJs && pnpm test` if only the library changed.'
  );
  process.exit(2);
}

/**
 * @param {string} command
 * @param {Record<string, string>} [extraEnv] - merged over process.env. Passed
 *   through spawnSync's `env` rather than inlined as `VAR=1 cmd`, which is not
 *   valid syntax in the cmd.exe shell `shell: true` uses on Windows.
 * @returns {number} exit status
 */
function run(command, extraEnv = {}) {
  console.log(`\ntest-changed: ${command}`);
  const child = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, ...extraEnv },
  });
  return child.status ?? 1;
}

// Construction lives in `select.mjs` so the split is unit-tested; this loop
// only executes it, fail-fast, in order.
let status = 0;
for (const { command, env } of gateCommands(names, {
  skipBrowserEnv: SKIP_BROWSER_ENV,
})) {
  status = run(command, env);
  if (status !== 0) {
    break;
  }
}

if (status === 0 && names.length > 0) {
  console.log(
    '\ntest-changed: ✔ commit gate green (DEC-G1) — changed packages in full, dependents without e2e.\n' +
      '  The whole-repo cascade runs once per session before the PR, and on every PR in CI.'
  );
}
process.exit(status);
