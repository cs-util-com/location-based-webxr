/**
 * Why this test matters (frame-hitch plan 2026-10-03-2017 §4.2): the
 * recorder's runs compare only if every run flies the same altitudes. The
 * time-driven path (a real phone) zooms at a constant speed in the
 * logarithm of the altitude, down and back up, with a settle at each end;
 * the frame-stepped path (SwiftShader) takes a fixed step per FRAME, so a
 * 300 ms frame and a 7 ms frame see the same sequence; and it holds at the
 * plan's settle checkpoints. These laws are checked here, exactly, so a
 * run's altitudes are a function of time or frame index alone.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { exaggerationAt } from "./globe-flight.js";
import {
  PERF_CHECKPOINTS_KM,
  PERF_E_CHECK_KM,
  PERF_PATH,
  PERF_PLACES,
  perfStepPath,
  perfWheelDeltaY,
  perfZoomAltitudeM,
  perfZoomDurationMs,
} from "./globe-perf-path.js";

describe("PERF_PLACES", () => {
  it("are the plan's four places", () => {
    expect(PERF_PLACES.map((p) => p.id)).toEqual([
      "ocean",
      "alps",
      "pole",
      "city",
    ]);
    const at = Object.fromEntries(PERF_PLACES.map((p) => [p.id, p]));
    expect([at.ocean!.lat, at.ocean!.lng]).toEqual([0, -160]);
    expect([at.alps!.lat, at.alps!.lng]).toEqual([46.5, 9.0]);
    expect([at.pole!.lat, at.pole!.lng]).toEqual([82, -40]);
    expect([at.city!.lat, at.city!.lng]).toEqual([40.7, -74.0]);
  });
});

describe("perfZoomAltitudeM, the time-driven path", () => {
  const opts = { decadesPerS: 0.5 };
  it("settles at the top, descends, settles at the bottom, climbs back", () => {
    const { fromM, toM, settleMs } = PERF_PATH;
    expect(fromM).toBe(20_000_000);
    expect(toM).toBe(30_000);
    expect(settleMs).toBe(2_000);
    const decades = Math.log10(fromM / toM);
    const legMs = (decades / 0.5) * 1000;
    expect(perfZoomDurationMs(opts)).toBeCloseTo(2 * legMs + 2 * settleMs, 6);
    expect(perfZoomAltitudeM(0, opts).altitudeM).toBe(fromM);
    expect(perfZoomAltitudeM(settleMs, opts).altitudeM).toBe(fromM);
    expect(perfZoomAltitudeM(settleMs + legMs, opts).altitudeM).toBeCloseTo(
      toM,
      3,
    );
    expect(perfZoomAltitudeM(2 * settleMs + legMs, opts).phase).toBe("up");
    const end = perfZoomAltitudeM(perfZoomDurationMs(opts), opts);
    expect(end.altitudeM).toBeCloseTo(fromM, 0);
    expect(end.done).toBe(true);
    expect(perfZoomAltitudeM(perfZoomDurationMs(opts) - 1, opts).done).toBe(
      false,
    );
  });

  it("moves at the constant speed in the logarithm of the altitude", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0.25, 0.5, 1),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (decadesPerS, f) => {
          const o = { decadesPerS };
          const legMs =
            (Math.log10(PERF_PATH.fromM / PERF_PATH.toM) / decadesPerS) * 1000;
          const t = PERF_PATH.settleMs + f * (legMs - 10);
          const a = perfZoomAltitudeM(t, o).altitudeM;
          const b = perfZoomAltitudeM(t + 10, o).altitudeM;
          // 10 ms down a leg at decadesPerS: log10(a / b) = decadesPerS / 100.
          expect(Math.log10(a / b)).toBeCloseTo(decadesPerS / 100, 9);
        },
      ),
    );
  });

  it("refuses a non-finite time or a speed that is not positive", () => {
    expect(() => perfZoomAltitudeM(Number.NaN, opts)).toThrow(RangeError);
    expect(() => perfZoomAltitudeM(0, { decadesPerS: 0 })).toThrow(RangeError);
    expect(() => perfZoomDurationMs({ decadesPerS: -1 })).toThrow(RangeError);
  });
});

describe("perfStepPath, the frame-stepped path", () => {
  it("steps a fixed amount a frame and holds at every checkpoint, down then up", () => {
    expect(PERF_CHECKPOINTS_KM).toEqual([5_000, 2_000, 1_600, 1_200, 300, 30]);
    const path = perfStepPath({ stepsPerDecade: 40 });
    // Down: from 20,000 km to 30 km, each checkpoint once; up: back to the top.
    const downCheckpoints = path.filter(
      (p) => p.checkpoint && p.leg === "down",
    );
    expect(downCheckpoints.map((p) => Math.round(p.altitudeM / 1000))).toEqual(
      PERF_CHECKPOINTS_KM,
    );
    expect(path[0]!.altitudeM).toBe(PERF_PATH.fromM);
    expect(path[path.length - 1]!.altitudeM).toBeCloseTo(PERF_PATH.fromM, 0);
    // Between neighbours that are not checkpoints, one step in the log.
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const step = Math.abs(Math.log10(a.altitudeM / b.altitudeM));
      expect(step).toBeLessThanOrEqual(1 / 40 + 1e-9);
    }
    // The lowest point is the path's bottom.
    const lowest = Math.min(...path.map((p) => p.altitudeM));
    expect(lowest).toBeCloseTo(PERF_PATH.toM, 3);
  });

  it("is the same sequence for any frame time: a function of the index only", () => {
    expect(perfStepPath({ stepsPerDecade: 20 })).toEqual(
      perfStepPath({ stepsPerDecade: 20 }),
    );
  });

  it("refuses a step count that is not a positive integer", () => {
    expect(() => perfStepPath({ stepsPerDecade: 0 })).toThrow(RangeError);
    expect(() => perfStepPath({ stepsPerDecade: 2.5 })).toThrow(RangeError);
  });
});

// Why this matters (§4.2, H5): the controls-driven mode feeds the zoom
// through the controls' own wheel input, as a pinch or a wheel does, so the
// zoom-point raycast a real zoom costs is counted. The wheel delta must
// close on the path's altitude: under the library's far-zoom law
// (3d-tiles-renderer 0.5.3 GlobeControls: the distance scales by
// 1 + 0.25 x 0.0025 x deltaY at zoomSpeed 1) one frame's delta lands on the
// target, and a delta is never so large that one frame jumps past it.
describe("perfWheelDeltaY, the controls-driven mode", () => {
  const farLaw = (altitudeM: number, deltaY: number) =>
    altitudeM * (1 + 0.000625 * deltaY);

  it("is zero at the target, negative (in) above it and positive (out) below", () => {
    expect(perfWheelDeltaY(1e6, 1e6)).toBe(0);
    expect(perfWheelDeltaY(1.02e6, 1e6)).toBeLessThan(0);
    expect(perfWheelDeltaY(0.98e6, 1e6)).toBeGreaterThan(0);
  });

  it("lands one frame's step on the target under the far-zoom law", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 30_000, max: 20_000_000, noNaN: true }),
        fc.double({ min: 0.9, max: 1.1, noNaN: true }),
        (target, ratio) => {
          const a = target * ratio;
          expect(farLaw(a, perfWheelDeltaY(a, target)) / target).toBeCloseTo(
            1,
            9,
          );
        },
      ),
    );
  });

  it("caps a large error at half the distance in and double it out", () => {
    expect(farLaw(1e7, perfWheelDeltaY(1e7, 1e3))).toBeCloseTo(5e6, 3);
    expect(farLaw(1e3, perfWheelDeltaY(1e3, 1e7))).toBeCloseTo(2e3, 6);
  });

  it("refuses an altitude or target that is not finite and > 0", () => {
    expect(() => perfWheelDeltaY(0, 1e6)).toThrow(RangeError);
    expect(() => perfWheelDeltaY(1e6, Number.NaN)).toThrow(RangeError);
  });
});

// Why: the frame-stepped path holds at PERF_E_CHECK_KM for its one E
// change, which the recorder times as the cost of a height step (perf plan
// 2026-10-03-2017 H1). Outside the exaggeration's ramp (1 above 2,000 km,
// the near value from 20 km down) nothing would change there and the check
// would time nothing.
describe("PERF_E_CHECK_KM", () => {
  it("lies inside the exaggeration's ramp, where a small move changes E", () => {
    const m = PERF_E_CHECK_KM * 1000;
    const e = exaggerationAt(m);
    expect(e).toBeGreaterThan(1);
    expect(e).toBeLessThan(exaggerationAt(0));
    // A 30 % descent from the check altitude crosses at least one 0.1 step.
    expect(exaggerationAt(m * 0.7)).toBeGreaterThan(e);
  });
});
