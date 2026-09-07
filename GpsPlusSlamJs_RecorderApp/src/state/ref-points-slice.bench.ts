import { describe, test } from 'vitest';
import type { RawGpsPoint } from 'gps-plus-slam-app-framework/state';
import {
  selectKnownAnchorsByCell,
  type RefPointEntry,
} from './ref-points-slice';

/**
 * Smoke benchmark for the refPoints H3-cell grouping — proves the recorder's
 * `pnpm bench` harness on a real code path (see the 2026-07-09 bench-infra
 * plan: capability, not coverage).
 *
 * `selectKnownAnchorsByCell` groups the flat entries array into one
 * KnownGeoAnchor per H3 cell. It re-runs whenever the entries array changes
 * (every Capture tap, every sidecar import) and feeds the proximity matcher,
 * so its cost scales with the number of ref-point entries.
 *
 * The bench calls the selector's `resultFunc` (the pure grouping transform)
 * directly: reselect memoizes on the entries array reference, so calling the
 * selector itself with a fixed state would measure the cache hit, not the
 * transform.
 */

function buildEntry(index: number): RefPointEntry {
  const rawGpsPoint: RawGpsPoint = {
    id: `gps-${index}`,
    latitude: 50.7 + index * 1e-5,
    longitude: 6.08 + index * 1e-5,
    altitude: 200,
    latLongAccuracy: 4,
    altitudeAccuracy: 3,
    timestamp: 1_700_000_000_000 + index * 1_000,
  };
  return {
    // ~4 observations per cell, mirroring repeated Capture taps at the same
    // landmark; a third of the cells carry an imported display name.
    id: `8a1fb466${(index >> 2).toString(16).padStart(5, '0')}f`,
    timestamp: rawGpsPoint.timestamp,
    name: index % 12 === 0 ? `Landmark ${index >> 2}` : undefined,
    rawGpsPoint,
  };
}

function buildEntries(count: number): RefPointEntry[] {
  return Array.from({ length: count }, (_, i) => buildEntry(i));
}

describe('selectKnownAnchorsByCell (H3 grouping for proximity matching)', () => {
  // Entries are built once at module scope; the transform is pure (fresh
  // Map + output array per call), so no per-iteration setup is needed.
  const entries100 = buildEntries(100);
  const entries2k = buildEntries(2_000);

  test('100 entries (typical session)', async ({ bench }) => {
    await bench('100 entries (typical session)', () => {
      selectKnownAnchorsByCell.resultFunc(entries100);
    }).run();
  });

  test('2k entries (large imported landmark list)', async ({ bench }) => {
    await bench('2k entries (large imported landmark list)', () => {
      selectKnownAnchorsByCell.resultFunc(entries2k);
    }).run();
  });
});
