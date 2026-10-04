/**
 * Tests for the curated `core` re-export surface.
 *
 * Why this test matters: the Option-C migration depends on every symbol that
 * apps used to import directly from `gps-plus-slam-js` being available at
 * `gps-plus-slam-app-framework/core`. If a future refactor accidentally drops
 * one of the re-exports, app code (and the lint rule banning direct
 * `gps-plus-slam-js` imports in apps) would catch it eventually — but this
 * test catches it at framework build time, with a clear failure message.
 *
 * See: 2026-05-01-app-single-package-dep-analysis.md §2.4
 */

import { describe, it, expect } from 'vitest';
import * as core from './index.js';
import type { LatLongAlt } from './index.js';
import * as lib from 'gps-plus-slam-js';

describe('core re-export surface', () => {
  it('re-exports the runtime symbols apps depend on', () => {
    // Functions
    expect(core.webxrToNUE).toBe(lib.webxrToNUE);
    expect(core.calcGpsCoords).toBe(lib.calcGpsCoords);
    expect(core.isIdentityMatrix4).toBe(lib.isIdentityMatrix4);
    // Action creator (Redux Toolkit creates a callable with `.type`)
    expect(typeof core.odometryTrackingRestarted).toBe('function');
    expect(core.odometryTrackingRestarted).toBe(lib.odometryTrackingRestarted);
    // Factory
    expect(core.createGpsSlamStore).toBe(lib.createGpsSlamStore);
    // License activation (used by app tests that exercise licensed math)
    expect(core.validateLicenseKey).toBe(lib.validateLicenseKey);
    // GPS point provenance (the Tour Viewer's keep-alive re-votes on device
    // fixes only, never on its own synthetic votes)
    expect(core.gpsPointSourceOf).toBe(lib.gpsPointSourceOf);
    expect(core.GPS_POINT_SOURCE_DEVICE).toBe(lib.GPS_POINT_SOURCE_DEVICE);
    expect(core.GPS_POINT_SOURCE_SYNTHETIC_QR).toBe(
      lib.GPS_POINT_SOURCE_SYNTHETIC_QR
    );
  });

  it('re-exports the type aliases apps depend on (compile-time check)', () => {
    // These assignments are the actual test: if `LatLongAlt` (or any other
    // re-exported type) is dropped from `core/index.ts`, this file fails to
    // typecheck. The runtime `expect` is just to keep vitest happy.
    const sample: LatLongAlt = {
      lat: 0,
      lon: 0,
      altitude: 0,
    };
    expect(sample.altitude).toBe(0);
  });
});
