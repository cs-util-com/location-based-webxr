// Tests for scripts/source-maps-deploy.mjs - the site build's check that no
// source map of an app that uploads its maps is left in the deploy.
//
// Why these tests matter: the Recorder, the Tour Viewer and the map demo
// upload their source maps to the error service and delete them afterwards,
// but a failed delete is only logged by the upload plugin, so the build stayed
// green with the maps deployed. This check is what makes such a build fail.
// Without the token nothing is uploaded or deleted and the maps are wanted,
// so it passes.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SOURCE_MAP_FREE_APPS,
  assertNoSourceMapsDeployed,
} from './source-maps-deploy.mjs';

/** @type {string} */
let root;

/** @param {string} rel */
function put(rel) {
  const file = join(root, ...rel.split('/'));
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, 'x');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'source-maps-deploy-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const TOKEN = { SENTRY_AUTH_TOKEN: 't' };

describe('assertNoSourceMapsDeployed', () => {
  it('names the three apps that upload and delete their maps', () => {
    expect(SOURCE_MAP_FREE_APPS).toEqual(['recorder', 'tour', 'osm']);
  });

  /** Every checked app folder, holding no map. */
  function putAppFolders() {
    for (const app of SOURCE_MAP_FREE_APPS) put(`${app}/index.html`);
  }

  it('passes when the apps hold no map', () => {
    putAppFolders();
    put('tour/assets/index-abc.js');
    put('osm/assets/worker-def.js');
    expect(() =>
      assertNoSourceMapsDeployed({ siteDir: root, env: TOKEN })
    ).not.toThrow();
  });

  it('fails with the token and a map left at any depth, naming each', () => {
    putAppFolders();
    put('recorder/assets/main-xyz.js.map');
    put('tour/assets/index-abc.js.map');
    put('tour/assets/index-abc.js');
    put('osm/assets/workers/worker-def.js.map');
    expect(() =>
      assertNoSourceMapsDeployed({ siteDir: root, env: TOKEN })
    ).toThrow(
      /recorder\/assets\/main-xyz\.js\.map.*tour\/assets\/index-abc\.js\.map.*osm\/assets\/workers\/worker-def\.js\.map/s
    );
  });

  it("leaves the other apps' maps alone", () => {
    putAppFolders();
    put('starter/assets/index-abc.js.map');
    expect(() =>
      assertNoSourceMapsDeployed({ siteDir: root, env: TOKEN })
    ).not.toThrow();
  });

  it('passes without the token: nothing was uploaded, the maps are wanted', () => {
    put('tour/assets/index-abc.js.map');
    expect(() =>
      assertNoSourceMapsDeployed({ siteDir: root, env: {} })
    ).not.toThrow();
  });

  it('fails when an app folder is missing, rather than passing vacuously', () => {
    put('recorder/index.html');
    put('tour/index.html');
    expect(() =>
      assertNoSourceMapsDeployed({ siteDir: root, env: TOKEN })
    ).toThrow(/osm/);
  });
});
