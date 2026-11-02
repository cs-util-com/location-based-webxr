/**
 * Why this test matters: a page that shows a small place (the tour editor)
 * enters on a shallow meteor and lands steep, close to the place: one
 * continuous meteor trajectory, with no settle and no tilt of its own at
 * the end. These tests fly the shared pin flight at 60 Hz with the landing
 * angle option and the meteor's pace (`METEOR_PACE`, the globe lab's) and
 * check:
 * - the camera moves and turns continuously, at a bounded angular rate and
 *   with a bounded change of that rate, and its speed changes by a bounded
 *   ratio from frame to frame over the whole flight;
 * - the view's angle below the place's horizontal never falls (shallow to
 *   steep) and is held at the landing angle over the final stretch;
 * - the flight ends within the landing's distance of the place;
 * - a retarget (`pinRetarget`) flies on from the camera as it is,
 *   continuous in position, direction and speed, high up and in the final
 *   stretch, and never onto ground raised above what the camera can clear;
 * - `pinEnd` is the flight's last camera (the reduced-motion cut).
 * Swept over three places (Munich, the far north, across the date line),
 * two start heights and four knob settings, because a verdict from one
 * setting is provisional.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import {
  METEOR_PACE,
  meteorLinkStart,
  pinEnd,
  pinFrame,
  pinProgress,
  pinRetarget,
  pressPin,
  type PinFlight,
} from "./pin-flight.js";

const KM = 1_000;
const DT = 1000 / 60;
const DEG = 180 / Math.PI;

interface Place {
  readonly lat: number;
  readonly lng: number;
}

/** Each place, and where the camera comes from (across the date line for Fiji). */
const PLACES: readonly { name: string; at: Place; from: Place }[] = [
  {
    name: "Munich",
    at: { lat: 48.1374, lng: 11.5755 },
    from: { lat: 30, lng: 11.5755 },
  },
  {
    name: "the far north",
    at: { lat: 78.2232, lng: 15.6267 },
    from: { lat: 60, lng: 15.6267 },
  },
  {
    name: "across the date line",
    at: { lat: -17.8, lng: 179.9 },
    from: { lat: -30, lng: -170 },
  },
];

interface Knobs {
  readonly meteorDeg: number;
  readonly meteorLandDeg: number;
  readonly landAglM: number;
}
const DEFAULT_KNOBS: Knobs = {
  meteorDeg: 20,
  meteorLandDeg: 50,
  landAglM: 150,
};
const KNOBS: readonly Knobs[] = [
  DEFAULT_KNOBS,
  { meteorDeg: 20, meteorLandDeg: 60, landAglM: 150 },
  { meteorDeg: 30, meteorLandDeg: 45, landAglM: 150 },
  { meteorDeg: 20, meteorLandDeg: 50, landAglM: 300 },
];
const STARTS_KM = [8_000, 65_000];

const forward = (q: THREE.Quaternion) =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(q);

interface Frame {
  readonly t: number;
  readonly position: THREE.Vector3;
  readonly view: THREE.Vector3;
}

/** A press as a page makes it: on the meteor's line, the data in at once. */
function press(
  place: Place,
  from: Place,
  startKm: number,
  knobs: Knobs,
): PinFlight {
  const target = orbitPose(WGS84_ELLIPSOID, place);
  const start = meteorLinkStart(
    WGS84_ELLIPSOID,
    target,
    orbitPose(WGS84_ELLIPSOID, from).direction,
    startKm * KM,
    knobs.landAglM,
    knobs.meteorDeg,
    0,
    knobs.meteorLandDeg,
  );
  const pin = pressPin(WGS84_ELLIPSOID, 0, start, {
    target,
    landingM: knobs.landAglM,
    progress: 0,
    meteorDeg: knobs.meteorDeg,
    meteorLandDeg: knobs.meteorLandDeg,
    paceLagMs: METEOR_PACE.lagMs,
    paceStages: METEOR_PACE.stages,
  });
  // The page's data is in from the first frame (nothing to prefetch).
  return pinProgress(pin, 0, 1);
}

type PinEvent = {
  readonly atMs: number;
  readonly apply: (p: PinFlight, t: number) => PinFlight;
};

