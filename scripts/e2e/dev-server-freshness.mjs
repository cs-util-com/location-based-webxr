// Refusing to run an e2e suite against a dev server that predates the last
// build of a linked workspace library.
//
// THE INCIDENT THIS EXISTS FOR (2026-08-16). `GpsPlusSlamJs_OsmDemo`'s suite
// went red at 45 of 56, every failure identical: the app never booted, so
// `#status` never left `starting…`. The change under test was blamed, two
// hypotheses were chased and both were wrong, and the branch was published
// carrying `[KNOWN RED]` in its commit subject.
//
// The code was fine. A `vite` dev server started at 10:44 was still listening
// at 22:40; `GpsPlusSlamJs_Osm/dist` had been rebuilt at 19:45. Consumers
// resolve that package through its BUILT output, whose chunk filenames carry a
// content hash — so the rebuild renamed `mesh-CZafImwM.js` to
// `mesh-BLZDYwaf.js`, while the 10:44 server's module graph went on rewriting
// imports to the old name. One 404, no boot, 45 timeouts. Playwright had reused
// that server because `reuseExistingServer: !process.env.CI` asks only "does
// the URL respond".
//
// TWO STEPS, AND THE FIRST IS THE ONE THAT COVERS THE COMMON CASE:
//
//  1. **Rebuild each linked library if its dist is stale.** Reuse means
//     Playwright never runs the `dev` script, so `build:deps` never executes: a
//     developer who edits the library and runs e2e against an already-open
//     `pnpm dev` would otherwise silently assert the PREVIOUS build. This step
//     is what makes that impossible, and it delegates to the existing,
//     unit-tested `build-workspace-package-if-stale.mjs` rather than
//     re-deciding staleness here.
//  2. **Then ask the running server whether it can still resolve that library.**
//     Fetch the library's entry modules through the server and check that every
//     `/@fs/…` specifier it hands back still exists on disk. A rebuild in step 1
//     is exactly what makes a reused server fail this — which is the point.
//
// WHAT IT DOES NOT CATCH, stated so nobody reads it as complete: a library whose
// output filenames are STABLE across rebuilds goes stale without any file
// disappearing, and this passes. Today's libraries are `tsdown`-built with
// hashed chunk names, which is a property of their build config and not a
// guarantee.
//
// FAIL OPEN ON AMBIGUITY, LOUDLY. A false positive here blocks every e2e run in
// the workspace, which is worse than the bug it prevents — so anything
// unexpected (unreadable manifest, no server, no `/@fs/` specifiers) warns and
// allows. Only an unambiguous miss — a file under a linked library's own dist
// directory that the server still references and that is not there — throws.
//
// @see dev-server-freshness.mjs.md

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Opt-out for the case this guard gets something wrong in the field. */
export const BYPASS_ENV = 'E2E_SKIP_FRESHNESS';

/**
 * Every file path a vite dev server referenced in a module it served.
 *
 * Derived from the REAL transformed text of
 * `GpsPlusSlamJs_Osm/dist/index.js` as vite serves it, captured 2026-08-16 —
 * vite rewrites each relative import into an absolute `/@fs/…` specifier and
 * leaves it inside an ordinary `import … from "…"` / `import "…"` statement.
 *
 * MATCHED INSIDE QUOTES ONLY, never as bare text. A loose scan would also hit
 * sourcemap comments, `import.meta.url` rewrites and ordinary string literals,
 * and a single such hit that happens not to exist on disk would block the run.
 *
 * @param {string} servedText
 * @returns {string[]} absolute file paths, de-duplicated, query strings removed
 */
export function extractFsSpecifiers(servedText) {
  const found = new Set();
  // `"/@fs/…"` or `'/@fs/…'` — the quote characters are what bound the match,
  // so no unquoted occurrence can be picked up.
  const pattern = /["']((?:\/@fs\/)[^"']+)["']/g;
  let match;
  while ((match = pattern.exec(servedText)) !== null) {
    const filePath = fsUrlToPath(match[1]);
    if (filePath !== undefined) found.add(filePath);
  }
  return [...found];
}

/**
 * `/@fs/C:/gps/x/y.js?t=123` → `C:/gps/x/y.js`; `/@fs/home/x/y.js` → `/home/x/y.js`.
 *
 * The Windows form carries the drive letter directly after the prefix, so
 * stripping `/@fs` alone leaves a spurious leading slash (`/C:/…`) that no
 * filesystem call accepts.
 *
 * @param {string} specifier
 * @returns {string | undefined}
 */
export function fsUrlToPath(specifier) {
  if (!specifier.startsWith('/@fs/')) return undefined;
  let rest = specifier.slice('/@fs'.length);
  // Query (`?t=`, `?v=`, `?import`) and hash are vite bookkeeping, not the file.
  rest = rest.split('?')[0].split('#')[0];
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // A malformed escape is not worth failing a whole run over.
    return undefined;
  }
  if (/^\/[A-Za-z]:/.test(rest)) rest = rest.slice(1);
  return rest.length > 0 ? rest : undefined;
}

