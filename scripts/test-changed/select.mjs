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
  return { mode: 'packages', packages: [...selected].sort() };
}