/** Flies `pin` at 60 Hz until it lands (or 90 s), `events` applied at their time. */
function fly(
  pin: PinFlight,
  events: readonly PinEvent[] = [],
): { frames: Frame[]; pin: PinFlight } {
  const frames: Frame[] = [];
  let p = pin;
  const pending = [...events];
  for (let t = DT; t < 90_000; t += DT) {
    while (pending.length && (pending[0]?.atMs ?? Infinity) <= t) {
      const e = pending.shift();
      if (e) p = e.apply(p, t);
    }
    const out = pinFrame(p, t);
    p = out.pin;
    if (!out.camera) break;
    frames.push({
      t,
      position: out.camera.position.clone(),
      view: forward(out.camera.quaternion),
    });
    if (p.phase === "landed") break;
  }
  return { frames, pin: p };
}

/** The view's angle below the place's horizontal (its geodetic normal), degrees. */
function angleBelow(view: THREE.Vector3, place: Place): number {
  const n = WGS84_ELLIPSOID.getCartographicToNormal(
    (place.lat * Math.PI) / 180,
    (place.lng * Math.PI) / 180,
    new THREE.Vector3(),
  );
  return Math.asin(-view.dot(n)) * DEG;
}

/** The place's point on the ellipsoid. */
const placePoint = (place: Place) =>
  WGS84_ELLIPSOID.getCartographicToPosition(
    (place.lat * Math.PI) / 180,
    (place.lng * Math.PI) / 180,
    0,
    new THREE.Vector3(),
  );

/** How far the landing's camera stands from its place along its view, m. */
const reachOf = (k: Knobs) =>
  k.landAglM / Math.sin((k.meteorLandDeg * Math.PI) / 180);

const stepAt = (frames: readonly Frame[], i: number) =>
  (frames[i]?.position ?? new THREE.Vector3()).distanceTo(
    frames[i - 1]?.position ?? new THREE.Vector3(),
  );

/** The view's turn between frames i-1 and i, degrees a second. */
const turnRateAt = (frames: readonly Frame[], i: number) =>
  ((frames[i - 1]?.view ?? new THREE.Vector3()).angleTo(
    frames[i]?.view ?? new THREE.Vector3(),
  ) *
    DEG) /
  (DT / 1000);

/** The largest fall of the angle from one frame to the next (deg). */
function largestFall(angles: readonly number[]): number {
  let fall = 0;
  for (let i = 1; i < angles.length; i++) {
    fall = Math.max(fall, (angles[i - 1] ?? 0) - (angles[i] ?? 0));
  }
  return fall;
}

/** The peak turn rate and its largest change between frames (deg/s). */
function turnRates(frames: readonly Frame[]): {
  rate: number;
  rateStep: number;
} {
  let rate = 0;
  let rateStep = 0;
  for (let i = 1; i < frames.length; i++) {
    const r = turnRateAt(frames, i);
    rate = Math.max(rate, r);
    if (i > 1) {
      rateStep = Math.max(rateStep, Math.abs(r - turnRateAt(frames, i - 1)));
    }
  }
  return { rate, rateStep };
}

/**
 * The largest ratio of one frame's step to the frame's before (either way
 * round) over the whole flight, among the steps of at least `floor` times
 * the flight's longest: the ratio of two steps near rest (the first
 * frames, the last before the landing) measures rounding, not a jerk.
 */
function worstSpeedRatio(
  frames: readonly Frame[],
  floor = SPEED_FLOOR,
): number {
  const steps = frames.slice(1).map((_, i) => stepAt(frames, i + 1));
  const least = floor * Math.max(...steps);
  let worst = 1;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1] ?? 0;
    const b = steps[i] ?? 0;
    if (a < least || b < least) continue;
    worst = Math.max(worst, a / b, b / a);
  }
  return worst;
}

/**
 * The speed's bound: a step at most this many times the one before, or
 * after (both above 1 % of the longest). Measured at the meteor's pace
 * (5,000 ms in two stages), every place, start and knob setting here:
 * 1.064-1.066, all at the speed-up after the press. The pace the lab
 * replaced (800 ms in one stage, the start's jerk to full speed) measures
 * 1.23-1.25, 2,000 ms in two stages 1.12, so the bound fails on either.
 * Swept over the floor: at 0.1 % the meteor's pace measures 1.09-1.11 (the
 * old one 1.43-1.47), at 5 % 1.049 (the old 1.15).
 */
const SPEED_RATIO = 1.08;
const SPEED_FLOOR = 0.01;

