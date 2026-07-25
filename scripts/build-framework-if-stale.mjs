#!/usr/bin/env node
// Skips the framework build when its dist/ is already newer than every
// framework input (speedup plan Phase C.2). The full cascade builds the
// framework up to six times — once per consumer package's build:framework
// stage — although the first build already produced a fresh dist; the
// consumers after it can skip.
//
// FAIL OPEN: any doubt (missing dist, unreadable dirs, mtime anomalies,
// walker errors) ⇒ build. A wasted build costs ~4 s; a stale dist makes e2e
// tests fail confusingly (documented footgun: "consumers resolve through
// built dist"). Staleness rule: newest input mtime >= oldest output mtime ⇒
// rebuild — partial/interrupted build outputs therefore always rebuild.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FRAMEWORK_DIR = path.join(WORKSPACE_ROOT, 'GpsPlusSlamJs_AppFramework');

/**
 * Pure staleness decision — kept separate for unit tests.
 *
 * @param {number | null} newestInputMs - newest input file mtime (ms), null
 *   when inputs could not be determined
 * @param {number | null} oldestOutputMs - oldest dist file mtime (ms), null
 *   when dist is missing/empty/unreadable
 * @returns {boolean} true = build required
 */
export function isBuildRequired(newestInputMs, oldestOutputMs) {
  if (newestInputMs === null || oldestOutputMs === null) {
    return true;
  }
  return newestInputMs >= oldestOutputMs;
}

/**
 * @param {string} dir
 * @param {(mtimeMs: number) => void} onFile
 */
function walk(dir, onFile) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, onFile);
    } else if (entry.isFile()) {
      onFile(statSync(full).mtimeMs);
    }
  }
}

/**
 * @param {readonly string[]} roots - absolute files or directories
 * @param {'newest' | 'oldest'} pick
 * @returns {number | null} extreme mtime in ms, or null when nothing found
 */
function extremeMtime(roots, pick) {
  /** @type {number | null} */
  let result = null;
  for (const root of roots) {
    /** @type {(m: number) => void} */
    const consider = (mtimeMs) => {
      if (
        result === null ||
        (pick === 'newest' ? mtimeMs > result : mtimeMs < result)
      ) {
        result = mtimeMs;
      }
    };
    const stats = statSync(root, { throwIfNoEntry: false });
    if (!stats) {
      continue;
    }
    if (stats.isDirectory()) {
      walk(root, consider);
    } else {
      consider(stats.mtimeMs);
    }
  }
  return result;
}

// Execute only when run directly, not when imported by the unit test.
// pathToFileURL keeps this correct on Windows (same pattern as the other
// root scripts).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  /** @type {boolean} */
  let buildRequired = true;
  /** @type {string} */
  let reason = 'fail-open default';
  try {
    const newestInput = extremeMtime(
      [
        path.join(FRAMEWORK_DIR, 'src'),
        path.join(FRAMEWORK_DIR, 'config'),
        path.join(FRAMEWORK_DIR, 'package.json'),
      ],
      'newest'
    );
    const oldestOutput = extremeMtime([path.join(FRAMEWORK_DIR, 'dist')], 'oldest');
    buildRequired = isBuildRequired(newestInput, oldestOutput);
    reason = buildRequired
      ? oldestOutput === null
        ? 'dist missing or empty'
        : 'inputs newer than dist'
      : 'dist newer than every input';
  } catch (error) {
    buildRequired = true;
    reason = `staleness check failed (${String(error)})`;
  }

  if (!buildRequired) {
    console.log(`build-framework-if-stale: skipping build — ${reason}`);
    process.exit(0);
  }
  console.log(`build-framework-if-stale: building — ${reason}`);
  const child = spawnSync('pnpm --filter gps-plus-slam-app-framework run build', {
    shell: true,
    stdio: 'inherit',
    cwd: WORKSPACE_ROOT,
  });
  process.exit(child.status ?? 1);
}
