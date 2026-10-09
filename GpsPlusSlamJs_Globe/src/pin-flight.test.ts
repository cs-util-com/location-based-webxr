/**
 * Why this test matters: the pin's flight from the press to the landing
 * (continuous-flight plan 2026-10-07-0941, CF3) must start at the press,
 * never land on a guess, never arrive before its data, and still never
 * stop in between. The owner's decisions, each a test here:
 * - DEC-CF-4b: without a target the flight starts at once but holds above
 *   about 2,000 km, over where it already looks (no sideways guess); a fix
 *   flies on to it; a failure ends at the hold;
 * - DEC-CF-3b: "the speed of the fly-down should start so slow that there
 *   is guaranteed enough time for the data to load before the camera
 *   arrives": the camera does not go below the commit altitude (about
 *   100 km) before the data is ready, and only slows above it;
 * - DEC-CF-5: after 60 s it goes on regardless;
 * - a touch cancels the flight in every moving phase.
 * Simulated at 60 Hz, measured on the camera.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { obliqueCamera } from "./globe-dive.js";
import { FLIGHT_PATH, flightCamera } from "./flight-path.js";
import { meteorDiveArcRad } from "./flight-travel.js";
import {
  PIN_FLIGHT,
  pinFailed,
  pinFix,
  pinFrame,
  pinLanding,
  pinProgress,
  meteorLinkStart,
  pinTouch,
  pressPin,
  type PinFlight,
} from "./pin-flight.js";
import {
  noLateSurge,
  noStall,
  noStopAndGo,
  type SpeedSample,
} from "./test-utils/flight-speed.js";

const KM = 1_000;
const R = FLIGHT_PATH.radiusM;
const BERN = { lat: 46.948, lng: 7.4474 };
const NEW_YORK = { lat: 40.7128, lng: -74.006 };
const TOKYO = { lat: 35.68, lng: 139.69 };
const SYDNEY = { lat: -33.87, lng: 151.21 };
const HZ = 60;
const DT = 1000 / HZ;

/** The camera over `place`, looking straight down, as the intro leaves it. */
function cameraOver(place: { lat: number; lng: number }, altitudeM: number) {
  const pose = orbitPose(WGS84_ELLIPSOID, place);
  const cam = obliqueCamera(WGS84_ELLIPSOID, pose, altitudeM, 90);
  return {
    pose,
    distanceM: cam.position.length(),
    quaternion: cam.quaternion,
  };
}

interface Sample {
  readonly t: number;
  readonly h: number;
  readonly dir: { x: number; y: number; z: number };
  readonly phase: string;
}

/**
 * Runs the pin from `pin` at 60 Hz until `untilMs`, calling `events(t,
 * pin)` before each frame (it may return a new pin); the camera's samples.
 */
function run(
  start: PinFlight,
  untilMs: number,
  events: (t: number, pin: PinFlight) => PinFlight = (_t, p) => p,
): { pin: PinFlight; samples: Sample[] } {
  let pin = start;
  const samples: Sample[] = [];
  for (let t = DT; t <= untilMs; t += DT) {
    pin = events(t, pin);
    const out = pinFrame(pin, t);
    pin = out.pin;
    if (out.camera) {
      const d = out.camera.position.clone().normalize();
      samples.push({
        t,
        h: out.camera.altitudeM,
        dir: { x: d.x, y: d.y, z: d.z },
        phase: pin.phase,
      });
    }
  }
  return { pin, samples };
}

/** The camera's speed between samples, by the flight's measure. */
function speeds(samples: Sample[]): SpeedSample[] {
  const out: SpeedSample[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) continue;
    const chord = Math.hypot(
      a.dir.x - b.dir.x,
      a.dir.y - b.dir.y,
      a.dir.z - b.dir.z,
    );
    const ground = 2 * Math.asin(Math.min(1, chord / 2)) * R;
    const h = (a.h + b.h) / 2;
    out.push({
      t: b.t,
      h: b.h,
      v: Math.hypot(Math.log(b.h / a.h), ground / h) / (DT / 1000),
    });
  }
  return out;
}

const bernPose = orbitPose(WGS84_ELLIPSOID, BERN);

describe("PIN_FLIGHT", () => {
  it("holds at about 2,000 km, commits at about 100 km, and goes on after 60 s", () => {
    expect(PIN_FLIGHT.holdM).toBe(2_000 * KM);
    expect(PIN_FLIGHT.commitM).toBe(100 * KM);
    expect(PIN_FLIGHT.safetyCapMs).toBe(60_000);
  });
});

