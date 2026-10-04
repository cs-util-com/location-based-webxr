/**
 * Build Info Tests
 *
 * Why this test matters:
 * Validates that getBuildInfo() correctly reads the Vite-injected build-time
 * constants and returns a well-typed BuildInfo object. Since the real globals
 * are replaced at build time by Vite's `define`, tests must set up globals
 * manually to simulate the injection. Moved here from the RecorderApp with
 * the reader (2026-09-28). The round trip against the define block the
 * apps use is pinned in `scripts/build-metadata-define.test.mjs`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBuildInfo, type BuildInfo } from './build-info';

describe('getBuildInfo', () => {
  const FAKE_COMMIT = 'abc1234';
  const FAKE_TIME = '2026-04-20T12:00:00.000Z';
  const FAKE_APP_VERSION = '0.1.0';
  const FAKE_LIB_VERSION = '1.0.0';
  const FAKE_FW_VERSION = '0.1.0';

  beforeEach(() => {
    // Simulate Vite define replacements by setting globals
    vi.stubGlobal('__BUILD_COMMIT__', FAKE_COMMIT);
    vi.stubGlobal('__BUILD_TIME__', FAKE_TIME);
    vi.stubGlobal('__APP_VERSION__', FAKE_APP_VERSION);
    vi.stubGlobal('__LIB_VERSION__', FAKE_LIB_VERSION);
    vi.stubGlobal('__FW_VERSION__', FAKE_FW_VERSION);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns all build fields from injected globals', () => {
    const info: BuildInfo = getBuildInfo();

    expect(info).toEqual({
      commitHash: FAKE_COMMIT,
      appVersion: FAKE_APP_VERSION,
      libraryVersion: FAKE_LIB_VERSION,
      frameworkVersion: FAKE_FW_VERSION,
      buildTime: FAKE_TIME,
    });
  });

  it('throws when required metadata is missing', () => {
    // Why this test matters:
    // Missing metadata should fail loudly at the helper boundary so callers
    // can decide whether to surface a warning or degrade gracefully (the
    // session.json builder drops only its `build` field).
    vi.unstubAllGlobals();

    expect(() => getBuildInfo()).toThrow(
      'Missing or invalid build metadata: __BUILD_COMMIT__'
    );
  });

  it('throws when a constant is not a string', () => {
    vi.stubGlobal('__FW_VERSION__', 42);

    expect(() => getBuildInfo()).toThrow(
      'Missing or invalid build metadata: __FW_VERSION__'
    );
  });
});
