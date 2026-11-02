/**
 * Why these tests matter: the editor's approach is the globe's own meteor
 * flight (the shared pin flight, one set of rules with the globe lab), run
 * on the editor's camera. These tests fly it as the page does, at 60 Hz on
 * a stand-in view, and check the owner's rules at the editor's end:
 * - one continuous trajectory from high above to close to the tour,
 *   entering shallow and landing at the landing angle, turning gently;
 * - it is paced by the tour's own loading and still lands when that never
 *   finishes (the flight's safety cap);
 * - reduced motion is a cut to the end view;
 * - a pick mid-flight is a new leg from the camera as it is;
 * - the bar follows the height and only rises;
 * - the flight places the camera only, never the view's frame: a frame set
 *   each frame is what made the old approach flicker.
 * The flight's own maths is swept over places and knobs in the globe
 * package (`pin-flight-meteor-entry.test.ts`); here three places times three knob settings.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "gps-plus-slam-globe/test-utils/view-pose";

import { readGlobeSwitch } from "../editor/globe-switch.js";
import {
  createMeteorApproach,
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
  } = {},
) {
  const clock = { t: 0 };
  const view = standInView();
  let released = 0;
  const driver = createMeteorApproach({
    ellipsoid: WGS84_ELLIPSOID,
    view,
    controls: {
      release() {
        released++;
      },
    },
    tour: options.tour ?? MUNICH,
    groundM: GROUND_M,
    knobs,
    progress: options.progress ?? (() => 1),
    reliefGroundM: () => null,
    reducedMotion: options.reducedMotion ?? false,
    ...(options.durationMs === undefined
      ? {}
      : { durationMs: options.durationMs }),
    now: () => clock.t,
  });
  return { clock, view, driver, released: () => released };
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

/** The altitude over the ellipsoid of a frame's camera, km. */
const altitudeKm = (f: Frame) =>
  WGS84_ELLIPSOID.getPositionElevation(f.position) / 1000;

describe("the editor's meteor approach", () => {
  for (const { name, place } of PLACES)
    for (const knobs of SETTINGS) {
      it(`lands close to ${name}, ${knobs.meteorDeg} to ${knobs.meteorLandDeg} degrees from ${knobs.startKm} km`, () => {
        const a = approachOf(knobs, { tour: place });
        const { frames, landedAt } = fly(a);
        expect(landedAt).not.toBeNull();
        // Starts out there, on the meteor's line.
        const first = frames[0];
        if (!first) throw new Error("no frame");
        expect(altitudeKm(first)).toBeGreaterThan(knobs.startKm * 0.9);
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
        // under 10 degrees a second, see the globe package's sweep).
        for (let i = 2; i < frames.length - 1; i++) {
          expect(turnRate(frames, i)).toBeLessThan(10);
          expect(step(frames, i)).toBeLessThanOrEqual(
            2 * Math.max(step(frames, i - 1), step(frames, i + 1)) + 1e-3,
          );
        }
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
      DEFAULTS.startKm * 0.9,
    );
    a.clock.t = 5_000;
    a.driver.start(5_000);
    a.driver.drive(5_000);
    // The clock starts at the first frame: still at the start.
    expect(a.view.camera.position.distanceTo(at)).toBeLessThan(1);
    expect(a.released()).toBeGreaterThan(0);
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
  });

  it("runs on the page's checks' clock when told how long to take", () => {
    // Why: the page's checks set the flight's length (long to retarget or
    // take it mid-flight, short to see it land); the path is the same.
    for (const durationMs of [3_000, 6_000]) {
      const a = approachOf(DEFAULTS, { durationMs });
      expect(a.driver.durationMs).toBe(durationMs);
      const landedAt = fly(a).landedAt ?? Infinity;
      expect(landedAt).toBeGreaterThan(durationMs * 0.9);
      expect(landedAt).toBeLessThan(durationMs * 1.3);
    }
    const natural = approachOf(DEFAULTS).driver.durationMs;
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

  for (const atMs of [3_000, 9_000]) {
    it(`retargets at ${atMs} ms from the camera as it is`, () => {
      // Why: a station picked mid-flight is a new leg of the same flight,
      // continuous in position, direction and speed, ending at the station.
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
      for (const i of [k - 1, k, k + 1]) {
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