describe("the pin's flight", () => {
  // WHY (DEC-CF-4b): without a fix the flight starts at the press but
  // never descends into the relief over a guess, nor moves sideways to one
  // (the fallback guess is New York).
  it("holds above 2,000 km over where it looks while the position is unknown", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      {
        target: null,
        landingM: 2 * KM,
        progress: 0,
      },
    );
    const { pin: after, samples } = run(pin, 30_000);
    expect(after.phase).toBe("holding");
    expect(Math.min(...samples.map((s) => s.h))).toBeGreaterThanOrEqual(
      PIN_FLIGHT.holdM * 0.999,
    );
    const ny = orbitPose(WGS84_ELLIPSOID, NEW_YORK).direction;
    const last = samples.at(-1);
    expect(last).toBeDefined();
    const drift =
      Math.acos(
        Math.min(
          1,
          (last?.dir.x ?? 0) * ny.x +
            (last?.dir.y ?? 0) * ny.y +
            (last?.dir.z ?? 0) * ny.z,
        ),
      ) * R;
    // It looks down at about 80 degrees there: the camera stands a few
    // hundred km behind its view, never a continent away.
    expect(drift).toBeLessThan(600 * KM);
    // And it moves from the press: no hovering in place. The hold is slow
    // by design (DEC-FR2-9: its pace is about the stretch a fix then sets,
    // 0.15, so the fix never brakes); 10 s in it is clearly lower (measured
    // about 15 %).
    expect(samples[600]?.h ?? Infinity).toBeLessThan(0.9 * 10_100 * KM);
  });

  // WHY (DEC-CF-3b): the data is guaranteed time to load: the camera does
  // not go below the commit altitude until it is ready.
  it("never goes below the commit altitude before the data is ready", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      {
        target: bernPose,
        landingM: 2 * KM,
        progress: 0,
      },
    );
    const { pin: after, samples } = run(pin, 50_000);
    expect(after.phase).toBe("approaching");
    expect(Math.min(...samples.map((s) => s.h))).toBeGreaterThanOrEqual(
      PIN_FLIGHT.commitM * 0.999,
    );
  });

  // WHY (DEC-CF-5): a dead network never traps the camera.
  it("goes on regardless after 60 s and lands", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      {
        target: bernPose,
        landingM: 2 * KM,
        progress: 0,
      },
    );
    const { pin: after, samples } = run(pin, 100_000);
    expect(after.phase).toBe("landed");
    const below = samples.find((s) => s.h < PIN_FLIGHT.commitM * 0.99);
    expect(below?.t ?? 0).toBeGreaterThanOrEqual(PIN_FLIGHT.safetyCapMs);
    expect(samples.at(-1)?.h).toBeCloseTo(2 * KM, 3);
  });

  // WHY: the whole point (the owner's "never stops in between"): data
  // arriving mid-flight, the fix after the press, the speed measured from
  // the press to the settle. The fix during the hold is the design's own
  // replan (DEC-CF-4b), from a hold over New York to Bern, Tokyo, Sydney
  // (near-antipodal) and New York itself (CF2 review finding 2 asked for far
  // places).
  it("flies one continuous flight when the fix and the data come during it", () => {
    const cases = [
      { fixAt: 0, readyAt: 2_000, place: BERN, name: "Bern" },
      { fixAt: 1_500, readyAt: 4_000, place: BERN, name: "Bern" },
      { fixAt: 3_000, readyAt: 9_000, place: BERN, name: "Bern" },
      { fixAt: 800, readyAt: 3_000, place: TOKYO, name: "Tokyo" },
      { fixAt: 5_000, readyAt: 8_000, place: SYDNEY, name: "Sydney" },
      { fixAt: 1_500, readyAt: 4_000, place: NEW_YORK, name: "New York" },
    ];
    for (const { fixAt, readyAt, place, name } of cases) {
      const target = orbitPose(WGS84_ELLIPSOID, place);
      const pin = pressPin(
        WGS84_ELLIPSOID,
        0,
        cameraOver(NEW_YORK, 10_100 * KM),
        {
          target: fixAt === 0 ? target : null,
          landingM: 2 * KM,
          progress: 0,
        },
      );
      const { pin: after, samples } = run(pin, 70_000, (t, p) => {
        let q = p;
        if (fixAt > 0 && t >= fixAt && q.phase === "holding") {
          q = pinFix(q, t, target);
        }
        const progress = Math.min(
          1,
          Math.max(0, (t - fixAt) / (readyAt - fixAt)),
        );
        return pinProgress(q, t, progress);
      });
      const tag = `${name}: fix ${fixAt}, ready ${readyAt}`;
      expect(after.phase, tag).toBe("landed");
      expect(samples.at(-1)?.h).toBeCloseTo(2 * KM, 3);
      // The camera lands about one landing behind its target (45 degrees).
      const last = samples.at(-1) as Sample;
      const d = target.direction;
      const toTarget = Math.acos(
        Math.min(1, last.dir.x * d.x + last.dir.y * d.y + last.dir.z * d.z),
      );
      expect((toTarget * R) / KM, tag).toBeLessThan(3);
      const vs = speeds(samples);
      // From a second after the flight to the target began (the fix; the
      // hold before it is slow by design, DEC-CF-4b's accepted "slow-in at
      // 2,000 km while waiting", and has its own test) to the final settle
      // (3 x the landing).
      let end = vs.length;
      while (end > 0 && (vs[end - 1]?.h ?? 0) <= 3 * 2 * KM) end -= 1;
      const w = vs.slice(0, end).filter((s) => s.t >= fixAt + 1_000);
      const v = w.map((s) => s.v);
      // (a) at 0.3, from a second after the data is in: before it, the
      // pace is the stretch, slow by design (DEC-CF-3b; DEC-FR2-9 starts a
      // link at it, about 0.14, where it used to start at 0.5), and one
      // acceleration out of it is not a stall. (b) and (c) still judge the
      // whole window, the slow part included.
      const released = w.filter((s) => s.t >= readyAt + 1_000).map((s) => s.v);
      expect(noStall(released, 0.3), tag).toBe(true);
      expect(noStopAndGo(v, 0.2), tag).toBe(true);
      expect(noLateSurge(w, 1.25), tag).toBe(true);
    }
  });

  // WHY (DEC-CF-3b): the pace acts only high up, where waiting is
  // invisible: cold data slows the high stretch, and nothing changes the
  // speed below the commit altitude.
  it("slows with cold data only above the commit altitude", () => {
    const time = (progress: number) => {
      const pin = pressPin(
        WGS84_ELLIPSOID,
        0,
        cameraOver(NEW_YORK, 10_100 * KM),
        {
          target: bernPose,
          landingM: 2 * KM,
          progress,
        },
      );
      const { samples } = run(pin, 30_000);
      return samples.find((s) => s.h < 1_000 * KM)?.t ?? Infinity;
    };
    expect(time(0)).toBeGreaterThan(1.5 * time(1));
    // Below the commit altitude: a late progress report changes nothing.
    const flown = (late: boolean) => {
      const pin = pressPin(
        WGS84_ELLIPSOID,
        0,
        cameraOver(NEW_YORK, 10_100 * KM),
        {
          target: bernPose,
          landingM: 2 * KM,
          progress: 1,
        },
      );
      return run(pin, 20_000, (t, p) =>
        late && p.phase === "descending" ? pinProgress(p, t, 0) : p,
      ).samples;
    };
    const a = flown(false);
    const b = flown(true);
    const low = (s: Sample[]) => s.filter((x) => x.h < PIN_FLIGHT.commitM);
    expect(low(b).map((x) => x.h)).toEqual(low(a).map((x) => x.h));
  });

  // WHY (cold review finding 11, CF4): the landing's floor is sampled
  // when the target's height tile arrives, usually mid-flight; a raised
  // landing replans the flight (a CF2 replan) and it lands exactly there,
  // still without a stop.
  it("lands at a landing raised mid-flight", () => {
    for (const raiseAt of [3_000, 8_000, 12_000]) {
      const pin = pressPin(
        WGS84_ELLIPSOID,
        0,
        cameraOver(NEW_YORK, 10_100 * KM),
        { target: bernPose, landingM: 2 * KM, progress: 1 },
      );
      const { pin: after, samples } = run(pin, 60_000, (t, p) =>
        t >= raiseAt && p.landingM === 2 * KM ? pinLanding(p, t, 3.5 * KM) : p,
      );
      const tag = `raised at ${raiseAt} ms`;
      expect(after.phase, tag).toBe("landed");
      expect(samples.at(-1)?.h, tag).toBeCloseTo(3.5 * KM, 3);
      const vs = speeds(samples);
      let end = vs.length;
      while (end > 0 && (vs[end - 1]?.h ?? 0) <= 3 * 3.5 * KM) end -= 1;
      const w = vs.slice(0, end).filter((x) => x.t >= 1_000);
      expect(
        noStopAndGo(
          w.map((x) => x.v),
          0.2,
        ),
        tag,
      ).toBe(true);
    }
  });

  it("ignores a landing for a flight that is not flying", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      {
        target: null,
        landingM: 2 * KM,
        progress: 0,
      },
    );
    expect(pinLanding(pin, 100, 3 * KM).landingM).toBe(2 * KM);
    expect(() => pinLanding(pin, 100, 0)).toThrow(RangeError);
  });

  // WHY (DEC-CF-4b): a denied or failed position ends at the hold.
  it("ends at the hold when the position fails", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      {
        target: null,
        landingM: 2 * KM,
        progress: 0,
      },
    );
    const { pin: after, samples } = run(pin, 40_000, (t, p) =>
      t >= 5_000 && p.phase === "holding" ? pinFailed(p, t) : p,
    );
    expect(after.phase).toBe("failed");
    expect(Math.min(...samples.map((s) => s.h))).toBeGreaterThanOrEqual(
      PIN_FLIGHT.holdM * 0.999,
    );
    // Still drawn: the camera stays where the flight left it.
    expect(samples.at(-1)?.t).toBeCloseTo(40_000, -2);
  });

  // WHY (cold review finding 8): the camera moves from the press on, so a
  // touch must cancel in every moving phase.
  it("is cancelled by a touch in every moving phase", () => {
    const cases: [string, (t: number, p: PinFlight) => PinFlight][] = [
      ["holding", (_t, p) => p],
      [
        "approaching",
        (t, p) =>
          t >= 1_000 && p.phase === "holding" ? pinFix(p, t, bernPose) : p,
      ],
      [
        "descending",
        (t, p) => {
          const q =
            t >= 1_000 && p.phase === "holding" ? pinFix(p, t, bernPose) : p;
          return pinProgress(q, t, t >= 1_000 ? 1 : 0);
        },
      ],
    ];
    for (const [phase, drive] of cases) {
      const pin = pressPin(
        WGS84_ELLIPSOID,
        0,
        cameraOver(NEW_YORK, 10_100 * KM),
        {
          target: null,
          landingM: 2 * KM,
          progress: 0,
        },
      );
      const before = run(pin, 3_000, drive).pin;
      expect(before.phase).toBe(phase);
      const touched = pinTouch(before, 3_000);
      expect(touched.phase).toBe("cancelled");
      expect(pinFrame(touched, 3_100).camera).toBeNull();
    }
  });

  it("rejects a time that is not a number", () => {
    const pin = pressPin(WGS84_ELLIPSOID, 0, cameraOver(BERN, 10_000 * KM), {
      target: bernPose,
      landingM: 2 * KM,
      progress: 0,
    });
    expect(() => pinFrame(pin, NaN)).toThrow(RangeError);
    expect(() =>
      pressPin(WGS84_ELLIPSOID, 0, cameraOver(BERN, 10_000 * KM), {
        target: null,
        landingM: 0,
        progress: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe("the pin's flight, CF3 milestone review", () => {
  const fixAndData = (dataMs: number, kind: "linear" | "step") => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      { target: null, landingM: 2 * KM, progress: 0 },
    );
    const fixAt = 1_500;
    return run(pin, 120_000, (t, p) => {
      let q = p;
      if (t >= fixAt && q.phase === "holding") q = pinFix(q, t, bernPose);
      const x = (t - fixAt) / dataMs;
      const progress =
        kind === "linear" ? Math.min(1, Math.max(0, x)) : x >= 1 ? 1 : 0;
      return pinProgress(q, t, progress);
    });
  };

  // WHY (DEC-CF-6, owner 2026-10-07, after review finding 1: with cold
  // data, 15-90 s on a first visit, the gate stopped the camera at about
  // 110 km): the flight predicts from the download's progress how long the
  // data still needs and stretches the high stretch to meet it at the
  // gate, so the camera does not wait there, and still never goes below
  // the commit altitude before its data.
  it("stretches the high stretch to meet slow data at the gate, without waiting", () => {
    for (const dataMs of [15_000, 30_000, 45_000]) {
      const { pin, samples } = fixAndData(dataMs, "linear");
      const tag = `data over ${dataMs} ms`;
      expect(pin.phase, tag).toBe("landed");
      const readyAt = 1_500 + dataMs;
      const early = samples.filter((s) => s.t < readyAt - 100);
      expect(Math.min(...early.map((s) => s.h)), tag).toBeGreaterThanOrEqual(
        PIN_FLIGHT.commitM * 0.999,
      );
      // Never waiting: from a second after the fix to the final settle, the
      // camera never falls under 10 % of its median speed (a wait at the
      // gate read 0.01-0.05), and never slows between two faster stretches.
      const vs = speeds(samples);
      let end = vs.length;
      while (end > 0 && (vs[end - 1]?.h ?? 0) <= 3 * 2 * KM) end -= 1;
      const v = vs
        .slice(0, end)
        .filter((s) => s.t >= 2_500)
        .map((s) => s.v);
      expect(noStall(v, 0.1), tag).toBe(true);
      expect(noStopAndGo(v, 0.2), tag).toBe(true);
    }
  });

  // WHY (DEC-CF-3b): data that reports no progress until it is all in (one
  // step) cannot be predicted; the camera still never goes below the gate
  // before it.
  it("never goes below the gate for data that gives no warning", () => {
    const { pin, samples } = fixAndData(40_000, "step");
    expect(pin.phase).toBe("landed");
    const early = samples.filter((s) => s.t < 41_400);
    expect(Math.min(...early.map((s) => s.h))).toBeGreaterThanOrEqual(
      PIN_FLIGHT.commitM * 0.999,
    );
  });

  // WHY (review finding 6): a failed position leaves the hold moving; a
  // touch must still give the camera to the controls.
  it("is cancelled by a touch after a failure while the hold still moves", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      {
        target: null,
        landingM: 2 * KM,
        progress: 0,
      },
    );
    const failed = pinFailed(run(pin, 2_000).pin, 2_000);
    const touched = pinTouch(failed, 4_000);
    expect(touched.phase).toBe("cancelled");
    expect(pinFrame(touched, 4_100).camera).toBeNull();
  });

  // WHY (review finding 7): a press already below the commit altitude with
  // cold data froze the camera (the gate sat at its start); the gate only
  // stands where the path comes down through the commit altitude.
  it("moves from a press below the commit altitude, data or not", () => {
    for (const km of [50, 99]) {
      const pin = pressPin(
        WGS84_ELLIPSOID,
        0,
        cameraOver({ lat: 41.9, lng: 12.5 }, km * KM),
        { target: bernPose, landingM: 2 * KM, progress: 0 },
      );
      const { samples } = run(pin, 10_000);
      const moved = Math.abs((samples.at(-1)?.h ?? 0) - km * KM);
      expect(moved, `from ${km} km`).toBeGreaterThan(1 * KM);
    }
  });

  // WHY (PR #560 review): a short flight that never comes down through the
  // commit altitude has no gate, so nothing waits for its data; it must
  // report its landing when it lands, not at the 60 s cap.
  it("reports the landing of a flight without a gate when it lands", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver({ lat: 46.948, lng: 7.58 }, 50 * KM),
      { target: bernPose, landingM: 2 * KM, progress: 0 },
    );
    expect(pin.gateClockMs).toBeNull();
    const landedAt =
      run(pin, 40_000).samples.find((x) => x.phase === "landed")?.t ?? Infinity;
    expect(landedAt).toBeLessThan(20_000);
  });

  // WHY (PR #560 R0 review): a landing raised above the commit altitude
  // leaves the new path without a gate, so the flight is released at once,
  // not one frame later.
  it("is released at once when a new landing removes the gate", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      { target: bernPose, landingM: 2 * KM, progress: 0 },
    );
    expect(pin.phase).toBe("approaching");
    const raised = pinLanding(run(pin, 1_000).pin, 1_000, 150 * KM);
    expect(raised.gateClockMs).toBeNull();
    expect(raised.phase).toBe("descending");
  });

  // WHY (review finding 8: the rate lag, the clamp at the gate and the
  // gate's ease had no test that could fail).
  it("raises the rate gradually at release, and never passes a closed gate in one long frame", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      {
        target: bernPose,
        landingM: 2 * KM,
        progress: 0,
      },
    );
    const atGate = run(pin, 50_000).pin;
    expect(atGate.phase).toBe("approaching");
    // One very long frame never carries the clock past a closed gate.
    const long = pinFrame(atGate, 59_000).pin;
    expect(long.clockMs).toBeLessThanOrEqual((long.gateClockMs ?? 0) + 1e-6);
    // Released, the rate climbs with its lag: one 60 Hz frame moves it a
    // little, not all the way.
    const released = pinProgress(atGate, 50_000, 1);
    const next = pinFrame(released, 50_000 + 1000 / 60).pin;
    expect(next.rate - atGate.rate).toBeGreaterThan(0);
    expect(next.rate).toBeLessThan(0.5);
  });

  // WHY (review finding 8, mutant M1): once the data is in, the flight is
  // not paced any more; a descent left at the cold pace would take twice as
  // long and still pass every other test.
  it("flies at full pace once its data is in", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      { target: bernPose, landingM: 2 * KM, progress: 1 },
    );
    expect(pin.phase).toBe("descending");
    const flight = pin.flight;
    if (!flight) throw new Error("no flight");
    const pathMs = flight.endsAtMs - flight.startedAtMs;
    const { pin: end, samples } = run(pin, 3 * pathMs);
    expect(end.phase).toBe("landed");
    const landedAt = samples.find((s) => s.phase === "landed")?.t ?? Infinity;
    // Data already in: nothing to pace, so it starts at full pace (the R2
    // review: it started at the stretch, about 0.13, and eased up).
    expect(landedAt).toBeLessThan(pathMs + 300);
  });

  it("eases into the gate rather than stopping hard", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      {
        target: bernPose,
        landingM: 2 * KM,
        progress: 0,
      },
    );
    const { samples } = run(pin, 50_000);
    const vs = speeds(samples).filter((s) => s.v > 0);
    // No single frame loses more than a tenth of the speed it had.
    let worst = 0;
    for (let i = 1; i < vs.length; i++) {
      const a = vs[i - 1]?.v ?? 0;
      const b = vs[i]?.v ?? 0;
      if (a > 1e-4) worst = Math.max(worst, (a - b) / a);
    }
    expect(worst).toBeLessThan(0.1);
  });

  // WHY (review finding 9): progress reported during the hold belongs to no
  // target; the fix starts its own data.
  it("starts the fix's data from nothing", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      {
        target: null,
        landingM: 2 * KM,
        progress: 0,
      },
    );
    const reported = pinProgress(run(pin, 1_000).pin, 1_000, 1);
    const fixed = pinFix(reported, 1_100, bernPose);
    expect(fixed.progress).toBe(0);
    expect(fixed.phase).toBe("approaching");
  });

  // WHY (review finding 10): a tilted camera holds over where it looks,
  // not over its own nadir thousands of km away.
  it("holds over where a tilted camera looks", () => {
    const pose = orbitPose(WGS84_ELLIPSOID, NEW_YORK);
    const tilted = obliqueCamera(WGS84_ELLIPSOID, pose, 9_000 * KM, 70);
    const camDir = tilted.position.clone().normalize();
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      {
        pose: {
          direction: camDir,
          up: pose.up.clone().projectOnPlane(camDir).normalize(),
        },
        distanceM: tilted.position.length(),
        quaternion: tilted.quaternion,
        pitchDeg: 70,
      },
      { target: null, landingM: 2 * KM, progress: 0 },
    );
    const { samples } = run(pin, 40_000);
    const last = samples.at(-1);
    const looked = pose.direction;
    const d = Math.acos(
      Math.min(
        1,
        (last?.dir.x ?? 0) * looked.x +
          (last?.dir.y ?? 0) * looked.y +
          (last?.dir.z ?? 0) * looked.z,
      ),
    );
    expect((d * R) / KM).toBeLessThan(1_000);
  });
});

