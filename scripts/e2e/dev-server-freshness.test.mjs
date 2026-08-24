// WHY THESE TESTS MATTER. Each one pins a step where this guard has already
// been shown — by a cold review of its own plan — to be able to fail SILENTLY,
// i.e. to pass every run while checking nothing. A guard that cannot fail is
// indistinguishable from no guard, and that is the exact shape of the bug it was
// written to catch.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertDevServerFresh,
  devServerUrlOf,
  entryFilesOf,
  extractFsSpecifiers,
  findMissingModules,
  fsUrlToPath,
} from './dev-server-freshness.mjs';

/**
 * A verbatim excerpt of what a real vite dev server returned for
 * `GpsPlusSlamJs_Osm/dist/index.js` on 2026-08-16 — captured from the running
 * server, not hand-written, so it pins vite's ACTUAL rewriting behaviour rather
 * than an assumption about it. The whole design rests on relative imports being
 * rewritten into absolute `/@fs/…` specifiers; if a vite upgrade ever stops
 * doing that, this is the test that says so.
 */
const REAL_VITE_OUTPUT = `import { featureKey, getOsmDebugUrl } from "/@fs/C:/gps/location-based-webxr/GpsPlusSlamJs_Osm/dist/model/osm-feature.js";
import { n as isArealRelation } from "/@fs/C:/gps/location-based-webxr/GpsPlusSlamJs_Osm/dist/osm-geometry-Dc2hTIWD.js";
import "/@fs/C:/gps/location-based-webxr/GpsPlusSlamJs_Osm/dist/model/index.js";
import { t as buildMesh } from "/@fs/C:/gps/location-based-webxr/GpsPlusSlamJs_Osm/dist/mesh-BLZDYwaf.js?t=1786902324810";
`;

const OSM_DIST = 'C:/gps/location-based-webxr/GpsPlusSlamJs_Osm/dist';

describe('extractFsSpecifiers', () => {
  it('reads every /@fs/ import out of what vite really serves', () => {
    // The load-bearing assumption of the whole guard, pinned against real output.
    expect(extractFsSpecifiers(REAL_VITE_OUTPUT)).toEqual([
      `${OSM_DIST}/model/osm-feature.js`,
      `${OSM_DIST}/osm-geometry-Dc2hTIWD.js`,
      `${OSM_DIST}/model/index.js`,
      `${OSM_DIST}/mesh-BLZDYwaf.js`,
    ]);
  });

  it('ignores /@fs/ text that is not inside a quoted specifier', () => {
    // The false-positive path the cold review flagged: sourcemap comments and
    // prose mentioning a path must not be able to block a run.
    const text = `// see /@fs/C:/nowhere/ghost.js for details\n//# sourceMappingURL=/@fs/C:/nowhere/x.js.map\n`;
    expect(extractFsSpecifiers(text)).toEqual([]);
  });
});

describe('fsUrlToPath', () => {
  it('strips the spurious leading slash before a Windows drive letter', () => {
    // Without this, every path is `/C:/…`, no fs call matches, and the guard
    // reports everything missing — blocking every run in the workspace.
    expect(fsUrlToPath('/@fs/C:/gps/x/y.js')).toBe('C:/gps/x/y.js');
  });

  it('leaves a POSIX absolute path alone', () => {
    expect(fsUrlToPath('/@fs/home/ci/x/y.js')).toBe('/home/ci/x/y.js');
  });

  it('drops vite bookkeeping queries and hashes', () => {
    expect(fsUrlToPath('/@fs/C:/x/y.js?t=17869&import')).toBe('C:/x/y.js');
    expect(fsUrlToPath('/@fs/C:/x/y.js#frag')).toBe('C:/x/y.js');
  });

  it('decodes percent escapes and survives a malformed one', () => {
    expect(fsUrlToPath('/@fs/C:/a%20b/y.js')).toBe('C:/a b/y.js');
    expect(fsUrlToPath('/@fs/C:/a%zz/y.js')).toBeUndefined();
  });
});

describe('findMissingModules', () => {
  it('reports a hashed chunk the rebuild renamed away', () => {
    // The incident itself, reduced: the server still names `mesh-CZafImwM.js`
    // and only `mesh-BLZDYwaf.js` is on disk.
    const served = `import { t } from "/@fs/${OSM_DIST}/mesh-CZafImwM.js";`;
    const missing = findMissingModules({
      servedText: served,
      libraryDirs: [OSM_DIST],
      exists: (file) => file.endsWith('mesh-BLZDYwaf.js'),
    });
    expect(missing).toEqual([`${OSM_DIST}/mesh-CZafImwM.js`]);
  });

  it('passes when every reference resolves', () => {
    expect(
      findMissingModules({
        servedText: REAL_VITE_OUTPUT,
        libraryDirs: [OSM_DIST],
        exists: () => true,
      })
    ).toEqual([]);
  });

  it('never judges a path outside the linked libraries', () => {
    // Virtual modules, the app's own source and registry packages may legitimately
    // not exist as files. Judging them is how this guard would block everything.
    const served = `import "/@fs/C:/gps/location-based-webxr/GpsPlusSlamJs_OsmDemo/src/virtual.js";`;
    expect(
      findMissingModules({
        servedText: served,
        libraryDirs: [OSM_DIST],
        exists: () => false,
      })
    ).toEqual([]);
  });

  it('matches a library directory whose separators and drive case differ', () => {
    // `realpathSync` returns `C:\gps\…`; the URL carries `c:/gps/…`. Compared
    // raw, the prefix never matches and the guard silently checks nothing.
    const served = `import "/@fs/c:/gps/lib/dist/gone.js";`;
    expect(
      findMissingModules({
        servedText: served,
        libraryDirs: ['C:\\gps\\lib\\dist'],
        exists: () => false,
      })
    ).toEqual(['c:/gps/lib/dist/gone.js']);
  });
});