describe("a shallow meteor that lands steep", () => {
  for (const { name, at, from } of PLACES) {
    for (const startKm of STARTS_KM) {
      for (const knobs of KNOBS) {
        it(`${name}, from ${startKm} km, ${knobs.meteorDeg} to ${knobs.meteorLandDeg} degrees, landing ${knobs.landAglM} m`, () => {
          const { frames, pin } = fly(press(at, from, startKm, knobs));
          expect(pin.phase).toBe("landed");
          expect(pin.meteorDeg).toBeCloseTo(knobs.meteorDeg, 2);
          const angles = frames.map((f) => angleBelow(f.view, at));
          // Shallow at the start, the landing angle at the end.
          expect(Math.abs((angles[0] ?? 0) - knobs.meteorDeg)).toBeLessThan(1);
          expect(
            Math.abs((angles.at(-1) ?? 0) - knobs.meteorLandDeg),
          ).toBeLessThan(0.5);
          // Never falls (shallow to steep), within rounding.
          expect(largestFall(angles)).toBeLessThan(0.01);
          // Held over the final stretch: the last second within a degree.
          expect(Math.min(...angles.slice(-60))).toBeGreaterThan(
            knobs.meteorLandDeg - 1,
          );
          // A gentle turn: at most 10 degrees a second, and that rate
          // changes by at most 0.2 degrees a second from frame to frame (no
          // snap). Measured peaks: 20 to 50 degrees 6.2-6.9, 20 to 60
          // 8.6-9.5, 30 to 45 under 6 (the turn from beta to the landing
          // angle happens below the bend, 100 km up, so a larger turn is a
          // faster one); the 10 is a slow pan, a third of a gentle 30.
          const { rate, rateStep } = turnRates(frames);
          expect(rate).toBeLessThan(10);
          expect(rateStep).toBeLessThan(0.2);
          // Continuous and gentle in speed over the whole flight: no jerk
          // to full speed after the press, no jump anywhere.
          expect(worstSpeedRatio(frames)).toBeLessThan(SPEED_RATIO);
          // Ends within the landing's distance of the place.
          const end = frames.at(-1)?.position ?? new THREE.Vector3();
          expect(end.distanceTo(placePoint(at))).toBeLessThan(
            reachOf(knobs) * 1.05,
          );
        });
      }
    }
  }
});

/** The camera's height over the place's ground (the ellipsoid), m. */
const heightOver = (f: Frame) =>
  WGS84_ELLIPSOID.getPositionElevation(f.position);

/** When the plain flight first comes down below `belowM` (ms). */
function firstBelow(place: (typeof PLACES)[number], belowM: number): number {
  const { frames } = fly(press(place.at, place.from, 8_000, DEFAULT_KNOBS));
  const f = frames.find((x) => heightOver(x) < belowM);
  if (!f) throw new Error(`never below ${belowM} m`);
  return f.t;
}

