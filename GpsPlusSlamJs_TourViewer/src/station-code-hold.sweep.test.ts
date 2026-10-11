/**
 * The sweep behind `CODE_HOLD_MAX_MS` (`station-guide.ts`; tour kit K4
 * review R1): how long a code lock that the visitor's own GPS disagrees with
 * is held before it finds its station anyway.
 *
 * WHAT IS SIMULATED. The real moved-code check (`createMovedCodeChecks`, D20)
 * on a real viewer store, as `moved-code-check.test.ts` drives it: a visitor
 * walks a small circle (6 m) at one device fix a second for `T_pre` seconds,
 * scans a poster (the pin), and keeps walking; or stands still (0.3 m of
 * sway) after scanning at once. The poster hangs where it was saved, or was
 * moved 40 m. Measured per walk: the seconds after the pin until the check
 * has had its window (`checkHadItsWindow`) and, for the moved poster, until
 * it vetoes the code.
 *
 * WHAT THE HOLD MEANS. A held lock is released (the station is found by its
 * code) at the first of: the check has had its window, or `H` seconds. A
 * moved poster is caught only if the veto comes before `H`.
 *
 * VERDICTS (asserted):
 * - After a minute's walk the check has its window at the first fix after
 *   the pin: a correct poster is held about 1 s, a moved one vetoed then.
 * - A visitor who scans at once (no history) gets the window only after the
 *   rule's 60 s span: the 40 m move is vetoed 60 s after the pin. H = 60 s
 *   ties with the veto (a late fix releases the poster first), 30 or 45 s
 *   release it first; the shipped 75 s keeps 15 s for late or missed
 *   fixes, and 90 s adds only waiting for a visitor who stands still.
 * - A visitor who stands still never gives the check its 2 m of spread: the
 *   hold ends at H, and a moved poster is then found (the residual of
 *   D20's own evidence gate, unchanged by the hold).
 * Parameters it rests on: 1 Hz fixes, the walk's shape, no GPS noise (the
 * move against the rule's 20 m floor is measured on real walks by D20; this
 * sweep is about WHEN the check can decide).
 */

import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { calcGpsCoords, type LatLong } from "gps-plus-slam-app-framework/core";
import {
  gaussMarkovGpsErrors,
  mulberry32,
} from "gps-plus-slam-app-framework/test-utils/integrated-slam-drift";
import {
  recordGpsEvent,
  selectGpsPositions,
  selectOdometryPositions,
  selectZeroReference,
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

import { objectPoseNue } from "./content-placement.js";
import {
  checkHadItsWindow,
  createMovedCodeChecks,
} from "./moved-code-check.js";
import { stationBands } from "./station-bands.js";
import { CODE_HOLD_MAX_MS } from "./station-guide.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

// The geodesy is licence-gated; building a store activates it.
createTourViewerStore();

const ZERO: LatLong = { lat: 47.5, lon: 8.7 };
const T0 = 1_790_000_000_000;
const WORLD_TO_ODOM = new Matrix4()
  .compose(
    new Vector3(30, 0, -12),
    new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      (40 * Math.PI) / 180,
    ),
    new Vector3(1, 1, 1),
  )
  .invert();
const NUE_TO_WEBXR = WEBXR_TO_NUE.clone().invert();
const SAVED = (() => {
  const g = calcGpsCoords(ZERO, [20, 400, 10]);
  return { lat: g.lat, lon: g.lon, alt: 400, headingDeg: 90 };
})();
const LEVEL: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: SAVED,
    mintQuality: { alignmentSampleCount: 300, gpsAccuracyM: 3.5 },
  },
};

function rawOf(world: Matrix4): Pose {
  const m = NUE_TO_WEBXR.clone().multiply(WORLD_TO_ODOM).multiply(world);
  const p = new Vector3();
  const q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
}

/** The poster as the camera sees it: its saved pose moved `eastM`. */
function posterSeen(eastM: number): Pose {
  const saved = objectPoseNue(SAVED, ZERO);
  return rawOf(
    new Matrix4().compose(
      new Vector3(
        saved.positionNue[0],
        saved.positionNue[1],
        saved.positionNue[2] + eastM,
      ),
      new Quaternion(...saved.rotationNue),
      new Vector3(1, 1, 1),
    ),
  );
}

/** A device fix at second `s`, the visitor `radiusM` around [n, e]. */
function fix(
  s: number,
  centre: readonly [number, number],
  radiusM: number,
): RecordGpsEventPayload {
  const a = (2 * Math.PI * s) / 40;
  const n = centre[0] + radiusM * Math.cos(a);
  const e = centre[1] + radiusM * Math.sin(a);
  const g = calcGpsCoords(ZERO, [n, 400, e]);
  return {
    odomPosition: rawOf(new Matrix4().makeTranslation(n, 1.4, e)).position,
    odomRotation: [0, 0, 0, 1],
    rawGpsPoint: {
      id: `gps-${String(s)}`,
      latitude: g.lat,
      longitude: g.lon,
      altitude: 400,
      latLongAccuracy: 4,
      timestamp: T0 + s * 1000,
    },
  };
}

/** Seconds after the pin until the check had its window, and until it
 *  vetoed (null: not within `afterS`). */