describe('entryFilesOf', () => {
  /** @param {Record<string, unknown>} manifest */
  function packageWith(manifest, files) {
    const dir = mkdtempSync(path.join(tmpdir(), 'freshness-'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    for (const file of files) {
      mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      writeFileSync(path.join(dir, file), '');
    }
    return dir;
  }

  it('resolves the STRING shorthand, which is what this workspace actually uses', () => {
    // The cold review's finding 1: both linked libraries write
    // `"exports": { ".": "./dist/index.js" }` with no conditions and no `main`.
    // A conditions-only reader resolves nothing and the guard becomes a no-op
    // that passes on the very state it exists to catch.
    const dir = packageWith({ exports: { '.': './dist/index.js' } }, ['dist/index.js']);
    expect(entryFilesOf(dir)).toEqual([path.resolve(dir, 'dist/index.js')]);
  });

  it('resolves EVERY subpath, not just "."', () => {
    // A chunk reachable only from `gps-plus-slam-osm/mesh` is invisible to a
    // probe that reads the root entry alone.
    const dir = packageWith(
      { exports: { '.': './dist/index.js', './mesh': './dist/mesh/index.js' } },
      ['dist/index.js', 'dist/mesh/index.js']
    );
    expect(entryFilesOf(dir).sort()).toEqual(
      [path.resolve(dir, 'dist/index.js'), path.resolve(dir, 'dist/mesh/index.js')].sort()
    );
  });

  it('resolves nested condition objects and falls back to main', () => {
    const dir = packageWith(
      { exports: { '.': { import: { default: './dist/a.js' } } }, main: './dist/b.js' },
      ['dist/a.js', 'dist/b.js']
    );
    expect(entryFilesOf(dir).sort()).toEqual(
      [path.resolve(dir, 'dist/a.js'), path.resolve(dir, 'dist/b.js')].sort()
    );
  });

  it('returns nothing for an unreadable manifest rather than throwing', () => {
    expect(entryFilesOf(path.join(tmpdir(), 'does-not-exist-freshness'))).toEqual([]);
  });
});

describe('devServerUrlOf', () => {
  it('prefers webServer.url, which is what reuseExistingServer itself probes', () => {
    expect(devServerUrlOf({ webServer: { url: 'http://127.0.0.1:5186' } })).toBe(
      'http://127.0.0.1:5186'
    );
  });

  it('falls back to a project baseURL', () => {
    expect(devServerUrlOf({ projects: [{ use: { baseURL: 'http://127.0.0.1:4321' } }] })).toBe(
      'http://127.0.0.1:4321'
    );
  });

  it('returns undefined when neither is present', () => {
    expect(devServerUrlOf({})).toBeUndefined();
  });
});

describe('assertDevServerFresh', () => {
  it('is skippable, so a wrong verdict can never strand the workspace', async () => {
    const previous = process.env.E2E_SKIP_FRESHNESS;
    process.env.E2E_SKIP_FRESHNESS = '1';
    try {
      const result = await assertDevServerFresh({
        baseUrl: 'http://127.0.0.1:1',
        packageDir: process.cwd(),
        log: () => {},
      });
      expect(result).toEqual({ checked: false, reason: 'bypassed' });
    } finally {
      if (previous === undefined) delete process.env.E2E_SKIP_FRESHNESS;
      else process.env.E2E_SKIP_FRESHNESS = previous;
    }
  });

  it('skips, rather than throws, when the config names no dev server', async () => {
    const messages = [];
    const result = await assertDevServerFresh({
      baseUrl: undefined,
      packageDir: process.cwd(),
      log: (m) => messages.push(m),
    });
    expect(result.checked).toBe(false);
    expect(messages.join('\n')).toMatch(/no dev-server URL/);
  });

  it('skips when the package links no workspace library', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'freshness-empty-'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
    const result = await assertDevServerFresh({
      baseUrl: 'http://127.0.0.1:5186',
      packageDir: dir,
      log: () => {},
    });
    expect(result).toEqual({ checked: false, reason: 'no-linked-libraries' });
  });
});
