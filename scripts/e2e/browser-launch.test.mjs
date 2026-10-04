// Why this test matters: headless Chromium renders WebGL on the CPU
// (SwiftShader), by default in a separate GPU process that Chromium raises to
// AboveNormal itself. A browser stage lowered to below-normal
// (scripts/test-timing/stage-priority.mjs) therefore never lowered the
// process doing most of the work, and short gates beside a 3D suite kept
// failing on timeouts. `--in-process-gpu` moves that work into the browser
// process, which inherits the lowered priority. Measured 2026-09-30 under
// sustained load: repo-config green in all 5 counted runs with the pair,
// 3-18 timeouts per run without.
//
// These tests pin that every Playwright config gets the flag exactly when
// run-stage says the stage really runs lowered (review finding 3): never by
// platform alone, so a refused lowering or an opt-out never changes the
// renderer model for nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { browserLaunchArgs, IN_PROCESS_GPU_ARG } from './browser-launch.mjs';
import { LOWERED_MARKER_ENV } from '../test-timing/stage-priority.mjs';
import { repoRoot, trackedFiles } from '../../tests/repo-config/tracked-tree.js';

describe('browserLaunchArgs', () => {
  it('renders in the browser process when the stage runs lowered', () => {
    expect(browserLaunchArgs({ [LOWERED_MARKER_ENV]: '1' })).toEqual([IN_PROCESS_GPU_ARG]);
    expect(IN_PROCESS_GPU_ARG).toBe('--in-process-gpu');
  });

  it('changes nothing without the marker (Linux CI, an opt-out, a refused lowering, a direct playwright run)', () => {
    expect(browserLaunchArgs({})).toEqual([]);
    expect(browserLaunchArgs({ [LOWERED_MARKER_ENV]: '0' })).toEqual([]);
    expect(browserLaunchArgs({ [LOWERED_MARKER_ENV]: '' })).toEqual([]);
  });
});

describe('every Playwright config uses it', () => {
  // Review finding 1: the flag reached only the design system's config, so
  // OsmDemo, PhysicsDemo, WayfindingHudDemo and the other WebGL apps kept an
  // AboveNormal GPU process under a lowered stage: the slower-for-nothing case.
  // Enumerated from the tracked-file list, so a new package's config is
  // covered the day it is added.
  const configs = trackedFiles('*playwright.config.js', '*playwright.config.mjs');

  it('finds the configs (so the check is not vacuous)', () => {
    expect(configs.length).toBeGreaterThanOrEqual(9);
  });

  it.each(configs)('%s passes browserLaunchArgs to launchOptions.args', (config) => {
    const source = readFileSync(resolve(repoRoot, config), 'utf8');
    expect(source).toMatch(/from ["'](\.\.\/)+scripts\/e2e\/browser-launch\.mjs["']/);
    expect(source).toMatch(/launchOptions:\s*\{\s*args:\s*browserLaunchArgs\(process\.env\)/);
  });
});