/**
 * The workspace libraries a package consumes through a pnpm link.
 *
 * A workspace link is a symlink in `node_modules` whose real path lands OUTSIDE
 * `node_modules`; everything installed from the registry resolves into
 * `node_modules/.pnpm/…` and is filtered out by exactly that test.
 *
 * @param {string} packageDir
 * @returns {{ name: string, dir: string, entries: string[] }[]}
 */
export function linkedWorkspaceDeps(packageDir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const names = Object.keys(manifest.dependencies ?? {});
  /** @type {{ name: string, dir: string, entries: string[] }[]} */
  const linked = [];
  for (const name of names) {
    const linkPath = path.join(packageDir, 'node_modules', ...name.split('/'));
    let real;
    try {
      if (!lstatSync(linkPath).isSymbolicLink()) continue;
      real = realpathSync(linkPath);
    } catch {
      continue;
    }
    if (real.split(path.sep).includes('node_modules')) continue;
    linked.push({ name, dir: real, entries: entryFilesOf(real) });
  }
  return linked;
}

/**
 * Every file a package's `exports` map points at, plus `main` as a fallback.
 *
 * ALL SUBPATHS, not just `"."`. The demo imports `gps-plus-slam-osm/mesh`,
 * `/elevation/egm96` and ~30 other subpaths directly, and a chunk reachable only
 * from one of those would be invisible to a probe that read `"."` alone.
 *
 * The STRING SHORTHAND is handled first and is not an edge case — it is what
 * both libraries in this workspace actually use (`".": "./dist/index.js"`, no
 * `main` key at all). A conditions-object-only reader resolves nothing for them
 * and the whole guard silently becomes a no-op.
 *
 * @param {string} packageRealDir
 * @returns {string[]} absolute paths that exist
 */
export function entryFilesOf(packageRealDir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(packageRealDir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const relatives = new Set();
  collectExportTargets(manifest.exports, relatives);
  if (typeof manifest.main === 'string') relatives.add(manifest.main);
  const absolute = [];
  for (const relative of relatives) {
    if (!relative.startsWith('.')) continue;
    const full = path.resolve(packageRealDir, relative);
    if (existsSync(full)) absolute.push(full);
  }
  return absolute;
}

/**
 * Walk an `exports` value of any shape — string, subpath map, or conditions
 * object, nested arbitrarily — and collect every relative target.
 *
 * @param {unknown} node
 * @param {Set<string>} into
 */
function collectExportTargets(node, into) {
  if (typeof node === 'string') {
    into.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectExportTargets(child, into);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const child of Object.values(node)) collectExportTargets(child, into);
  }
}

/**
 * The pure core: which of a served module's references have gone missing.
 *
 * SCOPED TO THE LINKED LIBRARIES' OWN DIRECTORIES. Only a path under one of
 * them can be judged here — a reference to anything else (the app's own source,
 * a registry package, a virtual module) may legitimately not exist as a file,
 * and treating that as staleness is how this guard would block every run in the
 * workspace at once.
 *
 * @param {object} args
 * @param {string} args.servedText
 * @param {string[]} args.libraryDirs absolute directories of linked libraries
 * @param {(file: string) => boolean} [args.exists] injectable for tests
 * @returns {string[]} missing absolute paths
 */
export function findMissingModules({ servedText, libraryDirs, exists = existsSync }) {
  const normalisedDirs = libraryDirs.map((dir) => normalise(dir));
  const missing = [];
  for (const file of extractFsSpecifiers(servedText)) {
    const normalisedFile = normalise(file);
    const inLibrary = normalisedDirs.some((dir) => normalisedFile.startsWith(dir + '/'));
    if (!inLibrary) continue;
    if (!exists(file)) missing.push(file);
  }
  return missing;
}

/**
 * Case- and separator-insensitive form for prefix comparison.
 *
 * Windows serves `C:/gps/…` in the URL while `realpathSync` may return
 * `C:\gps\…` with a different drive-letter case; comparing those raw finds no
 * match and the guard quietly checks nothing.
 *
 * @param {string} p
 */
function normalise(p) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Rebuild any linked library whose dist is older than its sources.
 *
 * Delegates to the existing helper, which owns the staleness rule and fails
 * open. Errors here are reported and swallowed: a failed rebuild will surface as
 * a normal test failure with a real message, and must not masquerade as a
 * freshness verdict.
 *
 * NO RETURN VALUE, deliberately. An earlier version reported "did a build run",
 * inferred from the helper's stdout — but its no-op message is "skipping build …",
 * which contains the word, so the answer was always yes. Nothing needed it, and a
 * signal that is always true is worse than none.
 *
 * @param {{ name: string, dir: string }[]} deps
 * @param {(message: string) => void} log
 */
