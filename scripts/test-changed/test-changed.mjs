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
// THE BROWSER STAGES RUN A TIER (E2E_TIER, scripts/e2e/tier.mjs): by default
// the tests tagged `@pr` plus every spec file changed against --ref, whole;
// E2E_TIER=full runs every test. CI runs the same tier on every PR and the
// full set nightly, on dispatch and on a `full-ci` label. So a green browser
// run, here or on a PR, says nothing about an untagged test of an unchanged
// spec: that is the full run's job.
//
// Scope: `location-based-webxr` only. `GpsPlusSlamJs` and
// `GpsPlusSlamJs_Investigation` have no equivalent and keep their own full gate.
//
// A COMMITTED MERGE HAS NOTHING TO DIFF against the default HEAD, so a clean
// tree on one is refused (exit 2, select.mjs `cleanMergeRefusal`): name a
// --ref, or --all. A --dry-run is let through, to say what the run would do.
//
// Usage: pnpm run test:changed [--all] [--ref <git-ref>] [--dry-run]
//   --all      run the full cascade (escape hatch, e.g. after a change to
//              the sibling gps-plus-slam-js library consumed via a pnpm
//              link: override, which is invisible to this repo's git)
//   --ref      diff base for tracked changes (default: HEAD — uncommitted
//              work against the last commit); the browser tier also runs
//              every spec file changed against it whole
//   E2E_TIER=full (env) runs every browser test instead of the @pr tier
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
// - the root repo-config tests run in every package-mode run: they are
//   seconds-cheap and guard the root config this selection logic itself
//   depends on (after the framework build when one runs, see select.mjs);
// - a narrowed change (select.mjs.md "Narrowed changes") runs only what can
//   read it, and the run prints ONE line naming everything it runs.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  holdMachineSlotForProcess,
  queueClassOf,
} from '../test-timing/machine-slot.mjs';
import {
  SKIP_BROWSER_ENV,
  resolveGateMode,
} from '../test-timing/projects.mjs';
import {
  STALL_EXIT,
  STALL_SUMMARY,
  watchLine,
} from '../test-timing/stall-watch.mjs';
import {
  cascadeCommands,
  cascadeTierBase,
  cleanMergeRefusal,
  fastGateOptions,
  firstMergeBase,
  MAIN_LINES,
  describeRun,
  docOnlyDirs,
  gateCommands,
  selectPackages,
} from './select.mjs';
import { trackedPaths, untrackedPaths } from './changed-paths.mjs';

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

/** @returns {string | null} the merge-base with the main line, if any */
function mainMergeBase() {
  return firstMergeBase((mainLine) => {
    const found = spawnSync('git', ['merge-base', 'HEAD', mainLine], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    });
    return found.status === 0 ? found.stdout.trim() || null : null;
  });
}

/** @returns {import('./select.mjs').Selection} what the tree asks for now */
function currentSelection() {
  return selectPackages({
    trackedChanges: trackedPaths(ref, WORKSPACE_ROOT),
    untracked: untrackedPaths(WORKSPACE_ROOT),
    packageDirs: packageDirs(),
  });
}

// Before the queue: a refused run must not wait hours for the slot first.
if (!runAll && refIdx === -1) {
  const headLine = spawnSync(
    'git',
    ['rev-list', '--parents', '-n', '1', 'HEAD'],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8' }
  );
  const [head = '', ...parents] =
    headLine.status === 0 ? headLine.stdout.trim().split(/\s+/) : [];
  const refusal = cleanMergeRefusal({
    refGiven: false,
    dryRun,
    selection: currentSelection(),
    headIsMerge: parents.length > 1,
    headOnMain: parents.length > 1 && mainMergeBase() === head,
  });
  if (refusal !== null) {
    console.error(refusal);
    process.exit(2);
  }
}

// The machine slot for the WHOLE run (machine-slot.mjs): every gate this
// spawns inherits the token and re-enters, so another session cannot slip in
// between the repo-config tests and the last dependent. A dry run takes nothing.
// The per-commit gate (browser stages skipped) queues ahead of browser runs.
if (!dryRun) {
  await holdMachineSlotForProcess(`test:changed in ${WORKSPACE_ROOT}`, {
    queueClass: queueClassOf({
      skipBrowser: resolveGateMode(process.env).skipBrowser,
      runsBrowser: true,
    }),
  });
}

/**
 * The cascade's tier base (select.mjs `cascadeTierBase`), said in the log.
 * @returns {string | null}
 */
function tierBaseForCascade() {
  const base = cascadeTierBase({
    env: process.env,
    ref: refIdx !== -1 ? ref : null,
    mergeBase: mainMergeBase,
  });
  console.log(
    base
      ? `test-changed: the browser tier runs every spec changed since ${base} whole`
      : `test-changed: ⚠ no merge-base with any of ${MAIN_LINES.join(', ')}: the browser tier runs only the @pr tests, no changed spec whole`
  );
  return base;
}

// The watchdog limit every stage of this run gets, for whoever waits on its
// log (wait-gate.mjs sizes its quiet window from it, not from its own env).
console.log(watchLine(process.env, { watched: !process.stdout.isTTY }));

if (runAll) {
  if (dryRun) {
    console.log('test-changed: --all ⇒ full cascade (pnpm test)');
    process.exit(0);
  }
  process.exit(runInOrder(cascadeCommands({ tierBase: tierBaseForCascade() })));
}

const selection = currentSelection();

if (selection.mode === 'all') {
  console.log(
    `test-changed: change outside the package dirs ("${selection.reason}") ⇒ full cascade`
  );
  if (dryRun) {
    process.exit(0);
  }
  process.exit(runInOrder(cascadeCommands({ tierBase: tierBaseForCascade() })));
}

const names = selection.packages.map(packageName);
const docOnlyNames = docOnlyDirs(selection.docsOnly ?? []).map(packageName);
console.log(describeRun(selection, ref));
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

/**
 * Runs the commands fail-fast, in order. Construction lives in `select.mjs`
 * so the order is unit-tested; this only executes it.
 *
 * @param {{ command: string, env: Record<string, string> }[]} commands
 * @returns {number} the first non-zero status, else 0
 */
function runInOrder(commands) {
  for (const { command, env } of commands) {
    const status = run(command, env);
    if (status === STALL_EXIT) {
      // NAMED, so GATE-RC=124 is never read as a plain red test.
      console.error(
        `\ntest-changed: ✖ STALLED (exit ${STALL_EXIT}): ${STALL_SUMMARY}`
      );
    }
    if (status !== 0) {
      return status;
    }
  }
  return 0;
}

const status = runInOrder(
  gateCommands(names, {
    skipBrowserEnv: SKIP_BROWSER_ENV,
    rootChecks: selection.rootChecks ?? [],
    docOnlyNames,
    ref,
    ...fastGateOptions(process.env),
  })
);

if (status === 0 && names.length > 0) {
  console.log(
    '\ntest-changed: ✔ commit gate green (DEC-G1) — changed packages in full, dependents without e2e.\n' +
      '  The whole-repo cascade runs once per session before the PR, and on every PR in CI.\n' +
      '  Browser stages ran the per-PR tier (the @pr tests and the changed specs) unless E2E_TIER=full.' +
      (resolveGateMode(process.env).skipBrowser
        ? "\n  This fast gate ran only the changed packages' unit tests related to the change (the related-unit lines above),\n  and the dependents without the checks that read only their own files (format, lint:css, check:dup, check:boundaries)."
        : '')
  );
}
process.exit(status);
