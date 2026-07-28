// NOTE: deliberately no `#!/usr/bin/env node` shebang — this file is only ever
// invoked as `node scripts/build-workspace-package-if-stale.mjs <pkg> <dir>`,
// and a shebang makes Vitest's transform fail to parse it when the colocated
// test imports it ("SyntaxError: Invalid or unexpected token", zero tests
// collected).
//
// Builds a workspace LIBRARY package's dist/ unless it is already newer than
// every input (speedup plan Phase C.2). Consumers resolve that library through
// its `exports`, i.e. through dist — so any consumer stage that runs before
// dist exists fails, and `tsc` fails the loudest: "Cannot find module 'X' or
// its corresponding type declarations", followed by a cascade of implicit-any
// errors that read like the consumer's own bug.
//
// WHY IT IS PARAMETERISED. It was framework-only, and the workspace has two
// such libraries: `gps-plus-slam-app-framework` and `gps-plus-slam-osm`. The
// framework survived without a guaranteed build because RecorderApp maps it to
// SOURCE via tsconfig `paths` and its `build:framework` stage happens to run
// before the other consumers in the cascade. The OSM package has neither, so
// nothing in the gate or in `build-site.mjs` ever built it — which broke the
// Cloudflare deployment of /osm/ while every local run passed on a stale dist
// left behind by an earlier e2e run.
//
// The consumers are deliberately NOT given `paths` mappings to source instead:
// OsmDemo exists to prove the OSM package's public surface works from outside
// it, and a source mapping would typecheck straight past a missing or wrong
// entry in the export map.
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
  // Defaults keep the historical framework-only invocation working, so a stray
  // `node scripts/build-workspace-package-if-stale.mjs` still does the obvious
  // thing rather than failing on a missing argument.
  const packageName = process.argv[2] ?? 'gps-plus-slam-app-framework';
  const dirName = process.argv[3] ?? 'GpsPlusSlamJs_AppFramework';
  const packageDir = path.join(WORKSPACE_ROOT, dirName);
  const label = `build-if-stale(${packageName})`;

  /** @type {boolean} */
  let buildRequired = true;
  /** @type {string} */
  let reason = 'fail-open default';
  try {
    const newestInput = extremeMtime(
      [
        path.join(packageDir, 'src'),
        path.join(packageDir, 'config'),
        path.join(packageDir, 'package.json'),
      ],
      'newest'
    );
    const oldestOutput = extremeMtime([path.join(packageDir, 'dist')], 'oldest');
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
    console.log(`${label}: skipping build — ${reason}`);
    process.exit(0);
  }
  console.log(`${label}: building — ${reason}`);
  const child = spawnSync(`pnpm --filter ${packageName} run build`, {
    shell: true,
    stdio: 'inherit',
    cwd: WORKSPACE_ROOT,
  });
  process.exit(child.status ?? 1);
}
