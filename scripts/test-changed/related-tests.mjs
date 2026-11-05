// Pure plan for the per-commit fast gate's unit stage in a CHANGED package:
// which files to hand to `vitest related`, or why the full suite must run
// instead. The shell (related-unit.mjs) gathers git's view of the package and
// the package's test files; keeping the rules pure makes them testable.
//
// What vitest's own module graph sees, and what it does not (spiked against
// vitest 5.0.0 in the Tour Viewer): a changed module selects every test that
// imports it, a changed test file selects itself, and a stylesheet or page
// selects nothing, because no test imports it. So the plan widens the set by
// two kinds of test the graph cannot see:
// - READERS: a test that reads a changed file by name through `fs` (a page's
//   markup, a stylesheet, another module's source text);
// - SCANNERS: a test that walks a whole directory (`readdirSync`,
//   `import.meta.glob`), so any added or changed source can break it.
// Everything else that a test can read without importing it (fixtures,
// golden data, configs, setup files, mocks) falls back to the full suite, as
// does a deleted or renamed file, whose importers the graph no longer knows.

/** Module sources the graph follows. */
const MODULE_RE = /\.(?:[cm]?[jt]sx?)$/;
/** A vitest setup file runs before every test without being imported. */
const SETUP_RE = /(?:^|[-_.])setup\.[cm]?[jt]sx?$/i;
/** A whole-tree scan: any added or changed source can break it. */
const SCANNER_RE = /\breaddirSync\b|\breaddir\(|import\.meta\.glob|\bglobSync\b/;
/** Any `fs` read; a reader also names the file it reads. */
const FS_READ_RE = /\breadFileSync\b|\breadFile\(|\breaddirSync\b|\bcreateReadStream\b/;

/** Above this many changed files the related set is no cheaper than the suite. */
export const DEFAULT_MAX_FILES = 150;

/**
 * @typedef {{ mode: 'full', reason: string }
 *   | { mode: 'related', files: string[] }} RelatedPlan
 * `files` is sorted and deduplicated; empty means no unit test can read the
 * change, so the stage runs no test.
 */

/**
 * @param {object} input
 * @param {readonly string[]} input.changed - package-relative paths that
 *   differ from the gate's ref, untracked ones included
 * @param {readonly string[]} input.deleted - the subset of `changed` that no
 *   longer exists in the work tree
 * @param {readonly { path: string, text: string }[]} input.testFiles - the
 *   package's unit test files (package-relative) and their source text
 * @param {number} [input.maxFiles]
 * @returns {RelatedPlan}
 */
export function planRelatedRun({ changed, deleted, testFiles, maxFiles = DEFAULT_MAX_FILES }) {
  const gone = new Set(deleted.map(normalize));
  const paths = [...new Set(changed.map(normalize))].filter(
    (p) => p !== '' && p !== 'docs/test-timings.md' && !p.toLowerCase().endsWith('.md')
  );
  if (paths.length > maxFiles) {
    return { mode: 'full', reason: `${paths.length} changed files (more than ${maxFiles})` };
  }
  /** @type {Set<string>} */
  const files = new Set();
  let sourceChanged = false;
  for (const p of paths) {
    if (gone.has(p)) return { mode: 'full', reason: `${p} was deleted or renamed` };
    const base = p.split('/').pop() ?? p;
    if (p.includes('__mocks__/') || SETUP_RE.test(base)) {
      return { mode: 'full', reason: `${p} is a setup or mock file every test may load` };
    }
    if (p.startsWith('src/') && MODULE_RE.test(p)) {
      sourceChanged = true;
      files.add(p);
    } else if (/\.(?:css|html)$/i.test(p)) {
      files.add(p);
    } else if (!p.startsWith('playwright-tests/')) {
      return { mode: 'full', reason: `${p} is not a source, style, page or Playwright file` };
    }
  }
  const names = paths.map((p) => p.split('/').pop() ?? p);
  for (const test of testFiles) {
    const path = normalize(test.path);
    const scans = sourceChanged && SCANNER_RE.test(test.text);
    const reads = FS_READ_RE.test(test.text) && names.some((n) => test.text.includes(n));
    if (scans || reads) files.add(path);
  }
  return { mode: 'related', files: [...files].sort() };
}

/**
 * The vitest arguments of the related run, from the stage's full command.
 * `--coverage` is dropped: coverage (and its thresholds) of a slice is
 * meaningless, as for a filtered run.
 *
 * @param {readonly string[]} fullCommand - e.g. `['vitest', 'run', '--config=x']`
 * @param {readonly string[]} files
 * @returns {string[] | null} the arguments after `vitest`, or null when the
 *   command is not a plain `vitest run` (the caller then runs it unchanged)
 */
export function relatedVitestArgs(fullCommand, files) {
  if (fullCommand[0] !== 'vitest' || fullCommand[1] !== 'run') return null;
  const rest = fullCommand.slice(2).filter((arg) => arg !== '--coverage');
  return ['related', '--run', ...rest, ...files];
}

/** @param {string} path @returns {string} */
function normalize(path) {
  return path.replaceAll('\\', '/');
}
