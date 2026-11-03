/**
 * Why these tests matter: the editor's approach is the globe's own meteor
 * flight (the shared pin flight, one set of rules with the globe lab), run
 * on the editor's camera. These tests fly it as the page does, at 60 Hz on
 * a stand-in view, and check at the editor's end:
 * - one continuous trajectory from high above to close to the tour,
 *   entering shallow and landing at the landing angle, turning gently, its
 *   speed changing by a bounded ratio from frame to frame over the whole
 *   flight (the globe lab's pace, `METEOR_PACE`);
 * - it is paced by what loads at the tour (`tourArrivalProgress`), lands
 *   soon after that is in, and still lands when it never is (the flight's
 *   safety cap);
 * - it flies only while approaching or descending;
 * - a tour below the ellipsoid lands over the ellipsoid;
 * - reduced motion is a cut to the end view;
 * - a pick mid-flight is a new leg from the camera as it is;
 * - the bar follows the height and only rises;
 * - the flight places the camera only, never the view's frame (the frame
 *   is no longer moved per frame);
 * - without a startKm it starts where the globe lab's intro zooms out to,
 *   the whole Earth in view at every aspect (phone portrait and landscape,
 *   desktop), still at the meteor's pace; it restarts the speed streaks
 *   where it places the camera.
 * The flight's own maths is swept over places and knobs in the globe
 * package (`pin-flight-meteor-entry.test.ts`); here three places times three knob settings.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  GLOBE_INTRO,
  METEOR_PACE,
  globeViewFitM,
} from "gps-plus-slam-globe/view";
import { WGS84_ELLIPSOID } from "gps-plus-slam-globe/test-utils/view-pose";

import { readGlobeSwitch } from "../editor/globe-switch.js";
import {
  createMeteorApproach,
  isFlyingPhase,
  meteorStartAltitudeM,
  tourArrivalProgress,
  type MeteorKnobs,
} from "./globe-approach-meteor.js";

const DT = 1000 / 60;
const DEG = Math.PI / 180;
const MUNICH = { lat: 48.1374, lng: 11.5755 };
const GROUND_M = 520;
/** Marienplatz, a high-latitude goal (Tromso) and one across the date
 *  line (Taveuni, Fiji): the meteor comes from the south, so the far north
 *  and the 180th meridian are where its line could go wrong. */
const PLACES = [
  { name: "Marienplatz", place: MUNICH },
  { name: "Tromso", place: { lat: 69.6492, lng: 18.9553 } },
  { name: "the date line", place: { lat: -16.8, lng: -179.98 } },
] as const;
const DEFAULTS: MeteorKnobs = readGlobeSwitch("");
/** The aspects the start is checked at: a phone in portrait and in
 *  landscape, a desktop, a square. */
const ASPECTS = [
  { name: "phone portrait", aspect: 390 / 844 },
  { name: "phone landscape", aspect: 844 / 390 },
  { name: "desktop", aspect: 16 / 9 },
  { name: "square", aspect: 1 },
] as const;
const DESKTOP = 16 / 9;
const RADIUS_M = WGS84_ELLIPSOID.radius.x;
/** The start height of `knobs` at `aspect` (km over the ellipsoid). */
const startKmOf = (knobs: MeteorKnobs, aspect = DESKTOP) =>
  meteorStartAltitudeM({
    radiusM: RADIUS_M,
    fovYDeg: 50,
    aspect,
    startKm: knobs.startKm,
  }) / 1000;
const SETTINGS: readonly MeteorKnobs[] = [
  DEFAULTS,
  { ...DEFAULTS, meteorLandDeg: 60 },
  { ...DEFAULTS, meteorDeg: 30, meteorLandDeg: 45, startKm: 65_000 },
];

/** A stand-in for the globe view: the camera in ECEF, and a frame that must
 *  never be set by the flight. */
