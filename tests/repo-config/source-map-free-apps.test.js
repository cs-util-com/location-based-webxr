// Repo-meta test: the site build's list of apps that must deploy no source
// map follows the apps whose Vite config uploads and deletes their maps.
//
// Why this test matters: `SOURCE_MAP_FREE_APPS` in
// `scripts/source-maps-deploy.mjs` is kept by hand. An app that starts using
// the framework's `sentrySourceMapPlugins` without being added to it would
// have a failed map deletion pass a green site build, and its maps would be
// deployed; an app that stops using it would fail every build with the token
// for maps it is meant to keep. Both drifts fail here instead, without a
// single vite build: the app's package is found from its config's folder,
// and its `dist-site` folder from the base the site build gives that package.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { SOURCE_MAP_FREE_APPS } from '../../scripts/source-maps-deploy.mjs';
import { readTracked, repoRoot, trackedFiles } from './tracked-tree.js';

const BUILD_SITE = readFileSync(
  join(repoRoot, 'scripts', 'build-site.mjs'),
  'utf-8',
);

/** The package name of the nearest `package.json` at or above `dir`. */
function packageNameOf(dir) {
  for (let at = dir; at !== '.' && at !== ''; at = dirname(at)) {
    const manifest = join(repoRoot, at, 'package.json');
    if (existsSync(manifest))
      return JSON.parse(readFileSync(manifest, 'utf-8')).name;
  }
  throw new Error(`No package.json above ${dir}`);
}

/**
 * The `dist-site` folder the site build gives each package's vite build:
 * `--filter <name> exec vite build ... --base=/<folder>/`, with its index in
 * the script for the ordering check. A build at the site root (`--base=/`,
 * the Landing) gets the folder `''`.
 */
function siteFoldersByPackage() {
  const builds = new Map();
  const viteBuild =
    /'--filter',\s*'([^']+)',\s*'exec',\s*'vite',\s*'build',[^\]]*?'--base=\/(?:([\w-]+)\/)?'/g;
  for (const match of BUILD_SITE.matchAll(viteBuild)) {
    builds.set(match[1], { folder: match[2] ?? '', at: match.index });
  }
  return builds;
}

/**
 * The site build of the package `name` whose Vite config `file` uploads its
 * maps. Throws when the site build does not build it, or builds it at the
 * site root: `SOURCE_MAP_FREE_APPS` names folders under the deploy, so a
 * root app's maps would need a check of their own in
 * `scripts/source-maps-deploy.mjs` before it can adopt the helper.
 */
function siteBuildOf(file, name, builds) {
  const build = builds.get(name);
  if (!build) throw new Error(`${file}: the site build does not build ${name}`);
  if (build.folder === '')
    throw new Error(
      `${file}: ${name} is built at the site root (--base=/), which ` +
        'SOURCE_MAP_FREE_APPS cannot name; give its maps a root check in ' +
        'scripts/source-maps-deploy.mjs first',
    );
  return build;
}

/** The site-build folder of every app whose Vite config uploads its maps. */
function uploadingApps() {
  const builds = siteFoldersByPackage();
  return trackedFiles(
    '*vite.config.ts',
    '*vite.config.mts',
    '*vite.config.js',
    '*vite.config.mjs',
  )
    .filter((file) => /\bsentrySourceMapPlugins\(/.test(readTracked(file)))
    .map((file) => siteBuildOf(file, packageNameOf(dirname(file)), builds));
}

describe('SOURCE_MAP_FREE_APPS', () => {
  it('lists exactly the apps whose Vite config uploads and deletes its maps', () => {
    const folders = uploadingApps().map((build) => build.folder);
    expect(folders.length).toBeGreaterThan(0);
    expect([...folders].sort()).toEqual([...SOURCE_MAP_FREE_APPS].sort());
  });

  // Why: an app built at the site root has no folder to list, so the guard
  // must say that, rather than claim the site build does not build it.
  it('names a root build as such when its app uploads maps', () => {
    const builds = siteFoldersByPackage();
    expect(builds.get('gps-plus-slam-landing')?.folder).toBe('');
    expect(() =>
      siteBuildOf(
        'GpsPlusSlamJs_Landing/vite.config.ts',
        'gps-plus-slam-landing',
        builds,
      ),
    ).toThrow(/is built at the site root \(--base=\/\)/);
  });

  it('is checked after every one of those apps is built', () => {
    const check = BUILD_SITE.indexOf(
      'assertNoSourceMapsDeployed({ siteDir: distSite })',
    );
    expect(check).toBeGreaterThan(-1);
    for (const build of uploadingApps()) {
      expect(build.at, `${build.folder} is built after the check`).toBeLessThan(
        check,
      );
    }
  });
});
