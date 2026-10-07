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

import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { obliqueCamera } from "./globe-dive.js";
import { FLIGHT_PATH } from "./flight-path.js";
import {
  PIN_FLIGHT,
  pinFailed,
  pinFix,
  pinFrame,
  pinLanding,
  pinProgress,
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
    // And it moved from the press: no hovering in place.
    expect(samples[60]?.h ?? Infinity).toBeLessThan(10_000 * KM);
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
      // (a) at 0.3, not 0.5: the cold pace flies the high stretch at half
      // speed by design (DEC-CF-3b), which a stall check must allow.
      expect(noStall(v, 0.3), tag).toBe(true);
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
