// Tests for scripts/sentry-vite-plugins.mjs - the error service's Vite
// plugins of the Tour Viewer and the map demo.
//
// Why these tests matter: the plugins run only when SENTRY_AUTH_TOKEN is set,
// which no CI workflow does, so no gate ever builds with them. What can be
// pinned without a token is pinned here: nothing runs without the token; with
// it, the page's instance deletes the source maps from the folder the build
// REALLY writes to (the site build passes `--outDir dist-site/<app>`, so a
// fixed `./dist` glob would delete nothing and the maps would be deployed),
// in the forward-slash form the glob library needs on Windows; the worker
// instances delete nothing (the page's instance does it once, after the
// upload); and the plugin sends no build telemetry.

import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  sentrySourceMapPlugins,
  sourceMapGlob,
} from './sentry-vite-plugins.mjs';

/** A stand-in for `sentryVitePlugin` that records its options. */
function fakeFactory() {
  /** @type {Record<string, unknown>[]} */
  const calls = [];
  const create = vi.fn((/** @type {Record<string, unknown>} */ options) => {
    calls.push(options);
    return [{ name: `fake-sentry-${calls.length}` }];
  });
  return { create, calls };
}

describe('sentrySourceMapPlugins', () => {
  it('runs nothing without the token', () => {
    const { create } = fakeFactory();
    const out = sentrySourceMapPlugins(create, {});
    expect(out.plugins).toEqual([]);
    expect(out.workerPlugins()).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("deletes the maps from the build's resolved output folder after upload", async () => {
    const { create, calls } = fakeFactory();
    const out = sentrySourceMapPlugins(create, { SENTRY_AUTH_TOKEN: 't' });
    const [probe] = out.plugins;
    expect(probe.apply).toBe('build');
    // The site build's case: an outDir outside the package.
    const root = resolve('/repo/GpsPlusSlamJs_TourViewer');
    probe.configResolved({ root, build: { outDir: '../dist-site/tour' } });
    const page = /** @type {any} */ (calls[0]);
    // The literal, not sourceMapGlob(): a glob that ignored the outDir
    // would satisfy a comparison against itself.
    await expect(page.sourcemaps.filesToDeleteAfterUpload).resolves.toBe(
      `${resolve('/repo/dist-site/tour').replaceAll('\\', '/')}/**/*.map`
    );
    expect(page.org).toBe('cs-util-com');
    expect(page.project).toBe('js-gps-recorder');
    expect(page.telemetry).toBe(false);
  });

  // Why this test matters: the deletion glob is `<outDir>/**/*.map`. An
  // outDir that is the project root, holds it, or is the filesystem root
  // would make that glob reach every source map of the checkout (or the
  // disk), node_modules included; such a build deletes nothing instead.
  it.each([
    ['the project root', '.'],
    ['a folder holding the root', '..'],
    ['the filesystem root', '/'],
  ])('deletes nothing when the outDir is %s', async (_name, outDir) => {
    const { create, calls } = fakeFactory();
    const out = sentrySourceMapPlugins(create, { SENTRY_AUTH_TOKEN: 't' });
    const [probe] = out.plugins;
    probe.configResolved({
      root: resolve('/repo/GpsPlusSlamJs_TourViewer'),
      build: { outDir },
    });
    const page = /** @type {any} */ (calls[0]);
    await expect(page.sourcemaps.filesToDeleteAfterUpload).resolves.toEqual([]);
  });

  it('gives the worker bundles their own instance, which deletes nothing', () => {
    const { create, calls } = fakeFactory();
    const out = sentrySourceMapPlugins(create, { SENTRY_AUTH_TOKEN: 't' });
    expect(out.workerPlugins()).toEqual([[{ name: 'fake-sentry-2' }]]);
    const worker = /** @type {any} */ (calls[1]);
    expect(worker.sourcemaps).toBeUndefined();
    expect(worker.telemetry).toBe(false);
  });

  it('only warns when an upload fails', () => {
    const { create, calls } = fakeFactory();
    sentrySourceMapPlugins(create, { SENTRY_AUTH_TOKEN: 't' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = /** @type {any} */ (calls[0]);
    expect(() => page.errorHandler(new Error('offline'))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      'Sentry source-map upload failed:',
      'offline'
    );
    warn.mockRestore();
  });
});

describe('sourceMapGlob', () => {
  it('is absolute, uses forward slashes and matches maps at any depth', () => {
    const glob = sourceMapGlob(resolve('/repo/app'), 'dist');
    expect(glob).not.toContain('\\');
    expect(glob.endsWith('/dist/**/*.map')).toBe(true);
    expect(glob).toBe(
      `${resolve('/repo/app/dist').replaceAll('\\', '/')}/**/*.map`
    );
  });
});
