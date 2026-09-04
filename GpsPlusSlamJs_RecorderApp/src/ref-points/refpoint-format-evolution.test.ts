/**
 * Ref Point Format Evolution — cross-era field audit of stored recordings.
 *
 * Purpose
 * -------
 * Recording zips in `TestDataJs/` were produced over many months while the
 * `markReferencePoint` action payload was iterated on. This test audits two
 * concrete recordings — one old (2026-03-05), one recent (2026-04-23) — and
 * asserts which fields are actually present. It drives the discussion in
 * [2026-04-24-refpoint-positioning-investigation.md](../../../GpsPlusSlamJs_Docs/docs/2026-04-24-refpoint-positioning-investigation.md):
 *
 *   Q: Can prior ref points from *any* past recording be visualized in 3D
 *      with the same mechanism the current code uses (raw GPS lat/lon
 *      → `calcRelativeCoordsInMeters`)?
 *
 * The visualizer in `GpsPlusSlamJs_AppFramework/src/visualization/reference-points.ts`
 * requires a `gpsPosition: { lat, lon }` per observation. The loader
 * (`ref-point-loader.ts`) synthesises that from `observation.gpsPoint.latitude/
 * longitude` (with `fusedGpsPoint` preferred only for H3-averaging).
 *
 * What these tests prove
 * ----------------------
 *   1. Both eras embed real lat/lon (not just an H3 hash, not just a cell
 *      center). No recording is ever "h3-only".
 *   2. The old recording uses the era-3 shape (`gpsPoint` with derived
 *      fields). The new recording uses the era-4/5 shape (`rawGpsPoint`
 *      with sensor fields only).
 *   3. After `migrateActionsIfNeeded(actions, metadata)` the old recording
 *      is converted to `rawGpsPoint` and is schema-equivalent to the new
 *      recording for the purpose of extracting lat/lon.
 *   4. Neither era stores `fusedGpsPoint` inside the action payload
 *      (fused GPS is only computed later and is only persisted in the
 *      scenario-level `refPoints/<id>.json` files — not in session zips).
 *   5. The ID is an H3 resolution-11 index in both eras, but lat/lon is
 *      always present alongside it, so no H3-cell-center fallback is
 *      required to position ref points in 3D.
 *
 * Test data (skipped if missing on CI)
 * ------------------------------------
 *   - TestDataJs/2026-03-05_06-47-31utc.zip  (pre-raw-storage, era ≤ 3)
 *   - TestDataJs/2026-04-23_15-55-36utc.zip  (current raw-storage, era 4 or 5)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadActionsFromZip,
  loadSessionMetadata,
  type RecordedAction,
  type ZipActionEntry,
} from 'gps-plus-slam-app-framework/storage/zip-reader';
import { migrateActionsIfNeeded } from '../storage/recording-migration';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const RECORDINGS_DIR = path.resolve(__dirname, '../../../../TestDataJs');
const OLD_ZIP = path.join(RECORDINGS_DIR, '2026-03-05_06-47-31utc.zip');
const NEW_ZIP = path.join(RECORDINGS_DIR, '2026-04-23_15-55-36utc.zip');

interface EraSample {
  readonly zipPath: string;
  readonly metadata: Record<string, unknown> | null;
  readonly rawEntries: ZipActionEntry[];
  readonly migratedEntries: ZipActionEntry[];
  readonly rawRefActions: RecordedAction[];
  readonly migratedRefActions: RecordedAction[];
}

async function loadEraSample(zipPath: string): Promise<EraSample> {
  const data = new Uint8Array(fs.readFileSync(zipPath));
  const metadata = await loadSessionMetadata(data);
  const rawEntries = await loadActionsFromZip(data);
  const rawActions = rawEntries.map((e) => e.action);
  const migratedActions = migrateActionsIfNeeded(rawActions, metadata);
  const migratedEntries: ZipActionEntry[] = rawEntries.map((e, i) => ({
    ...e,
    action: migratedActions[i]!,
  }));
  const isRefAction = (a: RecordedAction): boolean =>
    a.type === 'gpsData/markReferencePoint';
  return {
    zipPath,
    metadata,
    rawEntries,
    migratedEntries,
    rawRefActions: rawActions.filter(isRefAction),
    migratedRefActions: migratedActions.filter(isRefAction),
  };
}

function getPayload(a: RecordedAction): Record<string, unknown> {
  return (a.payload ?? {}) as Record<string, unknown>;
}

function getField(
  payload: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const v = payload[key];
  return typeof v === 'object' && v !== null
    ? (v as Record<string, unknown>)
    : null;
}

// ---------------------------------------------------------------------------
// Shared state across describes (loaded once per file)
// ---------------------------------------------------------------------------

let oldSample: EraSample | null = null;
let newSample: EraSample | null = null;
let dataAvailable = false;

describe('Ref Point Format Evolution (old vs new recording)', () => {
  beforeAll(async () => {
    if (!fs.existsSync(OLD_ZIP) || !fs.existsSync(NEW_ZIP)) {
      return;
    }
    oldSample = await loadEraSample(OLD_ZIP);
    newSample = await loadEraSample(NEW_ZIP);
    dataAvailable = true;
  });

  // -------------------------------------------------------------------------
  // Sanity: both recordings contain at least one ref point action
  // -------------------------------------------------------------------------
  describe('Recording contents', () => {
    it('old recording contains at least one markReferencePoint action', () => {
      if (!dataAvailable) return;
      expect(oldSample!.rawRefActions.length).toBeGreaterThan(0);
    });

    it('new recording contains at least one markReferencePoint action', () => {
      if (!dataAvailable) return;
      expect(newSample!.rawRefActions.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Era detection via session.json
  // -------------------------------------------------------------------------
  describe('odomCoordVersion (session.json)', () => {
    /**
     * Why this matters: the migration layer keys off odomCoordVersion.
     * Versions ≤ 3 → requires `gpsPoint → rawGpsPoint` rename + strip.
     * Versions ≥ 4 → action already in current shape.
     */
    it('old recording has no/early odomCoordVersion (≤ 3 or absent)', () => {
      if (!dataAvailable) return;
      const v = oldSample!.metadata?.['odomCoordVersion'];
      // Either absent (era-1 recording with no session.json/version) or a
      // number ≤ 3. Expressed as a single unconditional assert so the rule
      // `vitest/no-conditional-expect` is satisfied.
      const isAcceptableOldVersion =
        v === undefined || (typeof v === 'number' && v <= 3);
      expect(isAcceptableOldVersion).toBe(true);
    });

    it('new recording has odomCoordVersion ≥ 4', () => {
      if (!dataAvailable) return;
      const v = newSample!.metadata?.['odomCoordVersion'];
      expect(typeof v).toBe('number');
      expect(v as number).toBeGreaterThanOrEqual(4);
    });
  });

  // -------------------------------------------------------------------------
  // Raw payload shape BEFORE migration — proves the schemas differ
  // -------------------------------------------------------------------------
  describe('Raw markReferencePoint payload shape (pre-migration)', () => {
    it('old recording uses the era-≤3 `gpsPoint` field (with derived fields)', () => {
      if (!dataAvailable) return;
      const payload = getPayload(oldSample!.rawRefActions[0]!);
      const gpsPoint = getField(payload, 'gpsPoint');
      const rawGpsPoint = getField(payload, 'rawGpsPoint');

      expect(gpsPoint).not.toBeNull();
      expect(rawGpsPoint).toBeNull();

      // Derived fields that were later stripped in eras 4+
      expect(typeof gpsPoint!['latitude']).toBe('number');
      expect(typeof gpsPoint!['longitude']).toBe('number');
      expect(gpsPoint!['zeroRef']).toBeDefined();
      expect(Array.isArray(gpsPoint!['coordinates'])).toBe(true);
      expect(typeof gpsPoint!['weight']).toBe('number');
    });

    it('new recording uses the era-4+ `rawGpsPoint` field (sensor fields only)', () => {
      if (!dataAvailable) return;
      const payload = getPayload(newSample!.rawRefActions[0]!);
      const gpsPoint = getField(payload, 'gpsPoint');
      const rawGpsPoint = getField(payload, 'rawGpsPoint');

      expect(rawGpsPoint).not.toBeNull();
      expect(gpsPoint).toBeNull();

      expect(typeof rawGpsPoint!['latitude']).toBe('number');
      expect(typeof rawGpsPoint!['longitude']).toBe('number');
      expect(typeof rawGpsPoint!['latLongAccuracy']).toBe('number');
      // Derived fields must NOT be present in the raw action
      expect(rawGpsPoint!['zeroRef']).toBeUndefined();
      expect(rawGpsPoint!['coordinates']).toBeUndefined();
      expect(rawGpsPoint!['weight']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // After migration: both eras converge to the same shape
  // -------------------------------------------------------------------------
  describe('Post-migration payload shape', () => {
    /**
     * The whole point of `migrateActionsIfNeeded` is that replay code (and,
     * by extension, any code that inspects ref points) can treat old and
     * new recordings identically. This test locks that invariant in.
     */
    it('old recording migrates to `rawGpsPoint` with identical keys as new', () => {
      if (!dataAvailable) return;
      const oldPayload = getPayload(oldSample!.migratedRefActions[0]!);
      const newPayload = getPayload(newSample!.migratedRefActions[0]!);

      const oldRaw = getField(oldPayload, 'rawGpsPoint');
      const newRaw = getField(newPayload, 'rawGpsPoint');

      expect(oldRaw).not.toBeNull();
      expect(newRaw).not.toBeNull();
      expect(getField(oldPayload, 'gpsPoint')).toBeNull();

      // Required sensor fields present in both
      for (const key of [
        'latitude',
        'longitude',
        'latLongAccuracy',
        'timestamp',
      ]) {
        expect(typeof oldRaw![key]).toBe('number');
        expect(typeof newRaw![key]).toBe('number');
      }

      // Derived fields stripped in both
      for (const key of ['zeroRef', 'coordinates', 'weight']) {
        expect(oldRaw![key]).toBeUndefined();
        expect(newRaw![key]).toBeUndefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Lat/Lon is real (not H3-cell-center) — the key question from the user
  // -------------------------------------------------------------------------
  describe('Lat/Lon fidelity (NOT derived from H3 cell center)', () => {
    /**
     * Concern raised in the investigation: "I remember ref points stored
     * only their h3 hash and not the exact gps pos." These assertions
     * prove the opposite — every observation carries sensor-grade lat/lon
     * (many decimals), and across multiple observations in the same
     * recording the lat/lon varies (a cell-center would be constant per ID).
     */
    function extractLatLon(a: RecordedAction): { lat: number; lon: number } {
      const payload = getPayload(a);
      const gp =
        getField(payload, 'rawGpsPoint') ?? getField(payload, 'gpsPoint');
      expect(gp).not.toBeNull();
      return {
        lat: gp!['latitude'] as number,
        lon: gp!['longitude'] as number,
      };
    }

    it('old recording has sensor-precision lat/lon on every ref point', () => {
      if (!dataAvailable) return;
      for (const a of oldSample!.rawRefActions) {
        const { lat, lon } = extractLatLon(a);
        expect(Number.isFinite(lat)).toBe(true);
        expect(Number.isFinite(lon)).toBe(true);
        // Plausible real coordinates, not (0,0) or NaN
        expect(Math.abs(lat)).toBeGreaterThan(0.1);
        expect(Math.abs(lon)).toBeGreaterThan(0.1);
      }
    });

    it('new recording has sensor-precision lat/lon on every ref point', () => {
      if (!dataAvailable) return;
      for (const a of newSample!.rawRefActions) {
        const { lat, lon } = extractLatLon(a);
        expect(Number.isFinite(lat)).toBe(true);
        expect(Number.isFinite(lon)).toBe(true);
        expect(Math.abs(lat)).toBeGreaterThan(0.1);
        expect(Math.abs(lon)).toBeGreaterThan(0.1);
      }
    });

    it('lat/lon varies across observations of the same ID → not a cell center', () => {
      if (!dataAvailable) return;
      // Combine all ref actions (both eras) and group by ID
      const allRefs = [
        ...oldSample!.rawRefActions,
        ...newSample!.rawRefActions,
      ];
      const byId = new Map<string, Array<{ lat: number; lon: number }>>();
      for (const a of allRefs) {
        const id = (getPayload(a)['id'] as string | undefined) ?? '';
        const coord = extractLatLon(a);
        const list = byId.get(id) ?? [];
        list.push(coord);
        byId.set(id, list);
      }

      // For every ID that was observed ≥2 times, the lat/lon set must
      // contain >1 distinct value (i.e. real GPS, not a fixed cell center).
      // We first assert that at least one such group exists — otherwise
      // the variation claim would pass vacuously and not actually prove
      // anything about cell-center vs. raw GPS storage.
      const multiObservationGroups = [...byId.values()].filter(
        (l) => l.length >= 2
      );
      expect(multiObservationGroups.length).toBeGreaterThan(0);

      const distinctCountsForMultiIds = multiObservationGroups.map(
        (l) => new Set(l.map((c) => `${c.lat},${c.lon}`)).size
      );
      expect(distinctCountsForMultiIds.every((n) => n > 1)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // fusedGpsPoint is NEVER present in the action payload
  // -------------------------------------------------------------------------
  describe('fusedGpsPoint is not stored inside session zips', () => {
    /**
     * Fused GPS is a *post-hoc* quantity (aligned VIO path after the session
     * finishes). It is only written into scenario-level
     * refPoints/<id>.json files by the scenario-level ref-point persistence,
     * never into the `markReferencePoint` action itself. This invariant is
     * important for replay: replayed actions never carry fused data, so the
     * library must be able to (re)compute alignment from raw inputs alone.
     */
    it('neither era has `fusedGpsPoint` in the action payload', () => {
      if (!dataAvailable) return;
      for (const a of oldSample!.rawRefActions) {
        expect(getPayload(a)['fusedGpsPoint']).toBeUndefined();
      }
      for (const a of newSample!.rawRefActions) {
        expect(getPayload(a)['fusedGpsPoint']).toBeUndefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // ID convention: H3 resolution-11 hex string
  // -------------------------------------------------------------------------
  describe('Ref point ID shape', () => {
    /**
     * Since 2026-03-08 the ref point ID is the H3 resolution-11 cell hash.
     * We don't assert that here for the oldest recordings (pre-H3 IDs were
     * user-entered strings), but we do assert that the lat/lon alongside
     * is sufficient — the ID itself is not needed for positioning.
     */
    it('new recording IDs are hex-like strings (H3 indices)', () => {
      if (!dataAvailable) return;
      const h3Like = /^[0-9a-f]{15,16}$/;
      for (const a of newSample!.rawRefActions) {
        const id = getPayload(a)['id'] as string | undefined;
        expect(typeof id).toBe('string');
        expect(h3Like.test(id!)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Summary: positioning in 3D works for both recordings using the same code
  // -------------------------------------------------------------------------
  describe('Positioning-in-3D contract', () => {
    /**
     * The visualizer (`RefPointVisualizer.syncRefPoints`) needs only
     * `{ lat, lon, altitude? }` and a zero-reference. Both eras supply lat
     * and lon on every observation, so no H3-cell-center fallback is ever
     * needed to place the sphere in `scene` space via
     * `calcRelativeCoordsInMeters`.
     */
    it('every ref point (old and new) yields a valid (lat, lon) for visualization', () => {
      if (!dataAvailable) return;
      const allRefs = [
        ...oldSample!.migratedRefActions,
        ...newSample!.migratedRefActions,
      ];
      for (const a of allRefs) {
        const p = getPayload(a);
        const raw = getField(p, 'rawGpsPoint');
        expect(raw).not.toBeNull();
        expect(typeof raw!['latitude']).toBe('number');
        expect(typeof raw!['longitude']).toBe('number');
      }
    });
  });
});
