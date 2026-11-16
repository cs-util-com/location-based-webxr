// @ts-check
/**
 * The site build's check that the apps which upload their source maps to the
 * error service deploy none of them.
 *
 * @see source-maps-deploy.mjs.md
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The `dist-site` folders of the apps whose builds upload their source maps
 * and then delete them (the Recorder, the Tour Viewer and the map demo,
 * through `GpsPlusSlamJs_AppFramework/scripts/sentry-vite-plugins.mjs`).
 * `tests/repo-config/source-map-free-apps.test.js` ties it to the Vite
 * configs that use that helper.
 */
export const SOURCE_MAP_FREE_APPS = /** @type {const} */ ([
  'recorder',
  'tour',
  'osm',
]);

/**
 * Throws when SENTRY_AUTH_TOKEN is set and a `*.map` file is left at any depth
 * under one of {@link SOURCE_MAP_FREE_APPS}, naming every such file, or when
 * one of those folders is missing (a check of nothing must not pass). Without
 * the token nothing was uploaded or deleted, the maps are wanted, and it
 * returns at once.
 *
 * @param {{ siteDir: string, env?: Record<string, string | undefined> }} options
 *   `siteDir` is the combined deploy folder (`dist-site`)
 */
export function assertNoSourceMapsDeployed({ siteDir, env = process.env }) {
  if (!env.SENTRY_AUTH_TOKEN) return;
  /** @type {string[]} */
  const left = [];
  for (const app of SOURCE_MAP_FREE_APPS) {
    const dir = join(siteDir, app);
    if (!existsSync(dir)) {
      throw new Error(`Source-map check: ${app}/ is missing from ${siteDir}.`);
    }
    for (const entry of readdirSync(dir, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isFile() && entry.name.endsWith('.map')) {
        left.push(
          relative(siteDir, join(entry.parentPath, entry.name)).replaceAll(
            '\\',
            '/'
          )
        );
      }
    }
  }
  if (left.length > 0) {
    throw new Error(
      `Source maps would be deployed (their deletion after the upload failed): ` +
        `${left.join(', ')}. See the build log's Sentry plugin lines.`
    );
  }
}