function standInView() {
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 1e9);
  const frameCalls: string[] = [];
  return {
    camera,
    frameCalls,
    ecefCamera: () => ({
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
    }),
    placeCameraEcef(position: THREE.Vector3, quaternion: THREE.Quaternion) {
      camera.position.copy(position);
      camera.quaternion.copy(quaternion);
    },
    fitDistance: () => 20_000_000,
    placeView() {
      frameCalls.push("placeView");
    },
    setFrameTarget() {
      frameCalls.push("setFrameTarget");
    },
  };
}

interface Frame {
  readonly t: number;
  readonly position: THREE.Vector3;
  readonly view: THREE.Vector3;
}

/** The approach on a stand-in view, its clock the test's. */
function approachOf(
  knobs: MeteorKnobs,
  options: {
    progress?: () => number;
    reducedMotion?: boolean;
    durationMs?: number;
    tour?: { lat: number; lng: number };
    groundM?: number;
    aspect?: number;
  } = {},
) {
  const clock = { t: 0 };
  const view = standInView();
  let released = 0;
  let speedResets = 0;
  const driver = createMeteorApproach({
    ellipsoid: WGS84_ELLIPSOID,
    view,
    controls: {
      release() {
        released++;
      },
    },
    tour: options.tour ?? MUNICH,
    groundM: options.groundM ?? GROUND_M,
    knobs,
    progress: options.progress ?? (() => 1),
    reliefGroundM: () => null,
    reducedMotion: options.reducedMotion ?? false,
    aspect: options.aspect ?? DESKTOP,
    resetSpeed: () => {
      speedResets++;
    },
    ...(options.durationMs === undefined
      ? {}
      : { durationMs: options.durationMs }),
    now: () => clock.t,
  });
  return {
    clock,
    view,
    driver,
    released: () => released,
    speedResets: () => speedResets,
  };
}

type Approach = ReturnType<typeof approachOf>;

/** Flies at 60 Hz from `fromMs` until it lands (or `maxMs`). */
function fly(
  a: Approach,
  { fromMs = 0, maxMs = 120_000, at = new Map<number, () => void>() } = {},
): { frames: Frame[]; landedAt: number | null } {
  const frames: Frame[] = [];
  const events = [...at.entries()].sort((x, y) => x[0] - y[0]);
  for (let t = fromMs; t < maxMs; t += DT) {
    while (events.length && (events[0]?.[0] ?? Infinity) <= t) {
      events.shift()?.[1]();
    }
    a.clock.t = t;
    if (t === fromMs) a.driver.start(t);
    const flying = a.driver.drive(t);
    frames.push({
      t,
      position: a.view.camera.position.clone(),
      view: new THREE.Vector3(0, 0, -1).applyQuaternion(
        a.view.camera.quaternion,
      ),
    });
    if (!flying) return { frames, landedAt: t };
  }
  return { frames, landedAt: null };
}

/** The tour's point at its ground, ECEF. */
const pointOf = (place: { lat: number; lng: number }, heightM = GROUND_M) =>
  WGS84_ELLIPSOID.getCartographicToPosition(
    place.lat * DEG,
    place.lng * DEG,
    heightM,
    new THREE.Vector3(),
  );

/** The view's angle below the tour's horizontal, degrees. */
function angleBelow(
  view: THREE.Vector3,
  place: { lat: number; lng: number } = MUNICH,
): number {
  const n = WGS84_ELLIPSOID.getCartographicToNormal(
    place.lat * DEG,
    place.lng * DEG,
    new THREE.Vector3(),
  );
  return Math.asin(-view.dot(n)) / DEG;
}

const reachOf = (k: MeteorKnobs) =>
  k.landAglM / Math.sin(k.meteorLandDeg * DEG);

const step = (frames: readonly Frame[], i: number) =>
  (frames[i]?.position ?? new THREE.Vector3()).distanceTo(
    frames[i - 1]?.position ?? new THREE.Vector3(),
  );

const turnRate = (frames: readonly Frame[], i: number) =>
  ((frames[i - 1]?.view ?? new THREE.Vector3()).angleTo(
    frames[i]?.view ?? new THREE.Vector3(),
  ) /
    DEG /
    DT) *
  1000;

