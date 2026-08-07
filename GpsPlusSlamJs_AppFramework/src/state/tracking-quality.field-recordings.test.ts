/**
 * Integration test — reproduces field-test findings from recorded sessions.
 *
 * See [2026-05-23-tracking-quality-hud-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-23-tracking-quality-hud-user-feedback.md)
 * §3 for the full plan. This test loads two real field-test recordings,
 * replays them through a production-shaped `createSlamAppStore`, and
 * asserts the observations documented in Findings 1–4 are reproducible.
 *
 * Why this test matters:
 *   - It is the executable spec for "fixed" — after each fix lands the
 *     relevant assertion flips green.
 *   - It documents that the recordings omit `tracking/poseReceived`
 *     (only `gpsData/recordGpsEvent` is persisted) and therefore we must
 *     synthesise pose actions from the bundled `odomPosition`/`odomRotation`
 *     to drive the §4.7 phase gate during replay.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadActionsFromZip, type ZipActionEntry } from '../storage/zip-reader';
import { createSlamAppStore, type SlamAppStore } from './create-slam-app-store';
import { NullStorageBackend } from '../storage/null-storage-backend';
import {
  selectTrackingQuality,
  DEFAULT_TRACKING_QUALITY_OPTIONS,
} from './tracking-quality';
import { poseReceived } from './tracking-slice';
import type { TrackingQualityReport } from './tracking-quality';

// Convergence fail threshold for translation is derived as `warn × 4`
// (see `transFail = transWarn * 4` in computeConvergence). Deriving it here
// keeps this test in sync with the default if `convergenceTranslationWarnM`
// is ever re-tuned, instead of silently drifting from a hardcoded literal.
const TRANSLATION_FAIL_M =
  DEFAULT_TRACKING_QUALITY_OPTIONS.convergenceTranslationWarnM * 4;

// Same derivation for the rotation axis (`rotFail = rotWarn * 4`, 24° today).
// `rampDown` returns exactly 0 at or above this value, so "ΣΔrot ≥ ROTATION_FAIL_DEG"
// IS the production definition of a broken-alignment recording.
const ROTATION_FAIL_DEG =
  DEFAULT_TRACKING_QUALITY_OPTIONS.convergenceRotationWarnDeg * 4;

// ---------------------------------------------------------------------------
// Fixtures — resolved relative to the workspace root, where both
// TestDataJs/ and TestDataJs-Other/ live alongside location-based-webxr/.
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Walk from src/state/ up to the multi-root workspace parent.
// Layout: <gpsRoot>/location-based-webxr/GpsPlusSlamJs_AppFramework/src/state/
//         <gpsRoot>/gps-plus-slam/TestDataJs/...
// So: ../../../.. lands at <gpsRoot>.
const GPS_ROOT = resolve(__dirname, '../../../..');
const TEST_DATA_ROOT = resolve(GPS_ROOT, 'gps-plus-slam');

interface Fixture {
  readonly label: string;
  readonly path: string;
}

const OUTDOOR: Fixture = {
  label: 'outdoorWalking',
  path: resolve(TEST_DATA_ROOT, 'TestDataJs/2026-05-19_15-43-55utc.zip'),
};
const INDOOR: Fixture = {
  label: 'indoorStationary',
  path: resolve(
    TEST_DATA_ROOT,
    'TestDataJs-Other/2026-05-23_03-01-11utc-indoor-without-moving.zip'
  ),
};

const fixturesAvailable = existsSync(OUTDOOR.path) && existsSync(INDOOR.path);

// ---------------------------------------------------------------------------
// Replay helper — drives a store through every recorded action and captures
// `selectTrackingQuality(state)` at fixed GPS-observation indices.
//
// Pose synthesis: each `gpsData/recordGpsEvent` payload carries
// `odomPosition` / `odomRotation` / `rawDeviceOrientation` — the AR
// pose stream that the recorder does not persist as a separate action.
// We dispatch a synthetic `tracking/poseReceived` immediately before the
// GPS event so the phase gate (§4.7) sees `tracking.phase === 'tracking'`
// during replay, matching live runtime behaviour.
// ---------------------------------------------------------------------------

interface RecordGpsPayload {
  odomPosition: [number, number, number];
  odomRotation: [number, number, number, number];
  rawDeviceOrientation: {
    alpha: number;
    beta: number;
    gamma: number;
    absolute: boolean;
  };
}

function isRecordGpsPayload(value: unknown): value is RecordGpsPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.odomPosition) &&
    Array.isArray(v.odomRotation) &&
    typeof v.rawDeviceOrientation === 'object' &&
    v.rawDeviceOrientation !== null
  );
}

interface Snapshot {
  /** GPS observation index at which the snapshot was captured (1-based). */
  readonly atGpsObs: number;
  /** Total replayed actions so far. */
  readonly atActionIndex: number;
  readonly report: TrackingQualityReport;
}

interface ReplayResult {
  readonly snapshots: readonly Snapshot[];
  readonly finalGpsObsCount: number;
  readonly finalActionCount: number;
  readonly finalReport: TrackingQualityReport | null;
}

