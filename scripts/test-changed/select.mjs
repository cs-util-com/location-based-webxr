// Pure decision logic for the dependency-aware iteration gate
// (`pnpm run test:changed`): maps a set of changed repo paths to either
// "run the full cascade" or "run these packages (plus their dependents)",
// plus the root checks and package format stages a narrowed change needs.
// The shell (test-changed.mjs) supplies git's view of the working tree and
// executes the decision; keeping the mapping pure makes the guard rails
// unit- and property-testable.
//
// Guard rails encoded here (speedup plan Phase B.2 — treat as load-bearing):
// - Any change OUTSIDE a workspace package (root package.json, workspace
//   yaml, shared configs, scripts/, tests/, …) ⇒ full cascade: pnpm's
//   dependency graph cannot model what root files affect. EXCEPT the root
//   classes in ROOT_NARROW, whose every reader is a root stage (see there).
// - Untracked files count as changes (git diff never lists them; the shell
//   passes them separately).
// - Generated docs/test-timings.md files (root or per-package) NEVER count:
//   every full gate rewrites them, so they are near-permanently dirty and
//   would otherwise pin their package (or the whole cascade) as "changed".
// - A changed package's full gate gets the diff ref (CHANGED_REF_ENV), so a
//   stage that can narrow itself to what changed (the Tour Viewer's e2e,
//   scripts/e2e/run-projects.mjs) can; nothing else reads it.
// - A package whose only change is doc markdown (isPackageDocMarkdown) runs
//   its `format` stage, not its gate; markdown a package stage READS is not
//   doc markdown.

import { CHANGED_REF_ENV } from '../e2e/project-runs.mjs';
import { TIER_BASE_ENV } from '../e2e/tier.mjs';

/**
 * @typedef {{ mode: 'all', reason: string }
 *   | {
 *       mode: 'packages',
 *       packages: string[],
 *       rootChecks?: string[],
 *       rootFiles?: string[],
 *       docsOnly?: string[],
 *     }} Selection
 * `rootChecks` (root scripts to run, e.g. `check:deadcode`), `rootFiles` (the
 * narrowed root paths) and `docsOnly` (doc markdown in packages that run no
 * gate) are present only when non-empty.
 */

/**
 * The served-by edges: a package whose only browser check is another
 * package's browser suite, mapped to that package. A change in the first
 * also selects the second, in full, as a changed package.
 * - The design system SERVES the globe through its routes (it does not
 *   depend on it, so pnpm's graph never selects it); its lab smoke is the
 *   globe's only browser check (globe plan 2026-09-26-0539 §8). The
 *   framework and OsmDemo are served too but are NOT listed: that would put
 *   the design system's ~11 min e2e on every framework commit, an owner
 *   decision filed with the W7 M0 record.
 * - The Tour Viewer DEPENDS on the editor kit, so pnpm selects it on a kit
 *   change, but only as a dependent, without its browser stages (DEC-G2);
 *   its editor e2e is the kit's only browser check (globe editor plan GV5).
 */
const SERVED_BY = {
  GpsPlusSlamJs_Globe: 'GpsPlusSlamJs_DesignSystem',
  GpsPlusSlamJs_EditorKit: 'GpsPlusSlamJs_TourViewer',
};

/** Matches the generated timings file at the root or in any package dir. */
const GENERATED_TIMINGS_RE = /^(?:[^/]+\/)?docs\/test-timings\.md$/;

/**
 * Root paths whose every reader is a ROOT stage, so a change to them needs
 * those stages and not the whole cascade. `test:repo-config` runs in every package
 * selection anyway; `checks` names what else is needed. Who reads them:
 * - `tests/repo-config/**`: only the root vitest run, and knip's root
 *   workspace (`knip.json` "." has entry `tests/**\/*.test.js` and project
 *   `tests/**\/*.js`), so a dead helper export is seen only by knip;
 * - `knip.json`: only knip;
 * - root markdown: only the repo-config guards (sidecars, doc comments, the
 *   CLA, the ports doc); no root format stage exists;
 * - `.github/**`, `.vscode/**`: CI and the editor; the only local reader is
 *   the repo-config `cla-config` guard.
 * Everything else at the root stays on the full cascade, notably the gate
 * tooling itself (`scripts/test-timing/**`, `scripts/test-changed/**`, which
 * RUN every gate), `scripts/e2e/**`, the lockfile and the workspace configs.
 * A new reader of one of these classes outside the root stages needs this
 * table changed; the search behind it is a snapshot (select.mjs.md).
 *
 * @type {readonly { test: (path: string) => boolean, checks: readonly string[] }[]}
 */
