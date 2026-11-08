// Which dependent packages the per-commit fast gate runs: the ones the
// cross-package import graph (impact-graph.mjs) reaches beyond the changed
// packages, instead of pnpm's whole dependent closure. A test-only change
// reaches none. When the graph cannot be built, every dependent runs.
//
// The graph is built once per gate run: the reached set is written to a
// cache file (IMPACT_FILE_ENV names it) that each package's unit stage
// (related-unit.mjs) reads instead of rebuilding the graph itself.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { changedFiles } from './changed-paths.mjs';
import { impactOf } from './impact-graph.mjs';
import { loadImpactGraph } from './workspace-tree.mjs';

/** Env var with the path of the gate run's impact cache (writeImpactCache). */
export const IMPACT_FILE_ENV = 'GATE_IMPACT_FILE';

/** @typedef {ReturnType<typeof impactOf>} Impact */

/**
 * @param {object} input
 * @param {string} input.root - the workspace root
 * @param {string} input.ref - the gate's diff base
 * @param {readonly string[]} input.changedDirs - the package dirs the gate runs in full
 * @returns {{ dirs: string[] | undefined, line: string, impact?: Impact }}
 *   `dirs`: the reached package dirs beyond `changedDirs` (sorted), or
 *   undefined for "every dependent"; `line`: the one log line that says
 *   which; `impact`: the whole reached set, when the graph was built
 */
export function graphDependents({ root, ref, changedDirs }) {
  let impact;
  try {
    impact = impactOf(loadImpactGraph(root), changedFiles(ref, root));
  } catch (error) {
    const first = String(error).split('\n')[0];
    return { dirs: undefined, line: `test-changed: the import graph could not be built (${first}), so every dependent runs` };
  }
  const dirs = impact.packages.filter((d) => !changedDirs.includes(d));
  const tests = impact.tests.filter((t) => dirs.includes(t.split('/')[0])).length;
  const full = impact.fullSuite.filter((f) => dirs.includes(f.dir)).map((f) => f.dir);
  const wholeSuite = full.length > 0 ? `; whole suite in ${full.join(', ')}` : '';
  return {
    dirs,
    impact,
    line:
      dirs.length === 0
        ? 'test-changed: the import graph reaches no other package, so no dependent runs'
        : `test-changed: the import graph reaches ${dirs.join(', ')} (${tests} unit test file(s)${wholeSuite}); other dependents run nothing`,
  };
}

/** The same root, whatever its slash style or case on Windows. */
const sameRoot = (/** @type {string} */ a, /** @type {string} */ b) =>
  path.resolve(a).replaceAll('\\', '/').toLowerCase() === path.resolve(b).replaceAll('\\', '/').toLowerCase();

/**
 * @param {string} file
 * @param {{ ref: string, root: string, impact: Impact }} entry
 */
export function writeImpactCache(file, { ref, root, impact }) {
  writeFileSync(file, JSON.stringify({ ref, root, impact }));
}

/**
 * @param {string} file
 * @param {{ ref: string, root: string }} expected - the reader's own ref and root
 * @returns {Impact | null} the cached impact, or null when the file is missing,
 *   unreadable, malformed, or written for another ref or root
 */
export function readImpactCache(file, { ref, root }) {
  try {
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    const impact = entry?.impact;
    if (entry?.ref !== ref || typeof entry?.root !== 'string' || !sameRoot(entry.root, root)) return null;
    if (!Array.isArray(impact?.tests) || !Array.isArray(impact?.packages) || !Array.isArray(impact?.fullSuite)) return null;
    return impact;
  } catch {
    return null;
  }
}
