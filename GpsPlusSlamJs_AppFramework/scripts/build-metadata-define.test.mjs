// Tests for scripts/build-metadata-define.mjs - the Vite `define` block that
// stamps an app's build (commit, versions, build time).
//
// Why these tests matter: the block and the browser-side reader
// (`src/utils/build-info.ts`) agree only by the five constant names, and a
// mismatch stamps no build at all - silently, since the session.json
// builder swallows the reader's throw. The Recorder and the Tour Viewer both
// build with this block (2026-09-28, DEC-H3), so it is pinned here once.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBuildInfo } from '../src/utils/build-info';
import {
  createBuildMetadataDefine,
  readInstalledPackageVersion,
} from './build-metadata-define.mjs';

/** @type {string[]} */
const made = [];

/**
 * An app directory as pnpm lays one out: its package.json, the framework
 * linked into its node_modules, and the library under the framework's own
 * node_modules (never at the app's top level).
 *
 * @param {{ nestedLibrary?: boolean }} [options]
 */
function fakeAppDir(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'build-meta-'));
  made.push(dir);
  const write = (/** @type {string} */ rel, /** @type {unknown} */ json) => {
    const path = join(dir, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(json));
  };
  write('package.json', { name: 'app', version: '0.3.0' });
  write('node_modules/gps-plus-slam-app-framework/package.json', {
    version: '1.24.0',
  });
  write(
    options.nestedLibrary === false
      ? 'node_modules/gps-plus-slam-js/package.json'
      : 'node_modules/gps-plus-slam-app-framework/node_modules/gps-plus-slam-js/package.json',
    { version: '1.25.0' }
  );
  return dir;
}

const FIXED = {
  commitHash: () => 'f00dcafe',
  now: () => new Date('2026-09-28T09:00:00.000Z'),
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true });
});

describe('createBuildMetadataDefine', () => {
  it('defines each constant bare and as globalThis.__NAME__, JSON-quoted and identical', () => {
    const define = createBuildMetadataDefine(fakeAppDir(), FIXED);

    expect(define).toEqual({
      __BUILD_COMMIT__: '"f00dcafe"',
      'globalThis.__BUILD_COMMIT__': '"f00dcafe"',
      __BUILD_TIME__: '"2026-09-28T09:00:00.000Z"',
      'globalThis.__BUILD_TIME__': '"2026-09-28T09:00:00.000Z"',
      __APP_VERSION__: '"0.3.0"',
      'globalThis.__APP_VERSION__': '"0.3.0"',
      __LIB_VERSION__: '"1.25.0"',
      'globalThis.__LIB_VERSION__': '"1.25.0"',
      __FW_VERSION__: '"1.24.0"',
      'globalThis.__FW_VERSION__': '"1.24.0"',
    });
  });

  it('is read back whole by the framework reader, applied as the Vite dev client applies it', () => {
    // The round trip: every `globalThis.__NAME__` key assigned onto
    // globalThis (what Vite's dev client does with the block), then read.
    const define = createBuildMetadataDefine(fakeAppDir(), FIXED);
    for (const [key, value] of Object.entries(define)) {
      if (!key.startsWith('globalThis.')) continue;
      vi.stubGlobal(key.slice('globalThis.'.length), JSON.parse(value));
    }

    expect(getBuildInfo()).toEqual({
      commitHash: 'f00dcafe',
      appVersion: '0.3.0',
      libraryVersion: '1.25.0',
      frameworkVersion: '1.24.0',
      buildTime: '2026-09-28T09:00:00.000Z',
    });
  });
});

describe('readInstalledPackageVersion', () => {
  it('finds a package at the top level or nested under the framework', () => {
    expect(readInstalledPackageVersion(fakeAppDir(), 'gps-plus-slam-js')).toBe(
      '1.25.0'
    );
    expect(
      readInstalledPackageVersion(
        fakeAppDir({ nestedLibrary: false }),
        'gps-plus-slam-js'
      )
    ).toBe('1.25.0');
  });

  it('fails loudly for a package that is not installed', () => {
    // A build must not ship a made-up version.
    expect(() => readInstalledPackageVersion(fakeAppDir(), 'missing')).toThrow(
      /Could not locate package\.json for missing/
    );
  });
});
