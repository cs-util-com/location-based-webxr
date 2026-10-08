// Pure decision logic for the dependency-aware iteration gate
// (`pnpm run test:changed`): maps a set of changed repo paths to either
// "run the full cascade" or "run these packages (plus their dependents)".
// The shell (test-changed.mjs) supplies git's view of the working tree and
// executes the decision; keeping the mapping pure makes the guard rails
// unit- and property-testable.
//
// Guard rails encoded here (speedup plan Phase B.2 — treat as load-bearing):
// - Any change OUTSIDE a workspace package (root package.json, workspace
//   yaml, shared configs, scripts/, tests/, …) ⇒ full cascade: pnpm's
//   dependency graph cannot model what root files affect.
// - Untracked files count as changes (git diff never lists them; the shell
//   passes them separately).
// - Generated docs/test-timings.md files (root or per-package) NEVER count:
//   every full gate rewrites them, so they are near-permanently dirty and
//   would otherwise pin their package (or the whole cascade) as "changed".

/**
 * @typedef {{ mode: 'all', reason: string }
 *   | { mode: 'packages', packages: string[] }} Selection
 */

/**
 * The served-by edge: packages the design system SERVES through its routes
 * (it does not depend on them, so pnpm's graph never selects it). A change
 * in one also selects the design system, in full, since its lab smoke is the
 * served code's only browser check (globe plan 2026-09-26-0539 §8). The
 * framework and OsmDemo are served too but are NOT listed: that would put
 * the design system's ~11 min e2e on every framework commit, an owner
 * decision filed with the W7 M0 record.
 */
const SERVED_BY_DESIGN_SYSTEM = ['GpsPlusSlamJs_Globe'];
const DESIGN_SYSTEM = 'GpsPlusSlamJs_DesignSystem';

/** Matches the generated timings file at the root or in any package dir. */
const GENERATED_TIMINGS_RE = /^(?:[^/]+\/)?docs\/test-timings\.md$/;

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
  for (const rawPath of [...trackedChanges, ...untracked]) {
    const path = normalize(rawPath);
    if (path === '' || GENERATED_TIMINGS_RE.test(path)) {
      continue;
    }
    const topDir = path.split('/')[0];
    if (path.includes('/') && packageDirs.includes(topDir)) {
      selected.add(topDir);
      continue;
    }
    return { mode: 'all', reason: path };
  }
  if (
    packageDirs.includes(DESIGN_SYSTEM) &&
    SERVED_BY_DESIGN_SYSTEM.some((dir) => selected.has(dir))
  ) {
    selected.add(DESIGN_SYSTEM);
  }
  return { mode: 'packages', packages: [...selected].sort() };
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
 * @returns {{ command: string, env: Record<string, string> }[]}
 */
export function cascadeCommands() {
  return [
    { command: FRAMEWORK_BUILD_IF_STALE, env: {} },
    { command: 'pnpm test', env: {} },
  ];
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
 * @param {readonly string[]} names - pnpm names of the DIRECTLY changed packages
 * @param {{ skipBrowserEnv: string }} options - name of the env var that puts a
 *   gate run in dependent mode
 * @returns {{ command: string, env: Record<string, string> }[]}
 */
export function gateCommands(names, { skipBrowserEnv }) {
  /** @type {{ command: string, env: Record<string, string> }[]} */
  const commands = [{ command: 'pnpm run test:repo-config', env: {} }];
  if (names.length === 0) {
    return commands;
  }
  const filters = (/** @type {(name: string) => string} */ shape) =>
    names.map(shape).join(' ');

  // The framework's dist BEFORE any package gate, see FRAMEWORK_BUILD_IF_STALE.
  commands.push({ command: FRAMEWORK_BUILD_IF_STALE, env: {} });

  // Changed packages FIRST and in FULL — e2e included. Fail fast on what was
  // actually edited.
  commands.push({
    command: `pnpm --workspace-concurrency=1 ${filters((n) => `--filter ${n}`)} test`,
    env: {},
  });
  // Then dependents, WITHOUT the browser stages. `...X` is X plus dependents;
  // `!X` subtracts the ones that just ran in full. An empty result is a safe
  // no-op: pnpm prints "No projects matched the filters" and exits 0.
  commands.push({
    command: `pnpm --workspace-concurrency=1 ${[
      filters((n) => `--filter "...${n}"`),
      filters((n) => `--filter "!${n}"`),
    ].join(' ')} test`,
    env: { [skipBrowserEnv]: '1' },
  });
  return commands;
}
