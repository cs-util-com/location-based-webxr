// Why these tests matter: the globe editor asks for its imagery by
// root-absolute paths (`/globe-assets/...`), which only the dev server used
// to answer. The deployed preview had none, so the editor's globe was
// untextured there while every local run and every e2e (both on the dev
// server) were green. The copy and the guard below are the deploy's half:
// one copy at the site root, the provenance notes left out, and a build that
// FAILS when an app's chunk names the folder and the folder is not there,
// instead of deploying 404s.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GLOBE_ASSETS_PREFIX,
  assertGlobeAssetsShipped,
  chunksNaming,
  copyGlobeAssets,
  siteAppDirs,
} from './globe-assets-deploy.mjs';

/** @type {string} */
let root;

/** @param {string} rel @param {string} text */
function put(rel, text) {
  const file = join(root, ...rel.split('/'));
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'globe-assets-deploy-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('copyGlobeAssets', () => {
  it('copies every file once, without the Markdown notes, and counts them', () => {
    put('assets/README.md', 'notes');
    put('assets/PROVENANCE.md', 'provenance');
    put('assets/blue-marble-4326/0/0/0.webp', 'ab');
    put('assets/equirect/clouds-1024.webp', 'abc');
    const result = copyGlobeAssets({
      from: join(root, 'assets'),
      to: join(root, 'site', 'globe-assets'),
    });
    expect(result).toEqual({ files: 2, bytes: 5 });
    expect(existsSync(join(root, 'site/globe-assets/blue-marble-4326/0/0/0.webp'))).toBe(true);
    expect(existsSync(join(root, 'site/globe-assets/equirect/clouds-1024.webp'))).toBe(true);
    expect(existsSync(join(root, 'site/globe-assets/README.md'))).toBe(false);
    expect(existsSync(join(root, 'site/globe-assets/PROVENANCE.md'))).toBe(false);
  });

  it('refuses a source folder that is missing or holds no file', () => {
    // An empty copy would pass the guard below and deploy 404s all the same.
    expect(() =>
      copyGlobeAssets({ from: join(root, 'nowhere'), to: join(root, 'out') })
    ).toThrow(/globe assets/);
    put('empty/README.md', 'only notes');
    expect(() =>
      copyGlobeAssets({ from: join(root, 'empty'), to: join(root, 'out') })
    ).toThrow(/no file/);
  });
});

describe('chunksNaming', () => {
  it('lists the JavaScript files that name the prefix, and only those', () => {
    put('tour/assets/editor3d-globe-abc.js', `fetch("${GLOBE_ASSETS_PREFIX}equirect/x.webp")`);
    put('tour/assets/main-def.js', 'console.log("no globe here")');
    put('tour/index.html', `<a href="${GLOBE_ASSETS_PREFIX}">not a chunk</a>`);
    expect(chunksNaming(join(root, 'tour'), GLOBE_ASSETS_PREFIX)).toEqual([
      'assets/editor3d-globe-abc.js',
    ]);
  });
});

describe('siteAppDirs', () => {
  // Why: the build listed the apps it scanned by name (tour, lookdev), so
  // a third app that loads the globe would have deployed 404s unguarded.
  it('lists every folder under the site but the globe assets, sorted', () => {
    put('site/tour/assets/a.js', 'x');
    put('site/lookdev/a.js', 'x');
    put('site/recorder/a.js', 'x');
    put('site/globe-assets/x.webp', 'x');
    put('site/index.html', 'x');
    expect(siteAppDirs(join(root, 'site'))).toEqual(
      ['lookdev', 'recorder', 'tour'].map((app) => join(root, 'site', app))
    );
  });

  it('lets the guard catch a chunk in an app nobody named', () => {
    put('site/newapp/assets/globe-abc.js', `"${GLOBE_ASSETS_PREFIX}x"`);
    const siteDir = join(root, 'site');
    expect(() =>
      assertGlobeAssetsShipped({ siteDir, appDirs: siteAppDirs(siteDir) })
    ).toThrow(/globe-abc.js/);
  });

  it('is empty for a missing site', () => {
    expect(siteAppDirs(join(root, 'nowhere'))).toEqual([]);
  });
});

describe('assertGlobeAssetsShipped', () => {
  it('fails when a chunk names the folder and the folder is missing', () => {
    put('site/tour/assets/editor3d-globe-abc.js', `"${GLOBE_ASSETS_PREFIX}blue-marble-4326/{z}"`);
    expect(() =>
      assertGlobeAssetsShipped({
        siteDir: join(root, 'site'),
        appDirs: [join(root, 'site', 'tour')],
      })
    ).toThrow(/editor3d-globe-abc\.js.*globe-assets/s);
  });

  it('fails when the folder is there but empty', () => {
    put('site/tour/assets/editor3d-globe-abc.js', `"${GLOBE_ASSETS_PREFIX}x"`);
    mkdirSync(join(root, 'site', 'globe-assets'), { recursive: true });
    expect(() =>
      assertGlobeAssetsShipped({
        siteDir: join(root, 'site'),
        appDirs: [join(root, 'site', 'tour')],
      })
    ).toThrow(/globe-assets/);
  });

  it('passes when the folder holds files, and names the chunks it checked', () => {
    put('site/tour/assets/editor3d-globe-abc.js', `"${GLOBE_ASSETS_PREFIX}x"`);
    put('site/globe-assets/equirect/x.webp', 'x');
    expect(
      assertGlobeAssetsShipped({
        siteDir: join(root, 'site'),
        appDirs: [join(root, 'site', 'tour')],
      })
    ).toEqual(['assets/editor3d-globe-abc.js']);
  });

  it('passes without the folder when no chunk names it', () => {
    // Nothing asks for the imagery, so nothing can 404: the guard keys on
    // a reference, not on the folder alone.
    put('site/tour/assets/main-def.js', 'console.log(1)');
    expect(
      assertGlobeAssetsShipped({
        siteDir: join(root, 'site'),
        appDirs: [join(root, 'site', 'tour')],
      })
    ).toEqual([]);
  });
});