function rebuildStaleLibraries(deps, log) {
  for (const dep of deps) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(WORKSPACE_ROOT, 'scripts', 'build-workspace-package-if-stale.mjs'),
        dep.name,
        path.basename(dep.dir),
      ],
      { cwd: WORKSPACE_ROOT, encoding: 'utf8' }
    );
    if (result.status !== 0) {
      log(`freshness: could not check ${dep.name} (exit ${result.status}) — continuing`);
    }
  }
}

/**
 * Guard entry point, wired as Playwright's `globalSetup`.
 *
 * @param {object} args
 * @param {string} args.baseUrl e.g. `http://127.0.0.1:5186`
 * @param {string} args.packageDir the consuming package's directory
 * @param {typeof fetch} [args.fetchImpl]
 * @param {(message: string) => void} [args.log]
 * @returns {Promise<{ checked: boolean, reason?: string, missing?: string[] }>}
 */
export async function assertDevServerFresh({
  baseUrl,
  packageDir,
  fetchImpl = fetch,
  log = console.warn,
}) {
  if (process.env[BYPASS_ENV] === '1') {
    log(`freshness: skipped via ${BYPASS_ENV}=1`);
    return { checked: false, reason: 'bypassed' };
  }
  if (!baseUrl) {
    log('freshness: no dev-server URL in the Playwright config — skipped');
    return { checked: false, reason: 'no-url' };
  }

  const deps = linkedWorkspaceDeps(packageDir);
  if (deps.length === 0) return { checked: false, reason: 'no-linked-libraries' };

  for (const dep of deps) {
    if (dep.entries.length === 0) {
      // LOUD, because this is exactly how the guard dies quietly: a manifest
      // shape we do not read leaves nothing to probe and the run looks clean.
      log(
        `freshness: resolved NO entry files for linked library ${dep.name} (${dep.dir}) — ` +
          'the staleness check cannot see it. Fix entryFilesOf.'
      );
    }
  }

  rebuildStaleLibraries(deps, log);

  const libraryDirs = deps.map((dep) => dep.dir);
  const root = baseUrl.replace(/\/+$/, '');
  /** @type {string[]} */
  const missing = [];
  let probed = 0;

  for (const dep of deps) {
    for (const entry of dep.entries) {
      const url = `${root}/@fs/${entry.replace(/\\/g, '/')}`;
      let text;
      try {
        const response = await fetchImpl(url);
        // A non-200 here means the server is not vite, or does not serve this
        // path — not that anything is stale.
        if (!response.ok) continue;
        text = await response.text();
      } catch (error) {
        // Nothing listening: Playwright will start its own server. Reported
        // rather than silent, because at globalSetup time the webServer has
        // already been launched, so a refusal means it wedged.
        log(`freshness: could not reach ${url} (${String(error)}) — skipped`);
        return { checked: false, reason: 'unreachable' };
      }
      probed += 1;
      missing.push(...findMissingModules({ servedText: text, libraryDirs }));
    }
  }

  if (probed === 0) return { checked: false, reason: 'nothing-probed' };
  if (missing.length === 0) return { checked: true };

  const unique = [...new Set(missing)];
  throw new Error(
    [
      `A dev server on ${root} is serving a build of a linked workspace library that no longer exists on disk.`,
      '',
      'It was started before that library was last built, so its module graph still',
      'points at content-hashed files that the rebuild renamed. Every test that waits',
      'for the app to boot will time out, and the cause looks like a code defect.',
      '',
      `Missing (${unique.length}):`,
      ...unique.slice(0, 10).map((file) => `  ${file}`),
      ...(unique.length > 10 ? [`  …and ${unique.length - 10} more`] : []),
      '',
      `FIX: stop whatever is listening on ${root} (a leftover \`pnpm dev\`, or a`,
      'dev server left behind by an interrupted test run) and run the suite again.',
      `To run anyway, set ${BYPASS_ENV}=1.`,
    ].join('\n')
  );
}

/**
 * Read the dev-server URL out of a Playwright `FullConfig`.
 *
 * `webServer.url` is the authoritative one — it is what `reuseExistingServer`
 * itself probes. `baseURL` is the fallback for a config that points tests at a
 * server it does not manage.
 *
 * @param {any} config
 * @returns {string | undefined}
 */
export function devServerUrlOf(config) {
  const servers = Array.isArray(config?.webServer) ? config.webServer : [config?.webServer];
  for (const server of servers) {
    if (typeof server?.url === 'string') return server.url;
  }
  for (const project of config?.projects ?? []) {
    if (typeof project?.use?.baseURL === 'string') return project.use.baseURL;
  }
  return undefined;
}
