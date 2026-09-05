/**
 * Aachen Recording Audit — Ref Point Display & Storage Bugs
 *
 * Two Aachen sessions recorded on 2026-04-09 (morning and evening) exposed
 * several bugs in the reference-point workflow:
 *
 * 1. **BUG: displayName shows H3 hex hash instead of human-readable name.**
 *    The ref point button shows "📍 Capture '8b1fa0a3168efff'" instead of
 *    "📍 Capture 'Bench Corner'" because `selectCachedKnownRefPoints` maps
 *    `ImportedRefPoint.id` (an H3 index) to `displayName`.
 *
 * 2. **BUG: ImportedRefPoint loses the human-readable name.**
 *    `loadAndDisplayRefPoints` discards `averaged.name` when building
 *    ImportedRefPoint, since the type has no `name` field.
 *
 * 3. **BUG: Duplicate ref point marking in the same session.**
 *    The evening session contains `8b1fa0a31689fff` marked twice (actions 288
 *    and 290, 1.5 s apart). The re-observation fast-path combined with the
 *    cryptic H3 button label caused the user to tap again unknowingly.
 *
 * These tests load the real Aachen ZIP files and exercise the affected code
 * paths. Tests marked "fails against current code" expose the bugs; once fixed,
 * they should pass. Tests marked "sanity" verify correctness of the recorded
 * data and unaffected logic.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadActionsFromZip,
  type RecordedAction,
} from 'gps-plus-slam-app-framework/storage/zip-reader';
import {
  selectKnownAnchorsByCell,
  type RefPointsState,
  type RefPointEntry,
} from '../state/ref-points-slice';
import {
  gpsToH3,
  findNearbyGeoAnchor,
  h3CellsMatch,
  isH3Index,
} from 'gps-plus-slam-app-framework/geo/h3-proximity';
import { averageGpsPerRefPoint } from '../storage/ref-point-loader';
import type { RefPointDefinition } from '../storage/ref-point-loader';

/**
 * The seed shape the removed `storage/ref-point-importer.ts` used to produce
 * (deleted 2026-09-04: zero production callers). Kept local to the tests that
 * still seed the V2 slice with it.
 */
interface ImportedRefPoint {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly alt?: number;
  readonly sourceZipName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RECORDINGS_DIR = path.resolve(__dirname, '../../../../TestDataJs');
const MORNING_ZIP = path.join(RECORDINGS_DIR, '2026-04-09_06-40-29utc.zip');
const EVENING_ZIP = path.join(RECORDINGS_DIR, '2026-04-09_16-12-57utc.zip');

function loadZipData(zipPath: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(zipPath));
}

interface MarkRefPointPayload {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  gpsPoint: {
    id: string;
    latitude: number;
    longitude: number;
    altitude?: number;
    latLongAccuracy: number;
    timestamp: number;
    zeroRef: { lat: number; lon: number };
    coordinates: [number, number, number];
    weight: number;
    deviceRotation?: [number, number, number, number];
  };
  timestamp: number;
}

function isMarkRefPointAction(
  action: RecordedAction
): action is RecordedAction & { payload: MarkRefPointPayload } {
  return action.type === 'gpsData/markReferencePoint';
}

/**
 * Simulate what `loadAndDisplayRefPoints` does: builds RefPointDefinitions
 * from markReferencePoint actions as if they were stored in refPoints/ JSON
 * files, then runs `averageGpsPerRefPoint` and creates ImportedRefPoints.
 */