function walk(opts: {
  preS: number;
  afterS: number;
  moveM: number;
  radiusM: number;
}): { windowS: number | null; vetoS: number | null } {
  const store = createTourViewerStore();
  store.dispatch(setZeroPos(ZERO));
  const checks = createMovedCodeChecks();
  // The visitor stands at the poster where it hangs now.
  const centre: [number, number] = [20, 10 + opts.moveM];
  const view = () => {
    const st = store.getState();
    return {
      gpsPositions: selectGpsPositions(st),
      odometryPositions: selectOdometryPositions(st),
      zero: selectZeroReference(st),
    };
  };
  for (let s = 0; s < opts.preS; s += 1) {
    store.dispatch(recordGpsEvent(fix(s, centre, opts.radiusM)));
  }
  checks.pin({
    text: "t",
    levelId: "lvl",
    level: LEVEL,
    qrPoseWorld: posterSeen(opts.moveM),
    atMs: T0 + opts.preS * 1000,
    zero: ZERO,
  });
  let windowS: number | null = null;
  let vetoS: number | null = null;
  for (let k = 0; k <= opts.afterS; k += 1) {
    const s = opts.preS + k;
    store.dispatch(recordGpsEvent(fix(s, centre, opts.radiusM)));
    if (checks.update(view(), T0 + s * 1000).length > 0) {
      vetoS = k;
      windowS ??= k;
      break;
    }
    const live = checks.snapshot()[0];
    if (windowS === null && live !== undefined && checkHadItsWindow(live)) {
      windowS = k;
    }
  }
  return { windowS, vetoS };
}

/** `STATION_CODE_HOLD_SWEEP_OUT=<file>` writes the measured walks. */
const OUT = process.env["STATION_CODE_HOLD_SWEEP_OUT"];
const table: string[] = [];
const logged = (name: string, r: ReturnType<typeof walk>) => {
  table.push(
    `${name}: window ${String(r.windowS)} s, veto ${String(r.vetoS)} s`,
  );
  return r;
};

/** Whether a moved poster is vetoed before a hold of `holdS` releases it. */
const caught = (vetoS: number | null, holdS: number) =>
  vetoS !== null && vetoS < holdS;

afterAll(() => {
  if (OUT !== undefined) writeFileSync(OUT, table.join("\n") + "\n");
});

// Each fix is a full re-solve in the store's reducer: seconds, not ms.
describe("code hold sweep (K4 review R1)", { timeout: 60_000 }, () => {
  it("after a minute's walk the check has its window at the first fix; a moved poster is vetoed then", () => {
    const right = logged(
      "walk 60 s, right",
      walk({ preS: 60, afterS: 5, moveM: 0, radiusM: 6 }),
    );
    const moved = logged(
      "walk 60 s, moved 40 m",
      walk({ preS: 60, afterS: 5, moveM: 40, radiusM: 6 }),
    );
    expect(right.windowS).toBeLessThanOrEqual(1);
    expect(right.vetoS).toBeNull();
    expect(moved.vetoS).toBeLessThanOrEqual(1);
  });

  it("scanning at once: the window comes at the rule's 60 s span, so the shipped 75 s catches the move and 60 s or less would not", () => {
    const right = logged(
      "scan at once, right",
      walk({ preS: 0, afterS: 70, moveM: 0, radiusM: 6 }),
    );
    const moved = logged(
      "scan at once, moved 40 m",
      walk({ preS: 0, afterS: 70, moveM: 40, radiusM: 6 }),
    );
    expect(right.windowS).toBeGreaterThanOrEqual(59);
    expect(right.windowS).toBeLessThanOrEqual(61);
    const holdS = CODE_HOLD_MAX_MS / 1000;
    expect(holdS).toBe(75);
    expect(caught(moved.vetoS, holdS)).toBe(true);
    expect(caught(moved.vetoS, 90)).toBe(true);
    for (const shorter of [30, 45, 60]) {
      expect(caught(moved.vetoS, shorter)).toBe(false);
    }
  });

  it("standing still the check never has its 2 m of spread: the hold ends at H", () => {
    const still = logged(
      "standing still, moved 40 m",
      walk({ preS: 0, afterS: 70, moveM: 40, radiusM: 0.3 }),
    );
    expect(still.windowS).toBeNull();
    expect(still.vetoS).toBeNull();
  });
});

/**
 * The other side of the hold: how often a CORRECT poster is held at all,
 * i.e. how often the latest raw fix of a visitor standing at the station
 * lies beyond its activation radius. Raw phone noise (the bands sweep's
 * `raw` model: the reported accuracy read as a 68 % radius, wander 0.60,
 * white 0.30, 20 s), accuracy 3-20 m, authored activation radius 10-30 m
 * (found radius 5 m), 120 visitors x 60 s each. Such a hold lasts until
 * the check's window (about 1 s after a walk, 60 s scanning at once), at
 * most 75 s. Reversed by real raw noise well above the model, or by an
 * activation radius authored below about twice the accuracy (the bands
 * floor it at the found radius plus one band).
 */
describe("correct posters held (K4 review R1)", () => {
  it("at most 2 % of scans at a correct poster are held, in every cell (measured: at most 0.6 %)", () => {
    for (const acc of [3, 5, 8, 12, 20]) {
      for (const authored of [10, 20, 30]) {
        const { activateM } = stationBands(
          { activateRadiusM: authored, foundRadiusM: 5 },
          acc,
        );
        let held = 0;
        let scans = 0;
        for (let seed = 0; seed < 120; seed += 1) {
          const errors = gaussMarkovGpsErrors(
            mulberry32(seed * 7907 + 11),
            60,
            acc,
            {
              wanderFrac: 0.6,
              whiteFrac: 0.3,
              tauS: 20,
            },
          );
          for (const [n, e] of errors) {
            scans += 1;
            if (Math.hypot(n, e) > activateM) held += 1;
          }
        }
        table.push(
          `correct poster held: acc ${String(acc)} authored ${String(authored)} (activate ${String(activateM)}): ${((held / scans) * 100).toFixed(2)} %`,
        );
        expect(held / scans).toBeLessThanOrEqual(0.02);
      }
    }
  });
});