describe("a retarget flies on from the camera as it is", () => {
  for (const place of PLACES) {
    const { name, at } = place;
    // High up (two times), and in the final stretch: below the bend at
    // 100 km, at the landing angle, with about 5 and 1 km to go.
    const times: readonly { label: string; atMs: () => number }[] = [
      { label: "at 4000 ms", atMs: () => 4_000 },
      { label: "at 12000 ms", atMs: () => 12_000 },
      { label: "5 km up", atMs: () => firstBelow(place, 5_000) },
      { label: "1 km up", atMs: () => firstBelow(place, 1_000) },
    ];
    for (const { label, atMs: timeOf } of times) {
      it(`${name}, ${label}, to a station 400 m away`, () => {
        const atMs = timeOf();
        const station = { lat: at.lat + 0.0036, lng: at.lng };
        const { frames, pin } = fly(
          press(at, place.from, 8_000, DEFAULT_KNOBS),
          [
            {
              atMs,
              apply: (p, t) =>
                pinRetarget(p, t, orbitPose(WGS84_ELLIPSOID, station)),
            },
          ],
        );
        expect(pin.phase).toBe("landed");
        const k = frames.findIndex((f) => f.t >= atMs);
        expect(k).toBeGreaterThan(2);
        // Position and speed: the step at the retarget within 10 % of the
        // one before, and the speed's bound over the whole flight.
        const ratio = stepAt(frames, k) / stepAt(frames, k - 1);
        expect(ratio).toBeGreaterThan(0.9);
        expect(ratio).toBeLessThan(1.1);
        expect(worstSpeedRatio(frames)).toBeLessThan(SPEED_RATIO);
        // Direction: the view turns no faster there than 6 degrees a second.
        for (const i of [k - 1, k, k + 1]) {
          expect(turnRateAt(frames, i)).toBeLessThan(6);
        }
        // Never under the ground on the way.
        for (const f of frames) expect(heightOver(f)).toBeGreaterThan(0);
        // And it ends at the station.
        const end = frames.at(-1)?.position ?? new THREE.Vector3();
        expect(end.distanceTo(placePoint(station))).toBeLessThan(
          reachOf(DEFAULT_KNOBS) * 1.05,
        );
      });
    }
  }

  // Why: a retarget onto higher ground replans over the ellipsoid lifted
  // to it. In the final stretch the camera can stand below that ground, or
  // too close over it, and the new leg then starts under the surface (the
  // view flips) or nearly level from a diving camera. The ground's own
  // revision (`pinGround`) refuses such a raise; a retarget must too, and
  // keep flying to where it was going.
  it("takes no new target on ground raised above what the camera can clear", () => {
    const place = PLACES[0];
    if (!place) throw new Error("no place");
    const atMs = firstBelow(place, 1_000);
    const station = orbitPose(WGS84_ELLIPSOID, {
      lat: place.at.lat + 0.0036,
      lng: place.at.lng,
    });
    let before: PinFlight | null = null;
    let after: PinFlight | null = null;
    const { frames, pin } = fly(
      press(place.at, place.from, 8_000, DEFAULT_KNOBS),
      [
        {
          atMs,
          apply: (p, t) => {
            before = p;
            after = pinRetarget(p, t, station, 2_000);
            return after;
          },
        },
      ],
    );
    if (!before || !after) throw new Error("no retarget");
    const [was, now] = [before as PinFlight, after as PinFlight];
    expect(now.target).toBe(was.target);
    expect(now.groundM).toBe(was.groundM);
    expect(now.nowMs).toBe(atMs);
    expect(pin.phase).toBe("landed");
    expect(
      (frames.at(-1)?.position ?? new THREE.Vector3()).distanceTo(
        placePoint(place.at),
      ),
    ).toBeLessThan(reachOf(DEFAULT_KNOBS) * 1.05);
    // A raise the camera can clear (high up) is taken.
    const high = fly(press(place.at, place.from, 8_000, DEFAULT_KNOBS), [
      {
        atMs: 4_000,
        apply: (p, t) => pinRetarget(p, t, station, 2_000),
      },
    ]).pin;
    expect(high.groundM).toBe(2_000);
  });

  // Why: an ignored call returns the pin advanced to its time, as every
  // other event does, so a page that keeps the result loses no time.
  it("is ignored without a flight to a target, the pin advanced", () => {
    const target = orbitPose(WGS84_ELLIPSOID, { lat: 48, lng: 11 });
    const held = pressPin(
      WGS84_ELLIPSOID,
      0,
      { pose: target, distanceM: 6_371_000 + 8_000 * KM },
      { target: null, landingM: 150, progress: 1 },
    );
    const next = pinRetarget(held, 100, target);
    expect(next.target).toBeNull();
    expect(next.nowMs).toBe(100);
    expect(next.clockMs).toBeGreaterThan(held.clockMs);
  });
});

describe("pinEnd: the flight's last camera (the reduced-motion cut)", () => {
  it("is where the flight lands", () => {
    const first = PLACES[0];
    if (!first) throw new Error("no place");
    const pin = press(first.at, first.from, 8_000, DEFAULT_KNOBS);
    const end = pinEnd(pin);
    const last = fly(pin).frames.at(-1);
    if (!end || !last) throw new Error("no end");
    expect(end.position.distanceTo(last.position)).toBeLessThan(0.01);
    expect(forward(end.quaternion).angleTo(last.view)).toBeLessThan(1e-6);
  });
  it("is null without a flight", () => {
    const target = orbitPose(WGS84_ELLIPSOID, { lat: 48, lng: 11 });
    const held = pressPin(
      WGS84_ELLIPSOID,
      0,
      { pose: target, distanceM: 6_371_000 + 1_000 * KM },
      { target: null, landingM: 150, progress: 1 },
    );
    expect(pinEnd(held)).toBeNull();
  });
});