const ROOT_NARROW = [
  { test: (p) => p.startsWith('tests/repo-config/'), checks: ['check:deadcode'] },
  { test: (p) => p === 'knip.json', checks: ['check:deadcode'] },
  { test: (p) => p.toLowerCase().endsWith('.md'), checks: [] },
  { test: (p) => p.startsWith('.github/') || p.startsWith('.vscode/'), checks: [] },
];

/**
 * Package markdown that no package stage reads as input: a sidecar (`name.ext.md`), a README or CHANGELOG, or
 * anything under a `docs/` dir; never anything under `assets/`, `public/`,
 * `fixtures/` or `testdata/`.
 * The free-standing markdown a stage does read keeps its package gate by not
 * matching: the design system's `hud-design-brief.md` (check-tokens.mjs), a
 * fixtures `PROVENANCE.md` (terrain-fixtures.test.mjs). `assets/` is out
 * because the Globe's asset budget sums every file there and the design
 * system's lookdev build lists its README; `public/` because it is shipped;
 * `fixtures/` and `testdata/` because they are test input (the terrain
 * fixtures budget sums every file under its `fixtures/`).
 *
 * @param {string} path - normalized, inside a package
 * @returns {boolean}
 */
export function isPackageDocMarkdown(path) {
  if (!path.toLowerCase().endsWith('.md')) return false;
  if (/\/(?:assets|public|fixtures|testdata)\//.test(path)) return false;
  const base = path.split('/').pop() ?? '';
  return (
    /\.[A-Za-z0-9]+\.md$/.test(base) ||
    /^(?:README|CHANGELOG)\.md$/i.test(base) ||
    /\/docs\//.test(path)
  );
}

/**
 * @param {string} path - repo-relative path, either slash style
 * @returns {string} forward-slash normalized path
 */
function normalize(path) {
  return path.replaceAll('\\', '/');
}

/**
 * @param {object} input
 * @param {readonly string[]} input.trackedChanges - repo-relative paths from
 *   `git diff --name-only <ref>` (tracked changes vs the ref, incl. staged)
 * @param {readonly string[]} input.untracked - repo-relative paths of
 *   untracked files (`git status --porcelain` `??` entries)
 * @param {readonly string[]} input.packageDirs - workspace package dir names
 * @returns {Selection}
 */
export function selectPackages({ trackedChanges, untracked, packageDirs }) {
  /** @type {Set<string>} */
  const selected = new Set();
  /** @type {Set<string>} */
  const rootChecks = new Set();
  /** @type {Set<string>} */
  const rootFiles = new Set();
  /** @type {Set<string>} */
  const docFiles = new Set();
  for (const rawPath of [...trackedChanges, ...untracked]) {
    const path = normalize(rawPath);
    if (path === '' || GENERATED_TIMINGS_RE.test(path)) {
      continue;
    }
    const topDir = path.split('/')[0];
    if (path.includes('/') && packageDirs.includes(topDir)) {
      if (isPackageDocMarkdown(path)) {
        docFiles.add(path);
      } else {
        selected.add(topDir);
      }
      continue;
    }
    const narrow = ROOT_NARROW.find((rule) => rule.test(path));
    if (narrow) {
      rootFiles.add(path);
      for (const check of narrow.checks) rootChecks.add(check);
      continue;
    }
    return { mode: 'all', reason: path };
  }
  for (const [served, server] of Object.entries(SERVED_BY)) {
    if (selected.has(served) && packageDirs.includes(server)) {
      selected.add(server);
    }
  }
  /** @type {Selection} */
  const selection = { mode: 'packages', packages: [...selected].sort() };
  if (rootChecks.size > 0) selection.rootChecks = [...rootChecks].sort();
  if (rootFiles.size > 0) selection.rootFiles = [...rootFiles].sort();
  // A doc file in a package that runs its full gate is formatted there.
  const docsOnly = [...docFiles].filter((f) => !selected.has(f.split('/')[0]));
  if (docsOnly.length > 0) selection.docsOnly = docsOnly.sort();
  return selection;
}

/**
 * @param {readonly string[]} docsOnly
 * @returns {string[]} the package dirs of doc-only files, sorted, deduped
 */
export function docOnlyDirs(docsOnly) {
  return [...new Set(docsOnly.map((f) => f.split('/')[0]))].sort();
}

/**
 * Builds the framework's `dist` unless it is already newer than every input
 * (stale-dist follow-up 2026-09-28-1910, option 1; gate-speed plan G2).
 *
 * The demo apps (Tour Viewer, AnchorStarter, ...) resolve the framework
 * through its package `exports`, i.e. through `dist`, and their own
 * `build:framework` stage sits AFTER `typecheck` and `test:unit`. The
 * framework's own gate builds nothing. So on a framework change a dependent
 * type-checked and unit-tested against whatever `dist` was on disk: a false
 * green whenever the source had removed an export the old `dist` still had.
 * CI is safe because it builds first; this makes the local order agree.
 *
 * Run for EVERY package selection, not only one that contains a framework
 * consumer: on a fresh dist it costs one mtime walk, and the only selections
 * it could skip (the globe, the site worker, the design system, Landing) are
 * rare enough that the rule is not worth a dependency-graph query.
 */
export const FRAMEWORK_BUILD_IF_STALE =
  'node scripts/build-workspace-package-if-stale.mjs gps-plus-slam-app-framework GpsPlusSlamJs_AppFramework';

/**
 * The full-cascade fallback: the same build first, then the root cascade.
 * The cascade runs `check:deadcode` (knip, which resolves workspace packages
 * through their `dist`) before any package stage has built the framework.
 *
 * `tierBase` reaches every package's browser tier as `E2E_TIER_BASE`, so
 * a spec the branch changed still runs whole on this, the widest run. It is
 * not `GATE_CHANGED_REF`: that one also cuts a package's run to the changed
 * area, and the cascade runs every package.
 *
 * @param {{ tierBase?: string | null }} [options]
 * @returns {{ command: string, env: Record<string, string> }[]}
 */
export function cascadeCommands({ tierBase = null } = {}) {
  return [
    { command: FRAMEWORK_BUILD_IF_STALE, env: {} },
    { command: 'pnpm test', env: tierBase ? { [TIER_BASE_ENV]: tierBase } : {} },
  ];
}

/**
 * The base a full cascade's browser tier diffs against for the changed
 * specs: an `E2E_TIER_BASE` already set (CI) wins, then the `--ref` the
 * run was given, then the merge-base with the main line (`mergeBase()`,
 * null when it cannot be found). Without `--ref` the gate's own diff base
 * is `HEAD`, which would name only the uncommitted specs, so the branch's
 * base is taken instead.
 *
 * @param {{ env: Record<string, string | undefined>, ref: string | null, mergeBase: () => string | null }} input
 * @returns {string | null}
 */
export function cascadeTierBase({ env, ref, mergeBase }) {
  if (env[TIER_BASE_ENV]) return /** @type {string} */ (env[TIER_BASE_ENV]);
  if (ref) return ref;
  return mergeBase();
}

/**
 * The commands a `test:changed` run executes, in order.
 *
 * Pure so the SPLIT is testable. `selectPackages` above cannot compute the
 * dependent set — it maps changed paths to top-level dirs and nothing more —
 * and the closure comes from pnpm's workspace graph at execution time. So the
 * thing worth asserting is not "which packages are dependents" (pnpm's job,
 * already correct) but "which commands are emitted, with which environment",
 * which is where DEC-G2 either holds or silently does not.
 *
 * Order: the framework build (when anything beyond repo-config and a format
 * runs) BEFORE the repo-config tests, since one of them reads the
 * framework's `dist` when present and must not read a stale one; then the
 * doc-only format stages; then knip (it resolves workspace packages through
 * their `dist`); then the changed packages in full; then their dependents.
 *
 * @param {readonly string[]} names - pnpm names of the DIRECTLY changed packages
 * @param {{
 *   skipBrowserEnv: string,
 *   rootChecks?: readonly string[],
 *   docOnlyNames?: readonly string[],
 *   ref?: string,
 *   relatedUnitEnv?: string,
 *   dependentTrimEnv?: string,
 * }} options - `skipBrowserEnv` names the env var that puts a gate run in
 *   dependent mode; `rootChecks` are root scripts to run (`check:deadcode`);
 *   `docOnlyNames` are pnpm names of packages that run only `format`;
 *   `ref` is the diff base, handed to the changed packages' full gates as
 *   CHANGED_REF_ENV (never to the dependents, which run no browser stage);
 *   `relatedUnitEnv`, passed by the per-commit fast gate only, names the env
 *   var that hands the same ref to the changed packages' unit stages, which
 *   then run only the tests related to the change (related-unit.mjs); the
 *   dependents get it cleared, so they always run their whole suite;
 *   `dependentTrimEnv`, also fast-gate only, is set to '1' for the dependents
 *   (which then skip the checks that read only their own files, projects.mjs
 *   DEPENDENT_TRIM_STAGES) and cleared for the changed packages
 * @returns {{ command: string, env: Record<string, string> }[]}
 */
export function gateCommands(
  names,
  { skipBrowserEnv, rootChecks = [], docOnlyNames = [], ref, relatedUnitEnv, dependentTrimEnv }
) {
  /** @type {{ command: string, env: Record<string, string> }[]} */
  const commands = [];
  // The framework's dist BEFORE anything that reads it, see FRAMEWORK_BUILD_IF_STALE.
  if (names.length > 0 || rootChecks.length > 0) {
    commands.push({ command: FRAMEWORK_BUILD_IF_STALE, env: {} });
  }
  commands.push({ command: 'pnpm run test:repo-config', env: {} });
  // A package whose only change is doc markdown runs its own `format` stage
  // and nothing else: exactly the formatting its full gate would have given
  // those files. `--if-present`: a package without one is a no-op, not a red.
  if (docOnlyNames.length > 0) {
    commands.push({
      command: `pnpm --workspace-concurrency=1 ${docOnlyNames.map((n) => `--filter ${n}`).join(' ')} run --if-present format`,
      env: {},
    });
  }
  for (const check of rootChecks) {
    commands.push({ command: `pnpm run ${check}`, env: {} });
  }
  if (names.length === 0) {
    return commands;
  }
  const filters = (/** @type {(name: string) => string} */ shape) =>
    names.map(shape).join(' ');

  // Changed packages FIRST and in FULL — e2e included. Fail fast on what was
  // actually edited.
  commands.push({
    command: `pnpm --workspace-concurrency=1 ${filters((n) => `--filter ${n}`)} test`,
    env: {
      ...(ref ? { [CHANGED_REF_ENV]: ref } : {}),
      ...(ref && relatedUnitEnv ? { [relatedUnitEnv]: ref } : {}),
      // Cleared, so an inherited value can never trim a changed package.
      ...(dependentTrimEnv ? { [dependentTrimEnv]: '' } : {}),
    },
  });
  // Then dependents, WITHOUT the browser stages. `...X` is X plus dependents;
  // `!X` subtracts the ones that just ran in full. An empty result is a safe
  // no-op: pnpm prints "No projects matched the filters" and exits 0.
  commands.push({
    command: `pnpm --workspace-concurrency=1 ${[
      filters((n) => `--filter "...${n}"`),
      filters((n) => `--filter "!${n}"`),
    ].join(' ')} test`,
    env: {
      [skipBrowserEnv]: '1',
      ...(relatedUnitEnv ? { [relatedUnitEnv]: '' } : {}),
      ...(dependentTrimEnv ? { [dependentTrimEnv]: '1' } : {}),
    },
  });
  return commands;
}

/**
 * One line naming what a package-mode run saw and EVERYTHING it runs. A run
 * that covers less than the full gate says so, in one place.
 *
 * @param {Extract<Selection, { mode: 'packages' }>} selection
 * @param {string} ref
 * @returns {string}
 */
export function describeRun(selection, ref) {
  const rootFiles = selection.rootFiles ?? [];
  const rootChecks = selection.rootChecks ?? [];
  const docsOnly = selection.docsOnly ?? [];
  const docDirs = docOnlyDirs(docsOnly);
  const { packages } = selection;

  /** @type {string[]} */
  const seen = [];
  if (packages.length > 0) seen.push(`changed ${packages.join(', ')}`);
  if (rootFiles.length > 0) {
    const shown = rootFiles.slice(0, 3).join(', ');
    seen.push(`root files (${rootFiles.length}): ${shown}${rootFiles.length > 3 ? ', ...' : ''}`);
  }
  if (docsOnly.length > 0) {
    seen.push(`doc-only markdown in ${docDirs.join(', ')} (${docsOnly.length} file${docsOnly.length === 1 ? '' : 's'})`);
  }

  /** @type {string[]} */
  const runs = [];
  if (packages.length > 0 || rootChecks.length > 0) runs.push('the framework build if stale');
  runs.push('test:repo-config');
  if (docDirs.length > 0) runs.push(`format in ${docDirs.join(', ')}`);
  runs.push(...rootChecks);
  if (packages.length > 0) {
    runs.push(
      packages.length === 1
        ? `the full gate of ${packages[0]}, then its dependents without browser stages`
        : `the full gates of ${packages.join(', ')}, then their dependents without browser stages`
    );
  }
  return `test-changed: vs ${ref} - ${seen.length > 0 ? seen.join('; ') : 'no package changes'} => runs: ${runs.join(', ')}`;
}