const SAMPLE_GPS_INDICES = [1, 10, 30, 60, 75, 120, 240];

function replay(
  store: SlamAppStore,
  actions: readonly ZipActionEntry[]
): ReplayResult {
  const snapshots: Snapshot[] = [];
  const remainingSamples = new Set(SAMPLE_GPS_INDICES);
  let gpsObsCount = 0;

  for (let i = 0; i < actions.length; i++) {
    const entry = actions[i];
    if (!entry) continue;
    const action = entry.action;

    if (
      action.type === 'gpsData/recordGpsEvent' &&
      isRecordGpsPayload(action.payload)
    ) {
      const p = action.payload;
      // Synthetic pose dispatch — see header comment. Driving `tracking.phase`
      // away from 'initializing' is the only way the phase gate ever exits
      // 'ar-lost' during replay.
      store.dispatch(
        poseReceived({
          pose: {
            position: {
              x: p.odomPosition[0],
              y: p.odomPosition[1],
              z: p.odomPosition[2],
            },
            orientation: {
              x: p.odomRotation[0],
              y: p.odomRotation[1],
              z: p.odomRotation[2],
              w: p.odomRotation[3],
            },
          },
          sensorOrientation: { ...p.rawDeviceOrientation },
        })
      );
    }

    store.dispatch(action);

    if (action.type === 'gpsData/recordGpsEvent') {
      gpsObsCount += 1;
      if (remainingSamples.has(gpsObsCount)) {
        const report = selectTrackingQuality(store.getState());
        if (report) {
          snapshots.push({
            atGpsObs: gpsObsCount,
            atActionIndex: i + 1,
            report,
          });
          remainingSamples.delete(gpsObsCount);
        }
      }
    }
  }

  const finalReport = selectTrackingQuality(store.getState());
  return {
    snapshots,
    finalGpsObsCount: gpsObsCount,
    finalActionCount: actions.length,
    finalReport,
  };
}

async function loadFixture(fx: Fixture): Promise<readonly ZipActionEntry[]> {
  const bytes = new Uint8Array(readFileSync(fx.path));
  return loadActionsFromZip(bytes);
}

