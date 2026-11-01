// @ts-check
/**
 * globe-assets-deploy.mjs - the globe's imagery on the deployed site.
 *
 * The Globe package's surface asks for its imagery by root-absolute paths
 * (`/globe-assets/...`, `GpsPlusSlamJs_Globe/src/globe-sources.ts`). The
 * dev servers answer them from `GpsPlusSlamJs_Globe/assets`; the deployed
 * site needs ONE copy at its root, which every page that loads the globe
 * shares (the Tour Viewer's editor on the globe view and the look-dev
 * labs). `copyGlobeAssets` makes it (the folder's Markdown notes are the
 * repository's, not the site's); `assertGlobeAssetsShipped` fails the build
 * when an app's chunk names the folder and the folder is missing or empty.
 *
 * @see globe-assets-deploy.mjs.md
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** The URL prefix the globe asks for its imagery under. */
export const GLOBE_ASSETS_PREFIX = '/globe-assets/';

/** The folder name of the copy at the site root. */
const GLOBE_ASSETS_DIR = GLOBE_ASSETS_PREFIX.replaceAll('/', '');

/**
 * Every file under `dir`, as paths relative to it with `/` separators;
 * symbolic links skipped. `[]` for a missing folder.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/**
 * Copy the globe's assets from `from` to `to`, every file but the
 * Markdown notes (README, PROVENANCE).
 *
 * @param {{ from: string, to: string }} paths
 * @returns {{ files: number, bytes: number }} what was copied
 * @throws Error when `from` is missing or holds no file to copy (an empty
 *   copy would deploy the same 404s as none).
 */
export function copyGlobeAssets({ from, to }) {
  if (!existsSync(from)) {
    throw new Error(`the globe assets folder ${from} does not exist`);
  }
  const files = filesUnder(from).filter((rel) => !rel.toLowerCase().endsWith('.md'));
  if (files.length === 0) {
    throw new Error(`the globe assets folder ${from} holds no file to deploy`);
  }
  let bytes = 0;
  for (const rel of files) {
    const source = join(from, ...rel.split('/'));
    const target = join(to, ...rel.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    bytes += statSync(source).size;
  }
  return { files: files.length, bytes };
}

/**
 * The JavaScript files under `dir` whose text holds `needle`, relative to
 * `dir` with `/` separators, sorted.
 *
 * @param {string} dir
 * @param {string} needle
 * @returns {string[]}
 */
export function chunksNaming(dir, needle) {
  return filesUnder(dir)
    .filter((rel) => /\.(?:m?js)$/.test(rel))
    .filter((rel) => readFileSync(join(dir, ...rel.split('/')), 'utf-8').includes(needle))
    .sort();
}

/**
 * Fail when any app's chunk names `/globe-assets/` while the site root
 * has no such folder with at least one file in it.
 *
 * @param {{ siteDir: string, appDirs: readonly string[] }} where
 * @returns {string[]} the chunks that name the folder (relative to their
 *   app's folder), for the build's log
 * @throws Error naming the chunks when the folder is missing or empty.
 */
export function assertGlobeAssetsShipped({ siteDir, appDirs }) {
  const naming = appDirs.flatMap((dir) => chunksNaming(dir, GLOBE_ASSETS_PREFIX));
  if (naming.length === 0) return [];
  const copy = join(siteDir, GLOBE_ASSETS_DIR);
  if (filesUnder(copy).length === 0) {
    throw new Error(
      `${naming.join(', ')} name ${GLOBE_ASSETS_PREFIX}, but ${copy} is ` +
        `missing or empty: the deployed globe would load no imagery. Copy ` +
        `the Globe's assets there (copyGlobeAssets) before this check.`
    );
  }
  return naming;
}
