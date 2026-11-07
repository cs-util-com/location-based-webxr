// Which dependent packages the per-commit fast gate runs: the ones the
// cross-package import graph (impact-graph.mjs) reaches beyond the changed
// packages, instead of pnpm's whole dependent closure. A test-only change
// reaches none. When the graph cannot be built, every dependent runs.

import { changedFiles } from './changed-paths.mjs';
import { impactOf } from './impact-graph.mjs';
import { loadImpactGraph } from './workspace-tree.mjs';

/**
 * @param {object} input
 * @param {string} input.root - the workspace root
 * @param {string} input.ref - the gate's diff base
 * @param {readonly string[]} input.changedDirs - the package dirs the gate runs in full
 * @returns {{ dirs: string[] | undefined, line: string }} `dirs`: the reached
 *   package dirs beyond `changedDirs` (sorted), or undefined for "every
 *   dependent"; `line`: the one log line that says which
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
    line:
      dirs.length === 0
        ? 'test-changed: the import graph reaches no other package, so no dependent runs'
        : `test-changed: the import graph reaches ${dirs.join(', ')} (${tests} unit test file(s)${wholeSuite}); other dependents run nothing`,
  };
}
