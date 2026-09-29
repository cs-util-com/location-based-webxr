/**
 * The build half of an app's build stamp: the Vite `define` block that
 * injects the five constants `src/utils/build-info.ts` reads.
 *
 * Node-only and build-time: an app's `vite.config.ts` imports it by path
 * (the framework's published `dist` carries browser code only, and this file
 * reads git and the file system). One copy for every app that stamps its
 * recordings (DEC-H3): the Recorder and the Tour Viewer.
 *
 * @see build-metadata-define.mjs.md
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The `version` of the package.json at `path`.
 *
 * @param {string} path
 * @returns {string}
 */
function readVersion(path) {
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  const version =
    typeof parsed === 'object' && parsed !== null
      ? /** @type {{ version?: unknown }} */ (parsed).version
      : undefined;
  if (typeof version !== 'string') {
    throw new Error(
      `Package JSON at ${path} does not contain a string version.`
    );
  }
  return version;
}

/**
 * An installed package's version, as the app resolves it. Read from the
 * package's own package.json, because `require.resolve('<pkg>/package.json')`
 * fails for a package whose `exports` field does not list it. The library is
 * reached through the framework's nested `node_modules/` under pnpm, hence
 * the second place.
 *
 * @param {string} appDir the app's package directory
 * @param {string} pkgName
 * @returns {string}
 */
export function readInstalledPackageVersion(appDir, pkgName) {
  const candidates = [
    join(appDir, 'node_modules', pkgName, 'package.json'),
    join(
      appDir,
      'node_modules',
      'gps-plus-slam-app-framework',
      'node_modules',
      pkgName,
      'package.json'
    ),
  ];
  /** @type {unknown} */
  let lastErr;
  for (const candidate of candidates) {
    try {
      return readVersion(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Could not locate package.json for ${pkgName} in any expected node_modules location. Last error: ${String(lastErr)}`
  );
}

/**
 * The short commit hash, or "dev" where git is not available.
 *
 * @returns {string}
 */
function gitCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

/**
 * The Vite `define` block for an app's build stamp.
 *
 * Each constant is defined twice: bare, and as `globalThis.__NAME__`, the
 * expression the reader uses (Vite replaces that text in a build, and its
 * dev client assigns the property from the same block).
 *
 * @param {string} appDir the app's package directory (holds its package.json)
 * @param {{ commitHash?: () => string, now?: () => Date }} [deps] test seams
 * @returns {Record<string, string>}
 */
export function createBuildMetadataDefine(appDir, deps = {}) {
  const values = {
    __BUILD_COMMIT__: (deps.commitHash ?? gitCommitHash)(),
    __BUILD_TIME__: (deps.now ?? (() => new Date()))().toISOString(),
    __APP_VERSION__: readVersion(join(appDir, 'package.json')),
    __LIB_VERSION__: readInstalledPackageVersion(appDir, 'gps-plus-slam-js'),
    __FW_VERSION__: readInstalledPackageVersion(
      appDir,
      'gps-plus-slam-app-framework'
    ),
  };
  /** @type {Record<string, string>} */
  const define = {};
  for (const [name, value] of Object.entries(values)) {
    define[name] = JSON.stringify(value);
    define[`globalThis.${name}`] = JSON.stringify(value);
  }
  return define;
}