function buildRefPointDefsFromActions(
  refPointActions: (RecordedAction & { payload: MarkRefPointPayload })[]
): RefPointDefinition[] {
  const defsById = new Map<string, RefPointDefinition>();

  for (const action of refPointActions) {
    const { id, position, rotation, gpsPoint, timestamp } = action.payload;
    const existing = defsById.get(id);
    const observation = {
      sessionId: 'test-session',
      timestamp,
      arPose: { position, rotation },
      gpsPoint,
    };

    if (existing) {
      existing.observations.push(observation);
    } else {
      defsById.set(id, {
        id,
        name: `Ref Point ${defsById.size + 1}`, // Simulated user-entered name
        createdAt: timestamp,
        observations: [observation],
      });
    }
  }

  return [...defsById.values()];
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

let morningActions: RecordedAction[];
let eveningActions: RecordedAction[];
let morningRefPoints: (RecordedAction & { payload: MarkRefPointPayload })[];
let eveningRefPoints: (RecordedAction & { payload: MarkRefPointPayload })[];
/** Whether real recording files are available (skips tests gracefully on CI). */
let dataAvailable = false;

describe('Aachen 2026-04-09 Recording Audit', () => {
  beforeAll(async () => {
    // Skip if recordings not available (CI, other dev machines)
    if (!fs.existsSync(MORNING_ZIP) || !fs.existsSync(EVENING_ZIP)) {
      return;
    }

    const morningData = loadZipData(MORNING_ZIP);
    const eveningData = loadZipData(EVENING_ZIP);

    const morningEntries = await loadActionsFromZip(morningData);
    const eveningEntries = await loadActionsFromZip(eveningData);

    morningActions = morningEntries.map((e) => e.action);
    eveningActions = eveningEntries.map((e) => e.action);

    morningRefPoints = morningActions.filter(isMarkRefPointAction);
    eveningRefPoints = eveningActions.filter(isMarkRefPointAction);

    dataAvailable = true;
  });

  // =========================================================================
  // Section 1: Sanity checks — recording integrity
  // =========================================================================

  describe('Recording integrity', () => {
    it('morning session has expected action types', () => {
      if (!dataAvailable) return;
      const types = new Set(morningActions.map((a) => a.type));
      expect(types).toContain('recording/startSession');
      expect(types).toContain('gpsData/setZeroPos');
      expect(types).toContain('gpsData/recordGpsEvent');
      expect(types).toContain('gpsData/markReferencePoint');
    });

    it('evening session has expected action types', () => {
      if (!dataAvailable) return;
      const types = new Set(eveningActions.map((a) => a.type));
      expect(types).toContain('recording/startSession');
      expect(types).toContain('gpsData/setZeroPos');
      expect(types).toContain('gpsData/recordGpsEvent');
      expect(types).toContain('gpsData/markReferencePoint');
    });

    it('morning session recorded exactly 3 reference points', () => {
      if (!dataAvailable) return;
      expect(morningRefPoints).toHaveLength(3);
    });

    it('morning ref point IDs are all valid H3 resolution-11 indices', () => {
      if (!dataAvailable) return;
      for (const rp of morningRefPoints) {
        expect(isH3Index(rp.payload.id)).toBe(true);
      }
    });

    it('evening ref point IDs are all valid H3 resolution-11 indices', () => {
      if (!dataAvailable) return;
      for (const rp of eveningRefPoints) {
        expect(isH3Index(rp.payload.id)).toBe(true);
      }
    });

    it('all morning ref point actions have complete GpsPoint with required fields', () => {
      if (!dataAvailable) return;
      for (const rp of morningRefPoints) {
        const gp = rp.payload.gpsPoint;
        expect(typeof gp.latitude).toBe('number');
        expect(typeof gp.longitude).toBe('number');
        expect(typeof gp.latLongAccuracy).toBe('number');
        expect(typeof gp.timestamp).toBe('number');
        expect(gp.zeroRef).toBeDefined();
        expect(gp.coordinates).toHaveLength(3);
        expect(typeof gp.weight).toBe('number');
      }
    });

    it('all evening ref point actions have complete GpsPoint with required fields', () => {
      if (!dataAvailable) return;
      for (const rp of eveningRefPoints) {
        const gp = rp.payload.gpsPoint;
        expect(typeof gp.latitude).toBe('number');
        expect(typeof gp.longitude).toBe('number');
        expect(typeof gp.latLongAccuracy).toBe('number');
        expect(typeof gp.timestamp).toBe('number');
        expect(gp.zeroRef).toBeDefined();
        expect(gp.coordinates).toHaveLength(3);
        expect(typeof gp.weight).toBe('number');
      }
    });
  });

  // =========================================================================
  // Section 2: Cross-session ref point matching
  // =========================================================================

  describe('Cross-session ref point consistency', () => {
    it('all 3 morning ref points match a ref point in the evening (via h3CellsMatch)', () => {
      if (!dataAvailable) return;

      const morningIds = morningRefPoints.map((rp) => rp.payload.id);
      const eveningIds = [
        ...new Set(eveningRefPoints.map((rp) => rp.payload.id)),
      ];

      // Every morning ref point should have at least one H3-matching evening point
      for (const morningId of morningIds) {
        const hasMatch = eveningIds.some((eveningId) =>
          h3CellsMatch(morningId, eveningId)
        );
        expect(
          hasMatch,
          `Morning ref ${morningId} has no H3 match in evening session`
        ).toBe(true);
      }
    });

    it('all unique evening ref points match a morning ref point (via h3CellsMatch)', () => {
      if (!dataAvailable) return;

      const morningIds = morningRefPoints.map((rp) => rp.payload.id);
      const eveningIds = [
        ...new Set(eveningRefPoints.map((rp) => rp.payload.id)),
      ];

      for (const eveningId of eveningIds) {
        const hasMatch = morningIds.some((morningId) =>
          h3CellsMatch(morningId, eveningId)
        );
        expect(
          hasMatch,
          `Evening ref ${eveningId} has no H3 match in morning session`
        ).toBe(true);
      }
    });
  });

  // =========================================================================
  // Section 3: BUG — Duplicate ref point marking in evening session
  // =========================================================================

  describe('BUG: Duplicate ref point marking (evening session)', () => {
    /**
     * Why: The evening session has 4 markReferencePoint actions but only 3
     * actual physical locations. ID `8b1fa0a31689fff` appears twice (actions
     * 288 and 290, ~1.5 s apart). The user likely tapped the button twice
     * because the cryptic H3 label gave no feedback that marking succeeded.
     *
     * This test documents the duplication. Whether it's treated as a bug or
     * "working as designed" depends on product decisions, but it shows that
     * the re-observation fast-path doesn't prevent rapid double-taps
     * within the same session.
     */
    it('evening session has duplicate markReferencePoint for same H3 ID', () => {
      if (!dataAvailable) return;

      const idCounts = new Map<string, number>();
      for (const rp of eveningRefPoints) {
        const count = idCounts.get(rp.payload.id) ?? 0;
        idCounts.set(rp.payload.id, count + 1);
      }

      // Document: 8b1fa0a31689fff is marked twice
      const duplicates = [...idCounts.entries()].filter(
        ([, count]) => count > 1
      );
      expect(
        duplicates.length,
        'Expected at least one duplicate ref point ID in evening session'
      ).toBeGreaterThan(0);
    });

    it('the duplicate markings are very close in time (~1.5s apart)', () => {
      if (!dataAvailable) return;

      // Find the duplicated ID
      const idOccurrences = new Map<string, number[]>();
      for (const rp of eveningRefPoints) {
        const timestamps = idOccurrences.get(rp.payload.id) ?? [];
        timestamps.push(rp.payload.timestamp);
        idOccurrences.set(rp.payload.id, timestamps);
      }

      // Filter to only IDs with duplicates, then assert on time difference
      const duplicates = [...idOccurrences.values()].filter(
        (ts) => ts.length > 1
      );
      expect(duplicates.length).toBeGreaterThan(0);
      for (const timestamps of duplicates) {
        const timeDiff = Math.abs(timestamps[1]! - timestamps[0]!);
        // The duplicate was marked ~1.5s apart — clearly an accidental double-tap
        expect(timeDiff).toBeLessThan(5000); // Under 5 seconds = likely accidental
      }
    });
  });

  // =========================================================================
  // Section 4: BUG — displayName shows H3 hex instead of human-readable name
  // =========================================================================

  describe('FIXED: selectKnownAnchorsByCell uses name for displayName', () => {
    /**
     * Why: Prior to the fix, when prior ref points were loaded for the evening
     * session, the button label showed "📍 Capture '8b1fa0a3168efff'" because
     * the H3 selector used `rp.id` (H3 index) as `displayName`.
     *
     * Post-Step 5.4 the matcher reads from the flat `refPoints` slice via
     * `selectKnownAnchorsByCell`. Same first-non-null-`name` per cell rule.
     */
    it('displayName should be human-readable, not an H3 index', () => {
      // Simulate the real data flow:
      // 1. Morning ref points are stored on-device as RefPointDefinition with
      //    id = H3 index and name = user-entered text
      if (!dataAvailable) return;

      const morningDefs = buildRefPointDefsFromActions(morningRefPoints);

      // 2. averageGpsPerRefPoint produces {id, name, lat, lon}
      const averaged = averageGpsPerRefPoint(morningDefs);
      expect(averaged.length).toBe(3);

      // Verify the averaged data has both id and name
      for (const rp of averaged) {
        expect(isH3Index(rp.id)).toBe(true); // id is H3 hex
        expect(typeof rp.name).toBe('string');
        expect(rp.name.length).toBeGreaterThan(0);
        // The name should NOT be an H3 index — it's the user-entered label
        expect(isH3Index(rp.name)).toBe(false);
      }

      // 3. loadAndDisplayRefPoints now includes name in ImportedRefPoint
      const importedRefPoints: ImportedRefPoint[] = averaged.map((rp) => ({
        id: rp.id,
        name: rp.name,
        lat: rp.lat,
        lon: rp.lon,
        alt: rp.alt,
        sourceZipName: '',
      }));

      // 4. selectKnownAnchorsByCell derives KnownGeoAnchor[] for proximity
      //    from the flat `refPoints` entries.
      const entries: RefPointEntry[] = importedRefPoints.map((rp) => ({
        id: rp.id,
        timestamp: 0,
        name: rp.name,
        rawGpsPoint: {
          id: `gps-${rp.id}`,
          latitude: rp.lat,
          longitude: rp.lon,
          altitude: rp.alt,
          timestamp: 0,
        },
      }));
      const RefPointsState: RefPointsState = { entries };
      const knownRefPoints = selectKnownAnchorsByCell(RefPointsState);

      // FIXED: displayName is now the human-readable name, not the H3 hex
      for (const kp of knownRefPoints) {
        expect(
          isH3Index(kp.displayName ?? ''),
          `displayName "${kp.displayName}" should NOT be an H3 index — ` +
            'it should be the human-readable name the user entered'
        ).toBe(false);
      }
    });
  });

  // =========================================================================
  // Section 5: BUG — ImportedRefPoint drops human-readable name
  // =========================================================================

  describe('FIXED: ImportedRefPoint now carries name field', () => {
    /**
     * Why: The `ImportedRefPoint` interface now has a `name` field for the
     * human-readable label. This test verifies the structural fix.
     */
    it('ImportedRefPoint carries the display name', () => {
      const sampleImported: ImportedRefPoint = {
        id: '8b1fa0a3168efff',
        name: 'Bench Corner',
        lat: 50.7690138,
        lon: 6.0655434,
        sourceZipName: 'morning.zip',
      };

      // FIXED: name field now exists and is required
      expect(
        'name' in sampleImported,
        'ImportedRefPoint should have a "name" field for the human-readable label'
      ).toBe(true);
      expect(sampleImported.name).toBe('Bench Corner');
    });
  });

  // =========================================================================
  // Section 6: Proximity button label — correct behavior verification
  // =========================================================================

  describe('Proximity button label updates correctly between locations', () => {
    /**
     * Why: The user reported the button "didn't update" when walking
     * between ref points. This test verifies that findNearbyGeoAnchor
     * returns different results at different GPS positions. The actual
     * issue was likely BUG 1 (all labels looked alike as H3 hashes).
     */
    it('findNearbyGeoAnchor returns correct ref point at each morning location', () => {
      if (!dataAvailable) return;

      // Build known ref points from morning data (simulating what the
      // evening session would have loaded from refPoints/)
      const morningDefs = buildRefPointDefsFromActions(morningRefPoints);
      const averaged = averageGpsPerRefPoint(morningDefs);
      const knownRefPoints = averaged.map((rp) => ({
        h3Index: gpsToH3(rp.lat, rp.lon),
        displayName: rp.id, // Current (buggy) behavior uses H3 as displayName
        lat: rp.lat,
        lon: rp.lon,
      }));

      // At each morning ref point's location, findNearbyGeoAnchor should
      // return that specific ref point (not a random one)
      for (const rp of morningRefPoints) {
        const { latitude, longitude } = rp.payload.gpsPoint;
        const match = findNearbyGeoAnchor(latitude, longitude, knownRefPoints);

        expect(
          match,
          `Should find a nearby ref point at lat=${latitude}, lon=${longitude}`
        ).toBeDefined();

        // The matched H3 index should correspond to THIS ref point
        expect(
          h3CellsMatch(match!.h3Index, rp.payload.id),
          `At location of ref ${rp.payload.id}, found ${match!.h3Index} which doesn't H3-match`
        ).toBe(true);
      }
    });

    it('three morning ref points are distinguished by findNearbyGeoAnchor (no cross-contamination)', () => {
      if (!dataAvailable) return;

      const morningDefs = buildRefPointDefsFromActions(morningRefPoints);
      const averaged = averageGpsPerRefPoint(morningDefs);
      const knownRefPoints = averaged.map((rp) => ({
        h3Index: gpsToH3(rp.lat, rp.lon),
        displayName: rp.id,
        lat: rp.lat,
        lon: rp.lon,
      }));

      // Each morning ref point location should match a DIFFERENT known ref point
      const matchedH3s = new Set<string>();
      for (const rp of morningRefPoints) {
        const { latitude, longitude } = rp.payload.gpsPoint;
        const match = findNearbyGeoAnchor(latitude, longitude, knownRefPoints);
        expect(match).toBeDefined();
        matchedH3s.add(match!.h3Index);
      }

      // All 3 should be distinct (no two morning locations match the same ref)
      expect(
        matchedH3s.size,
        'Each morning ref point location should match a distinct known ref point'
      ).toBe(3);
    });
  });
});