describe("the pin's pace never slows while it approaches (round-2 plan DEC-FR2-9)", () => {
  // WHY (round-2 plan 2026-10-07-2350 §8): the owner saw "fast, then a
  // stop, then slow". Measured in the browser: the rate fell from the cold
  // 0.5 to 0.14 within a second, then followed the data's lumpy progress
  // (an Overpass tile weighs 21 MB against 0.2 MB for a height tile), up to
  // 0.78 and down to 0.27. The pace must start where it will stay and only
  // rise while it approaches; only the gate's ease, for data later than
  // predicted, may slow it.
  const profiles: Record<string, (x: number) => number> = {
    "all at once": (x) => (x >= 1 ? 1 : 0),
    "0.9 then a stall": (x) => (x >= 1 ? 1 : x >= 0.6 ? 0.9 : 0),
    "two halves": (x) => (x >= 1 ? 1 : x >= 0.5 ? 0.5 : 0),
    steady: (x) => Math.min(1, Math.max(0, x)),
  };
  it("starts at its pace and never dips in the high stretch, whatever the data", () => {
    const failures: string[] = [];
    for (const startKm of [43_600, 65_000]) {
      for (const [name, profile] of Object.entries(profiles)) {
        for (const dataS of [2, 5, 10, 20, 30, 45, 60, 90]) {
          const pin = pressPin(
            WGS84_ELLIPSOID,
            0,
            cameraOver({ lat: 30, lng: 15 }, startKm * KM),
            { target: bernPose, landingM: 2 * KM, progress: 0 },
          );
          const { samples } = run(pin, 150_000, (t, p) =>
            pinProgress(p, t, profile(t / (dataS * 1000))),
          );
          const tag = `${startKm} km, ${name}, ${dataS} s`;
          const high = speeds(samples).filter(
            (s) => s.t >= 1_000 && s.h > 2.5 * PIN_FLIGHT.commitM,
          );
          const v = high.map((s) => s.v);
          if (!noStopAndGo(v, 0.2)) failures.push(`${tag}: stop-and-go`);
          const early = Math.max(...v.slice(0, 30));
          const later = v.slice(120, 180);
          if (later.length > 0 && early > 1.25 * Math.max(...later)) {
            failures.push(`${tag}: starts fast, then slows`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // WHY (R2 milestone review): with the floor, a camera paced for data
  // assumed to take `assumedDataMs` reached the gate before the 60 s cap
  // and stopped there for about 5.5 s when the data took longer; paced for
  // the cap, it never waits at the gate for data within it, and later data
  // is released by the cap itself (DEC-CF-5).
  it("never waits at the gate, whatever the data takes", () => {
    const failures: string[] = [];
    for (const startKm of [65_000, 43_600, 10_100]) {
      for (const [name, profile] of Object.entries(profiles)) {
        // 2-60 s is DEC-CF-6's claim, re-measured on the final code
        // (DEC-CF-8); 90 s is past the cap.
        for (const dataS of [2, 5, 10, 20, 30, 45, 55, 60, 90]) {
          const pin = pressPin(
            WGS84_ELLIPSOID,
            0,
            cameraOver({ lat: 30, lng: 15 }, startKm * KM),
            { target: bernPose, landingM: 2 * KM, progress: 0 },
          );
          let waited = 0;
          run(pin, 150_000, (t, p) => {
            if (
              p.phase === "approaching" &&
              p.gateClockMs !== null &&
              p.gateClockMs - p.clockMs < 50
            ) {
              waited += DT;
            }
            return pinProgress(p, t, profile(t / (dataS * 1000)));
          });
          if (waited > 200) {
            failures.push(
              `${startKm} km, ${name}, ${dataS} s: waited ${(waited / 1000).toFixed(1)} s`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // WHY (R2 milestone review): after a failure nothing is left to wait for;
  // the slow hold (0.15) crept on for about 90 s under the failure's text.
  it("finishes a failed hold at full pace", () => {
    const pin = pressPin(
      WGS84_ELLIPSOID,
      0,
      cameraOver(NEW_YORK, 10_100 * KM),
      { target: null, landingM: 2 * KM, progress: 0 },
    );
    const { samples } = run(pin, 30_000, (t, p) =>
      t >= 2_000 && p.phase === "holding" ? pinFailed(p, t) : p,
    );
    const at25 = samples.find((x) => x.t >= 25_000)?.h ?? Infinity;
    expect(at25).toBeLessThan(PIN_FLIGHT.holdM * 1.01);
  });

  // WHY (R2 milestone review, finding 2): at a far fix from a low hold the
  // replan's own path speed dipped (from 10,100 km, Tokyo and Sydney to
  // 0.57-0.85 of the speed before; from 3,000 km as low as 0.18). On the
  // round-2 travel curve the turn is a self-similar part of the path, so
  // the fix only bends it: the speed holds at a fix from any hold altitude.
  it("keeps its speed at a fix during the hold, near or far, high or low", () => {
    const failures: string[] = [];
    for (const startKm of [10_100, 5_000, 3_000]) {
      for (const place of [BERN, TOKYO, SYDNEY]) {
        for (const fixAt of [1_500, 5_000]) {
          const target = orbitPose(WGS84_ELLIPSOID, place);
          const pin = pressPin(
            WGS84_ELLIPSOID,
            0,
            cameraOver(NEW_YORK, startKm * KM),
            { target: null, landingM: 2 * KM, progress: 0 },
          );
          const { samples } = run(pin, fixAt + 2_000, (t, p) =>
            t >= fixAt && p.phase === "holding" ? pinFix(p, t, target) : p,
          );
          const vs = speeds(samples);
          const before = vs.filter((x) => x.t < fixAt).at(-1)?.v ?? 0;
          const after = vs
            .filter((x) => x.t >= fixAt && x.t < fixAt + 1_500)
            .map((x) => x.v);
          const ratio = Math.min(...after) / before;
          if (!(ratio >= 0.9)) {
            failures.push(
              `${startKm} km, ${JSON.stringify(place)}, fix ${fixAt}: ${ratio.toFixed(2)}`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // WHY (DEC-FR2-9): the pin's own press holds until the fix; the hold's
  // pace must not be faster than the stretch the fix then sets, or the fix
  // reads as a brake.
  it("never dips when the fix comes during the hold, whatever the data", () => {
    const failures: string[] = [];
    for (const fixAt of [1_500, 5_000, 12_000]) {
      for (const [name, profile] of Object.entries(profiles)) {
        for (const dataS of [2, 10, 30, 60]) {
          const pin = pressPin(
            WGS84_ELLIPSOID,
            0,
            cameraOver(NEW_YORK, 25_600 * KM),
            { target: null, landingM: 2 * KM, progress: 0 },
          );
          const { samples } = run(pin, 150_000, (t, p) => {
            const q =
              t >= fixAt && p.phase === "holding" ? pinFix(p, t, bernPose) : p;
            return pinProgress(q, t, profile((t - fixAt) / (dataS * 1000)));
          });
          const v = speeds(samples)
            .filter((s) => s.t >= 1_000 && s.h > 2.5 * PIN_FLIGHT.commitM)
            .map((s) => s.v);
          if (!noStopAndGo(v, 0.2)) {
            failures.push(`fix ${fixAt}, ${name}, ${dataS} s: stop-and-go`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

// WHY (round-3 plan 2026-10-08-2345 F1, the second plan review): a link
// (a target known at the press, started on the meteor's line) flies the
// meteor the owner asked for; a press over its own place has no room for
// the line's 3,000-odd km of sweep, so it fits the flattest line that its
// arc allows and never backs off beyond R1's own dive; a landing raise
// keeps the beta it chose.
describe("the pin's meteor (meteorDeg, pressMeteor)", () => {
  const bernDir = bernPose.direction.clone().normalize();
  const angleFromBern = (s: { dir: { x: number; y: number; z: number } }) =>
    Math.acos(
      Math.min(
        1,
        s.dir.x * bernDir.x + s.dir.y * bernDir.y + s.dir.z * bernDir.z,
      ),
    );

  it("flies a link on the asked meteor", () => {
    const sweepDeg =
      (meteorDiveArcRad(65_000 * KM, 2 * KM, 45) * 180) / Math.PI;
    // The lab starts a link 1 % further out than the line's sweep, so the
    // asked beta fits by construction (the camera's arc ends one landing
    // short of the target); the residual turn absorbs the 1 %.
    const start = cameraOver(
      { lat: BERN.lat - sweepDeg * 1.01, lng: BERN.lng },
      65_000 * KM,
    );
    const pin = pressPin(WGS84_ELLIPSOID, 0, start, {
      target: bernPose,
      landingM: 2 * KM,
      progress: 1,
      meteorDeg: 45,
    });
    expect(pin.flight?.path.meteorDeg).toBe(45);
    const raised = pinLanding(pin, 1_000, 3 * KM);
    expect(raised.flight?.path.meteorDeg).toBe(45);
  });

  const overOwnPlace = () => {
    const pin = pressPin(WGS84_ELLIPSOID, 0, cameraOver(BERN, 10_100 * KM), {
      target: null,
      landingM: 2 * KM,
      progress: 0,
      meteorDeg: 45,
    });
    return run(pin, 40_000, (t, p) =>
      t >= 2_000 && p.phase === "holding"
        ? pinProgress(pinFix(p, t, bernPose), t, 1)
        : p,
    );
  };

  it("fits a steeper line over its own place, backing off no more than R1's own dive", () => {
    const { pin, samples } = overOwnPlace();
    expect(pin.flight?.path.meteorDeg ?? 0).toBeGreaterThan(45);
    // Straight overhead, even R1 steps back its own dive track (about 16 km
    // at a 2 km landing) to dive in at 45; never the meteor's thousands of km.
    const after = samples.filter((s) => s.t > 2_100);
    let backward = 0;
    for (let i = 1; i < after.length; i++) {
      backward += Math.max(
        0,
        angleFromBern(after[i]!) - angleFromBern(after[i - 1]!),
      );
    }
    expect(backward * R).toBeLessThan(25 * KM);
  });

  // WHY (the milestone review, finding 7): every pacing test ran on R1's
  // path; a meteor link's path is thousands of km longer. It must still
  // start at its pace and never stop and go high up.
  it("paces a meteor link without stop and go", () => {
    const sweepDeg =
      (meteorDiveArcRad(65_000 * KM, 2 * KM, 45) * 180) / Math.PI;
    const start = cameraOver(
      { lat: BERN.lat - sweepDeg * 1.01, lng: BERN.lng },
      65_000 * KM,
    );
    const pin = pressPin(WGS84_ELLIPSOID, 0, start, {
      target: bernPose,
      landingM: 2 * KM,
      progress: 0,
      meteorDeg: 45,
    });
    const { samples } = run(pin, 150_000, (t, p) =>
      pinProgress(p, t, Math.min(1, t / 20_000)),
    );
    const high = speeds(samples).filter(
      (s) => s.t >= 1_000 && s.h > 2.5 * PIN_FLIGHT.commitM,
    );
    expect(high.length).toBeGreaterThan(30);
    expect(
      noStopAndGo(
        high.map((s) => s.v),
        0.2,
      ),
    ).toBe(true);
  });
});

// WHY (round-3 plan 2026-10-08-2345 F1b; the owner on r807: "a continuous
// direction; the camera must never bend abruptly, a continuous motion
// matters most", DEC-R3-8..10): a meteor link starts ON its straight line,
// looking along it, and flies it down to the landing at its entry angle.
// Looking along a straight line, the view's direction in space never
// changes: every sample of the flight's camera must look the same way as
// the first, within half a degree (the 1 % start margin is a small sideways
// residual), for several entry angles and landings (the owner's rule: a
// one-value verdict is provisional).
describe("a meteor link looks along one straight line (F1b)", () => {
  const forward = (q: THREE.Quaternion) =>
    new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  for (const beta of [15, 20, 30, 45]) {
    for (const landingKm of [1, 2, 5]) {
      it(`keeps its view's direction at beta ${beta}, landing ${landingKm} km`, () => {
        const from = orbitPose(WGS84_ELLIPSOID, {
          lat: BERN.lat - 30,
          lng: BERN.lng,
        }).direction;
        const start = meteorLinkStart(
          WGS84_ELLIPSOID,
          bernPose,
          from,
          65_000 * KM,
          landingKm * KM,
          beta,
        );
        const pin = pressPin(WGS84_ELLIPSOID, 0, start, {
          target: bernPose,
          landingM: landingKm * KM,
          progress: 1,
          meteorDeg: beta,
        });
        const path = pin.flight?.path;
        expect(path?.meteorDeg).toBe(beta);
        if (!path) return;
        const first = forward(start.quaternion);
        let worst = 0;
        const n = 400;
        for (let i = 0; i <= n; i++) {
          const cam = flightCamera(path, (path.durationMs * i) / n);
          worst = Math.max(worst, forward(cam.quaternion).angleTo(first));
        }
        expect((worst * 180) / Math.PI).toBeLessThan(0.5);
      });
    }
  }
});
