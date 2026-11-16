/**
 * The error service's Vite plugins for the Tour Viewer and the map demo:
 * the page build's instance and the Web Worker builds' instances, created
 * only when SENTRY_AUTH_TOKEN is set.
 *
 * @see sentry-vite-plugins.mjs.md
 */

import { isAbsolute, parse, relative, resolve } from 'node:path';

/** The Sentry organisation and project every app of the site reports to. */
const SENTRY_ORG = 'cs-util-com';
const SENTRY_PROJECT = 'js-gps-recorder';

/**
 * The glob of every source map under a build's output folder: absolute, and
 * with forward slashes, which the plugin's glob library needs on Windows too.
 *
 * @param {string} root the Vite root (`config.root`)
 * @param {string} outDir the build's output folder, absolute or relative to
 *   the root (`config.build.outDir`)
 * @returns {string}
 */
export function sourceMapGlob(root, outDir) {
  return `${resolve(root, outDir).replaceAll('\\', '/')}/**/*.map`;
}

/**
 * Whether a build's output folder is safe to delete source maps under: not
 * the project root, not a folder that holds it, and not a filesystem root.
 * The deletion glob reaches everything below the folder, so any of those
 * would take the checkout's maps (node_modules included) with it.
 *
 * @param {string} root the Vite root (`config.root`)
 * @param {string} outDir the build's output folder, absolute or relative
 * @returns {boolean}
 */
function isSafeOutDir(root, outDir) {
  const dir = resolve(root, outDir);
  const rel = relative(dir, resolve(root));
  const holdsRoot = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  return !holdsRoot && parse(dir).root !== dir;
}

/**
 * The plugins of an app build that uploads its source maps.
 *
 * Without SENTRY_AUTH_TOKEN nothing runs and the build does not fail. With it,
 * the page build's instance gives every bundle a debug id, sets the release,
 * uploads the maps and then deletes them from the output folder, so they are
 * never deployed; the folder is read from the resolved config, because the
 * site build passes its own `--outDir`. Each worker build gets an instance of
 * its own for the worker bundle's debug id; it deletes nothing. A failed
 * upload only warns. No build telemetry is sent to the service.
 *
 * @template P
 * @param {(options: any) => P} createPlugin
 *   `sentryVitePlugin` from `@sentry/vite-plugin` (passed in: the framework
 *   does not depend on the plugin, the apps do)
 * @param {Record<string, string | undefined>} [env] the environment to read
 *   the token from
 * @returns {{
 *   plugins: Array<P | {
 *     name: string,
 *     apply: 'build',
 *     configResolved: (config: { root: string, build: { outDir: string } }) => void,
 *   }>,
 *   workerPlugins: () => P[],
 * }}
 */
export function sentrySourceMapPlugins(createPlugin, env = process.env) {
  if (!env.SENTRY_AUTH_TOKEN) {
    return { plugins: [], workerPlugins: () => [] };
  }
  /** @type {(glob: string | string[]) => void} */
  let settleMapsGlob = () => {};
  /** @type {Promise<string | string[]>} */
  const mapsGlob = new Promise((settle) => {
    settleMapsGlob = settle;
  });
  const shared = {
    org: SENTRY_ORG,
    project: SENTRY_PROJECT,
    telemetry: false,
    errorHandler: (/** @type {Error} */ error) => {
      console.warn('Sentry source-map upload failed:', error.message);
    },
  };
  const outDirProbe = {
    name: 'sentry-source-map-out-dir',
    apply: /** @type {const} */ ('build'),
    /** @param {{ root: string, build: { outDir: string } }} config */
    configResolved(config) {
      const { root, build } = config;
      // An unsafe folder deletes nothing; the site build's check then fails
      // on the maps left behind (scripts/source-maps-deploy.mjs).
      settleMapsGlob(
        isSafeOutDir(root, build.outDir)
          ? sourceMapGlob(root, build.outDir)
          : []
      );
    },
  };
  return {
    plugins: [
      outDirProbe,
      createPlugin({
        ...shared,
        sourcemaps: { filesToDeleteAfterUpload: mapsGlob },
      }),
    ],
    workerPlugins: () => [createPlugin(shared)],
  };
}