/**
 * The largest ratio of one frame's step to the one before (either way
 * round) over the whole flight, among the steps of at least 1 % of the
 * flight's longest (two steps near rest, the first frames and the last
 * before the landing, measure rounding, not a jerk).
 */
function worstSpeedRatio(frames: readonly Frame[]): number {
  const steps = frames.slice(1).map((_, i) => step(frames, i + 1));
  const least = 0.01 * Math.max(...steps);
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
 * The speed's bound, as the globe package's sweep
 * (`pin-flight-meteor-entry.test.ts`): the meteor's pace measures about
 * 1.065 there, the pace it replaced (800 ms in one stage) 1.23-1.25.
 */
const SPEED_RATIO = 1.08;

/** The altitude over the ellipsoid of a frame's camera, km. */
const altitudeKm = (f: Frame) =>
  WGS84_ELLIPSOID.getPositionElevation(f.position) / 1000;

describe("the editor's meteor approach", () => {
  for (const { name, place } of PLACES)
    for (const knobs of SETTINGS) {
      it(`lands close to ${name}, ${knobs.meteorDeg} to ${knobs.meteorLandDeg} degrees from ${knobs.startKm ?? "the zoom-out"} km`, () => {
        const a = approachOf(knobs, { tour: place });
        const { frames, landedAt } = fly(a);
        expect(landedAt).not.toBeNull();
        // Starts out there, on the meteor's line.
        const first = frames[0];
        if (!first) throw new Error("no frame");
        expect(altitudeKm(first)).toBeGreaterThan(startKmOf(knobs) * 0.9);
        expect(
          Math.abs(angleBelow(first.view, place) - knobs.meteorDeg),
        ).toBeLessThan(1);
        // Ends within the landing's reach of the tour, at the landing angle.
        const last = frames.at(-1);
        if (!last) throw new Error("no frame");
        expect(last.position.distanceTo(pointOf(place))).toBeLessThan(
          reachOf(knobs) * 1.05,
        );
        expect(
          Math.abs(angleBelow(last.view, place) - knobs.meteorLandDeg),
        ).toBeLessThan(0.5);
        // Gentle and continuous: the pin flight's own bounds (measured peaks
        // under 10 degrees a second, see the globe package's sweep), and
        // the speed's bound over the whole flight.
        for (let i = 2; i < frames.length - 1; i++) {
          expect(turnRate(frames, i)).toBeLessThan(10);
        }
        expect(worstSpeedRatio(frames)).toBeLessThan(SPEED_RATIO);
        // The camera only: the view's frame is never set by the flight.
        expect(a.view.frameCalls).toEqual([]);
      });
    }

  it("places the camera out on the meteor's line before the first frame", () => {
    // Why: no frame may show the camera anywhere else first (the view is
    // drawn once before the flight's first drive).
    const a = approachOf(DEFAULTS);
    const at = a.view.camera.position.clone();
    expect(WGS84_ELLIPSOID.getPositionElevation(at) / 1000).toBeGreaterThan(
      startKmOf(DEFAULTS) * 0.9,
    );
    a.clock.t = 5_000;
    a.driver.start(5_000);
    a.driver.drive(5_000);
    // The clock starts at the first frame: still at the start.
    expect(a.view.camera.position.distanceTo(at)).toBeLessThan(1);
    expect(a.released()).toBeGreaterThan(0);
  });

  for (const { name, aspect } of ASPECTS) {
    it(`starts with the whole Earth in view on a ${name}, at the meteor's pace`, () => {
      // Why: the approach began at 8,000 km, so close that the Earth
      // filled the screen; it now starts where the globe lab's intro zooms
      // out to (GLOBE_INTRO.maxKm from the centre, at least twice the fit),
      // so the first frame shows the whole globe at every aspect, and the
      // longer flight still keeps the meteor's speed bound. 25 km of slack:
      // the start stands on the surface along its line, under the
      // equatorial radius away from the equator.
      const a = approachOf(DEFAULTS, { aspect });
      const fitM = globeViewFitM({ radiusM: RADIUS_M, fovYDeg: 50, aspect });
      const startCentreM = a.view.camera.position.length();
      expect(startCentreM).toBeGreaterThanOrEqual(fitM);
      expect(startCentreM).toBeGreaterThanOrEqual(
        GLOBE_INTRO.maxKm * 1000 - 25_000,
      );
      expect(startCentreM).toBeGreaterThanOrEqual(2 * fitM - 25_000);
      const { frames, landedAt } = fly(a);
      expect(landedAt).not.toBeNull();
      expect(frames[0]?.position.length() ?? 0).toBeGreaterThanOrEqual(fitM);
      expect(worstSpeedRatio(frames)).toBeLessThan(SPEED_RATIO);
    });
  }

  it("starts at the link's startKm when it names one", () => {
    // Why: startKm stays an explicit override for tuning by eye.
    const a = approachOf({ ...DEFAULTS, startKm: 8_000 });
    const km =
      WGS84_ELLIPSOID.getPositionElevation(a.view.camera.position) / 1000;
    expect(Math.abs(km - 8_000)).toBeLessThan(50);
  });

  it("restarts the speed streaks where it places the camera", () => {
    // Why: a placement is a teleport, not a speed; without the reset the
    // dust would read the jump to the start as thousands of km/s.
    const a = approachOf(DEFAULTS);
    expect(a.speedResets()).toBeGreaterThan(0);
  });

  it("is paced by the tour's loading, and lands without it by the safety cap", () => {
    // Why: as in the globe lab the flight waits for the data before its
    // final stretch, but never forever: a tour whose loading never ends
    // still lands, inside the flight's own cap.
    const fast = fly(approachOf(DEFAULTS)).landedAt ?? Infinity;
    const waiting = fly(approachOf(DEFAULTS, { progress: () => 0 }));
    expect(waiting.landedAt).not.toBeNull();
    expect(waiting.landedAt ?? 0).toBeGreaterThan(fast + 5_000);
    expect(waiting.landedAt ?? Infinity).toBeLessThan(fast + 60_000);
    expect(worstSpeedRatio(waiting.frames)).toBeLessThan(SPEED_RATIO);
  });

  for (const inAtMs of [2_000, 6_000, 12_000]) {
    it(`lands soon after the tour is in at ${inAtMs} ms, well before the safety cap, never before`, () => {
      // Why: what loads at the tour comes in some seconds after the press;
      // the flight waits for it before its final stretch, then flies on at
      // the meteor's pace (no jerk where it is released) and lands well
      // before the cap. A flight that landed before the load, or only by
      // the cap, would not be paced by it at all.
      const box: { a?: Approach } = {};
      const a = approachOf(DEFAULTS, {
        progress: () => ((box.a?.clock.t ?? 0) >= inAtMs ? 1 : 0),
      });
      box.a = a;
      const { frames, landedAt } = fly(a);
      expect(landedAt).not.toBeNull();
      const t = landedAt ?? Infinity;
      const capped = fly(approachOf(DEFAULTS, { progress: () => 0 })).landedAt;
      expect(t).toBeGreaterThan(inAtMs);
      expect(t).toBeLessThan((capped ?? 0) - 15_000);
      expect(worstSpeedRatio(frames)).toBeLessThan(SPEED_RATIO);
    });
  }

  it("is not in until the ground at the tour is known, the relief settled and the stations admitted", () => {
    // Why: the editor's own "loaded" was only its stations' uploads, which
    // finish in a few frames whatever the camera does: the gate never
    // waited on anything. The relief's ground at the tour (its height
    // known, nothing of the relief loading) is what the landing stands on.
    const all = {
      stations: 4,
      admitted: 4,
      groundKnown: true,
      reliefSettled: true,
    };
    expect(tourArrivalProgress(all)).toBe(1);
    expect(tourArrivalProgress({ ...all, groundKnown: false })).toBe(0);
    expect(tourArrivalProgress({ ...all, reliefSettled: false })).toBe(0);
    expect(tourArrivalProgress({ ...all, admitted: 2 })).toBe(0.5);
    expect(tourArrivalProgress({ ...all, stations: 0, admitted: 0 })).toBe(1);
    expect(tourArrivalProgress({ ...all, admitted: 9 })).toBe(1);
  });

  it("flies only while approaching or descending", () => {
    // Why: every phase but "landed" counted as flying, so a flight that
    // ended any other way (cancelled, failed, or none at all) kept the
    // approach's bar up and the page waiting for a landing.
    expect(isFlyingPhase("approaching")).toBe(true);
    expect(isFlyingPhase("descending")).toBe(true);
    for (const phase of [
      "holding",
      "landed",
      "failed",
      "cancelled",
      undefined,
    ]) {
      expect(isFlyingPhase(phase)).toBe(false);
    }
  });

  it("lands a tour below the ellipsoid over the ellipsoid", () => {
    // Why: the flight plans over the ellipsoid lifted to the ground and
    // takes no ground below it, so a tour below sea level (the Dead Sea,
    // about 430 m under) lands its landing height over the ellipsoid:
    // higher over its own ground by that much, never under it.
    const deadSea = { lat: 31.5, lng: 35.5 };
    const a = approachOf(DEFAULTS, { tour: deadSea, groundM: -430 });
    const { frames, landedAt } = fly(a);
    expect(landedAt).not.toBeNull();
    const last = frames.at(-1);
    if (!last) throw new Error("no frame");
    expect(altitudeKm(last) * 1000).toBeGreaterThan(DEFAULTS.landAglM * 0.9);
    expect(altitudeKm(last) * 1000).toBeLessThan(DEFAULTS.landAglM * 1.1);
    expect(worstSpeedRatio(frames)).toBeLessThan(SPEED_RATIO);
  });

  it("runs on the page's checks' clock when told how long to take", () => {
    // Why: the page's checks set the flight's length (long to retarget or
    // take it mid-flight, short to see it land); the path is the same.
    // The meteor's pace starts slow and reaches its full pace over its lag
    // (`METEOR_PACE`), so a flight lands up to that lag of flight time
    // later than its length at a full pace: on the checks' clock, the lag
    // shortened by the same factor as the flight.
    const natural = approachOf(DEFAULTS).driver.durationMs;
    for (const durationMs of [3_000, 6_000]) {
      const a = approachOf(DEFAULTS, { durationMs });
      expect(a.driver.durationMs).toBe(durationMs);
      const landedAt = fly(a).landedAt ?? Infinity;
      const leadInMs = (METEOR_PACE.lagMs * durationMs) / natural;
      expect(landedAt).toBeGreaterThan(durationMs * 0.9);
      expect(landedAt).toBeLessThan(durationMs * 1.1 + leadInMs);
    }
    expect(natural).toBeGreaterThan(5_000);
    expect(natural).toBeLessThan(60_000);
  });

  it("under reduced motion cuts to the end view", () => {
    // Why: no flight at all under reduced motion; the first frame is the
    // landing's view, and nothing moves after it.
    const a = approachOf(DEFAULTS, { reducedMotion: true });
    expect(a.driver.durationMs).toBe(0);
    a.driver.start(0);
    expect(a.driver.drive(0)).toBe(false);
    const end = a.view.camera.position.clone();
    expect(end.distanceTo(pointOf(MUNICH))).toBeLessThan(
      reachOf(DEFAULTS) * 1.05,
    );
    const view = new THREE.Vector3(0, 0, -1).applyQuaternion(
      a.view.camera.quaternion,
    );
    expect(Math.abs(angleBelow(view) - DEFAULTS.meteorLandDeg)).toBeLessThan(
      0.5,
    );
    a.clock.t = 1_000;
    a.driver.drive(1_000);
    expect(a.view.camera.position.distanceTo(end)).toBe(0);
  });

  it("stops where the creator takes the camera", () => {
    // Why: an input takes the camera where it is; the flight must not move
    // it again (a drive after it places nothing and says it is not flying).
    const a = approachOf(DEFAULTS);
    const at = new Map([[3_000, () => a.driver.takeOver(3_000)]]);
    const { frames } = fly(a, { maxMs: 3_100, at });
    const held = frames.at(-1)?.position ?? new THREE.Vector3();
    for (const t of [3_200, 8_000]) {
      a.clock.t = t;
      expect(a.driver.drive(t)).toBe(false);
      expect(a.view.camera.position.distanceTo(held)).toBe(0);
    }
  });

  /** When the plain flight first comes down below `belowM` over the
   *  tour's ground (ms). */
  const firstBelow = (belowM: number) => {
    const f = fly(approachOf(DEFAULTS)).frames.find(
      (x) => altitudeKm(x) * 1000 - GROUND_M < belowM,
    );
    if (!f) throw new Error(`never below ${belowM} m`);
    return f.t;
  };
  const RETARGETS: readonly { label: string; atMs: () => number }[] = [
    { label: "at 3000 ms", atMs: () => 3_000 },
    { label: "at 9000 ms", atMs: () => 9_000 },
    // Below the bend, in the final stretch at the landing angle.
    { label: "5 km up", atMs: () => firstBelow(5_000) },
    { label: "1 km up", atMs: () => firstBelow(1_000) },
  ];
  for (const { label, atMs: timeOf } of RETARGETS) {
    it(`retargets ${label} from the camera as it is`, () => {
      // Why: a station picked mid-flight is a new leg of the same flight,
      // continuous in position, direction and speed, ending at the station
      // (at the meteor's landing, whatever the station's size).
      const atMs = timeOf();
      const a = approachOf(DEFAULTS);
      const station = { lat: MUNICH.lat + 0.0036, lng: MUNICH.lng };
      const at = new Map([
        [atMs, () => a.driver.retarget(station, GROUND_M + 10)],
      ]);
      const { frames, landedAt } = fly(a, { at });
      expect(landedAt).not.toBeNull();
      const k = frames.findIndex((f) => f.t >= atMs);
      const ratio = step(frames, k) / step(frames, k - 1);
      expect(ratio).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(1.1);
      expect(worstSpeedRatio(frames)).toBeLessThan(SPEED_RATIO);
      // The retarget's own frames turn gently; the frame before it is the
      // plain flight, held to the flight's own bound (from the lab's
      // zoom-out distance it measures up to 6.4 degrees a second 1-2 km
      // up, the leg after the retarget at most 5.7).
      expect(turnRate(frames, k - 1)).toBeLessThan(10);
      for (const i of [k, k + 1]) {
        expect(turnRate(frames, i)).toBeLessThan(6);
      }
      expect(
        (frames.at(-1)?.position ?? new THREE.Vector3()).distanceTo(
          pointOf(station, GROUND_M + 10),
        ),
      ).toBeLessThan(reachOf(DEFAULTS) * 1.05);
    });
  }

  it("moves the bar from 0 to 1 with the height, never back", () => {
    // Why: the bar reads the camera's fall, on a log scale from the start
    // height to the landing's, so it moves through the whole flight.
    const a = approachOf(DEFAULTS);
    const { frames } = fly(a);
    const bars = frames.map((f) => a.driver.bar(altitudeKm(f)));
    expect(bars[0] ?? 1).toBeLessThan(0.02);
    expect(bars.at(-1) ?? 0).toBeGreaterThan(0.98);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i] ?? 0).toBeGreaterThanOrEqual((bars[i - 1] ?? 0) - 1e-9);
    }
    const mid = bars[Math.floor(bars.length / 2)] ?? 0;
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.9);
    expect(a.driver.bar(Number.NaN)).toBe(0);
  });
});