function makeStore(): SlamAppStore {
  return createSlamAppStore({ storageBackend: new NullStorageBackend() });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.runIf(fixturesAvailable)(
  'tracking-quality field recordings (§3)',
  () => {
    let outdoorResult: ReplayResult;
    let indoorResult: ReplayResult;

    beforeAll(async () => {
      const [outdoorActions, indoorActions] = await Promise.all([
        loadFixture(OUTDOOR),
        loadFixture(INDOOR),
      ]);
      outdoorResult = replay(makeStore(), outdoorActions);
      indoorResult = replay(makeStore(), indoorActions);
    }, 60_000);

    describe('replay sanity', () => {
      it('outdoor recording produces multiple GPS observations', () => {
        // Why: if this fails, every downstream assertion is meaningless —
        // the recording was empty or the action types changed.
        expect(outdoorResult.finalGpsObsCount).toBeGreaterThan(200);
        expect(outdoorResult.snapshots.length).toBeGreaterThanOrEqual(5);
      });

      it('indoor recording produces multiple GPS observations', () => {
        expect(indoorResult.finalGpsObsCount).toBeGreaterThan(30);
        expect(indoorResult.snapshots.length).toBeGreaterThanOrEqual(3);
      });

      it('final report exists for both recordings', () => {
        expect(outdoorResult.finalReport).not.toBeNull();
        expect(indoorResult.finalReport).not.toBeNull();
      });
    });

    describe('F1 — badge state after enough observations (phase gate)', () => {
      it('outdoor: with synthesised poseReceived, mid-session state is NOT ar-lost', () => {
        // Why: confirms the §4.7 phase gate flips when poses arrive.
        // Failing baseline (live field bug) was state stuck at 'ar-lost'.
        // With synthetic poses replay should reach 'warming-up', 'degraded',
        // or 'ok' — anything but 'ar-lost'. If still 'ar-lost', the bug is
        // in the aggregator itself (root cause B/C in Finding 1).
        const mid = outdoorResult.snapshots.find((s) => s.atGpsObs >= 60);
        expect(mid).toBeDefined();
        expect(mid!.report.state).not.toBe('ar-lost');
      });

      it('outdoor: confidence at gpsObs=120 is meaningfully > 0', () => {
        // Why: after 120 GPS observations on a walking trajectory, the
        // aggregator should produce a usable confidence. A value of 0 would
        // mean the aggregator forced ar-lost despite a valid phase.
        const s = outdoorResult.snapshots.find((s) => s.atGpsObs === 120);
        expect(s).toBeDefined();
        expect(s!.report.confidence).toBeGreaterThan(0);
      });
    });

    describe('F6 — sum-based convergence calibration (2026-05-23 re-tune)', () => {
      it('outdoor: smoothed convergence ≥ 0.8 from gpsObs=60 onward', () => {
        // Why: the F6 acceptance bar (§3.4 of the feedback doc).
        // Calibrated against this exact recording on 2026-05-23 — see
        // computeConvergence() comment in tracking-quality.ts. Failure
        // here means either the thresholds drifted or the outdoor
        // recording started behaving differently (in which case
        // re-run the diagnostic dump in the F6 §5 item 1 doc).
        const samples = outdoorResult.snapshots.filter((s) => s.atGpsObs >= 60);
        expect(samples.length).toBeGreaterThanOrEqual(3);
        for (const s of samples) {
          expect(
            s.report.subScores.convergence,
            `outdoor gpsObs=${s.atGpsObs} conv=${s.report.subScores.convergence}`
          ).toBeGreaterThanOrEqual(0.8);
        }
      });

      it('outdoor: steady-state translation sum stays ≤ translationFailM', () => {
        // Why: pins the empirical fact that outdoor steady walking
        // keeps ΣΔpos comfortably under the fail threshold
        // (TRANSLATION_FAIL_M = convergenceTranslationWarnM × 4 = 8 m today).
        // If this fires, normal walking is being misclassified as a
        // failure — i.e. the threshold is too tight, not too loose.
        const lateSamples = outdoorResult.snapshots.filter(
          (s) => s.atGpsObs >= 120
        );
        for (const s of lateSamples) {
          expect(s.report.diagnostics.recentSumTranslationDeltaM).toBeLessThan(
            TRANSLATION_FAIL_M
          );
        }
      });

      it('indoor: rotation sum captures broken alignment', () => {
        // Why: confirms rotation is the load-bearing axis on indoor
        // stationary recordings (translation stays mute because the
        // user isn't walking).
        //
        // The bound is DERIVED from the production fail threshold, not
        // hand-picked. "Broken alignment" is not a number this test gets to
        // invent — it is `sumRotDeg >= rotFail`, the point where rampDown
        // pins the rotation score at 0 and (via `min`) the whole convergence
        // sub-score with it. Asserting the derived value is what makes the
        // second expectation below a consequence rather than a coincidence.
        //
        // History — why this is NOT a loosened assertion (2026-07-27): the
        // bound used to be a hardcoded 50°, chosen in 2026-05 as a fraction
        // of the 132.9° this recording then produced. The promoted alignment
        // defaults (primary repo `1e90951a4` + `a3525a0e6`) improved it to
        // 28.09°, which is still ABOVE the 24° fail threshold — the recording
        // is still broken by the product's own definition; only the arbitrary
        // literal had gone stale. Sibling `TRANSLATION_FAIL_M` above has
        // always been derived this way; the rotation axis had been missed.
        // See GpsPlusSlamJs_Docs/docs/2026-07-27-2210-tracking-quality-f6-recalibration-followup.md
        //
        // Headroom warning: the margin is now 1.17× (28.09 / 24), down from
        // 5.5×. If a future alignment improvement drops this recording below
        // 24°, do NOT lower the threshold — the correct response is a fixture
        // that is still genuinely broken.
        expect(
          indoorResult.finalReport!.diagnostics.recentSumRotationDeltaDeg
        ).toBeGreaterThan(ROTATION_FAIL_DEG);
        expect(indoorResult.finalReport!.subScores.convergence).toBeLessThan(
          0.2
        );
      });
    });

    describe('F4 — indoor stationary pathology', () => {
      it('final snapshot: high residualConsensus despite low coverage', () => {
        // Why: confirms Finding 4 (part 1). Stationary user → odometry
        // deltas ≈ 0 → median residual is near-zero by coincidence → sub-score
        // ≈ 1.0. Coverage stays low because walked distance ≈ 0. This is the
        // "Resid: 96% / Coverage: 0%" pairing the user flagged as misleading.
        const final = indoorResult.finalReport!;
        expect(final.subScores.coverage).toBeLessThan(0.2);
        expect(final.subScores.residualConsensus).toBeGreaterThan(0.8);
      });

      it('convergence sub-score is stable across the indoor session (EMA smoothing, Finding 4)', () => {
        // Why: confirms Finding 4 fix. Before EMA smoothing the
        // convergence sub-score jumped because the alignment matrix can
        // briefly coincide across two snapshots (tiny deltas) before
        // diverging again, flashing the HUD. EMA blending (α=0.3,
        // §4.8b) damps these single-frame spikes; the visible range over
        // the indoor recording must now stay below 0.2. If this fails
        // because the range crept back up, look for a regression in the
        // smoothing wiring (slice field, listener dispatch, or the
        // emaBlend call in computeTrackingQualityReport).
        const values = indoorResult.snapshots.map(
          (s) => s.report.subScores.convergence
        );
        values.push(indoorResult.finalReport!.subScores.convergence);
        const range = Math.max(...values) - Math.min(...values);
        expect(range).toBeLessThan(0.2);
      });
    });
  }
);

describe.runIf(!fixturesAvailable)(
  'tracking-quality field recordings (§3) — fixtures missing',
  () => {
    it('skipped — recordings not present at expected paths', () => {
      // Why: tests must skip gracefully when the (gitignored) recordings
      // are not in the workspace. They live outside the npm-published
      // package — see §3.1 of the user-feedback doc.
      expect(true).toBe(true);
    });
  }
);
