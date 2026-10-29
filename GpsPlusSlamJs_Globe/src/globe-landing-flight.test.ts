/**
 * The approach's landing, moved out of the globe lab's pin.
 *
 * Why this file matters: this is where a press or a link hands the camera
 * to the flight down to a place. A wrong order or value here is a first
 * frame that still shows the intro's camera, a speed dust that reads a
 * placement as a speed, a flight that lands on the ellipsoid after the
 * place's ground was read, a ground read for a place the flight no longer
 * flies to taken anyway, or a dive that lands below the clearance. The
 * recording fake approach pins every call in order with what it carries;
 * the pin flights themselves are the real `pressPin`'s.
 */
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { orbitPose } from "./globe-camera.js";
import { surfaceRadiusAlong } from "./globe-dive.js";
import { createGlobeLandingFlight } from "./globe-landing-flight.js";
import {
  meteorLinkStart,
  pinGround,
  pinProgress,
  pressPin,
  type PinFlight,
} from "./pin-flight.js";

const BERN = { lat: 46.948, lng: 7.4474 };
const ZURICH = { lat: 47.3769, lng: 8.5417 };
const PARAMS = {
  landAglM: 150,
  meteorDeg: 90,
  paceLagMs: 4000,
  paceStages: 1,
  landKm: 2,
  diveMs: 8000,
};

/** The camera 20,000 km out over Bern, looking at the centre, north up. */
function cameraPose() {
  const pose = orbitPose(WGS84_ELLIPSOID, BERN);
  const position = pose.direction.clone().multiplyScalar(2e7);
  const m = new THREE.Matrix4().lookAt(position, new THREE.Vector3(), pose.up);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  return { position, quaternion };
}

function setup({
  groundM = 500,
  relief = null,
  floorM = 0,
}: {
  groundM?: number | null;
  relief?: number | null;
  floorM?: number;
} = {}) {
  const log: string[] = [];
  let pin: PinFlight | null = null;
  let t = 1000;
  const dives: unknown[][] = [];
  const flies: unknown[][] = [];
  const placed: THREE.Vector3[] = [];
  let resolveGround!: () => void;
  const groundDone = new Promise<void>((r) => (resolveGround = r));
  const approach = {
    flyPin(now: number, p: PinFlight, place: unknown = null) {
      log.push(`flyPin ${now}`);
      flies.push([now, p, place]);
      pin = p;
    },
    aimPin(place: { lat: number }) {
      log.push(`aimPin ${place.lat}`);
    },
    updatePin(now: number, apply: (p: PinFlight, n: number) => PinFlight) {
      log.push(`updatePin ${now}`);
      if (pin) pin = apply(pin, now);
    },
    dive(...args: unknown[]) {
      log.push(`dive ${String(args[0])}`);
      dives.push(args);
    },
    get pinFlight() {
      return pin;
    },
  };
  const landing = createGlobeLandingFlight({
    approach,
    ellipsoid: WGS84_ELLIPSOID,
    controls: { release: () => log.push("release") },
    ecefCamera: () => {
      log.push("ecefCamera");
      const c = cameraPose();
      return { position: c.position, quaternion: c.quaternion };
    },
    placeCameraEcef: (p) => {
      log.push("placeCameraEcef");
      placed.push(p.clone());
    },
    resetSpeed: () => log.push("resetSpeed"),
    groundOf: (place) => {
      log.push(`groundOf ${place.lat}`);
      return { groundM, source: "tile", done: groundDone };
    },
    drawnGroundM: (g) => g * 2,
    reliefGroundM: () => relief,
    diveFloorM: (place) => {
      log.push(`diveFloorM ${place.lat}`);
      return floorM;
    },
    now: () => t,
  });
  return {
    landing,
    log,
    flies,
    dives,
    placed,
    resolveGround,
    setTime: (ms: number) => (t = ms),
    pin: () => pin,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createGlobeLandingFlight: the continuous flight", () => {
  it("locates a copy of the place", () => {
    const { landing } = setup();
    expect(landing.located).toBeNull();
    const place = { ...BERN };
    const kept = landing.locate(place);
    expect(kept).toEqual(BERN);
    expect(kept).not.toBe(place);
    expect(landing.located).toBe(kept);
  });

  it("flies from the camera as it is, held without a place", () => {
    const { landing, log, flies } = setup();
    landing.fly(null, PARAMS);
    expect(log).toEqual(["release", "ecefCamera", "flyPin 1000"]);
    const [, pin, place] = flies[0] as [number, PinFlight, unknown];
    expect(place).toBeNull();
    expect(pin.phase).toBe("holding");
    expect(pin.landingM).toBe(150);
    expect(pin.groundM).toBe(0);
    const c = cameraPose();
    expect(pin.hover.distanceM).toBe(c.position.length());
  });

  it("starts a link's flight out along the camera's direction, placed at once", () => {
    const { landing, log, flies, placed } = setup();
    landing.fly(BERN, PARAMS, { fromAltitudeM: 3e6 });
    expect(log).toEqual([
      "release",
      "ecefCamera",
      "groundOf 46.948",
      "placeCameraEcef",
      "resetSpeed",
      "flyPin 1000",
    ]);
    const direction = cameraPose().position.normalize();
    const radius = surfaceRadiusAlong(WGS84_ELLIPSOID, direction) + 3e6;
    expect(placed[0]?.length()).toBeCloseTo(radius, 3);
    const [, pin, place] = flies[0] as [number, PinFlight, unknown];
    expect(place).toBe(BERN);
    // The read ground, as drawn (the fake draws it doubled).
    expect(pin.groundM).toBe(1000);
  });

  it("starts a link's flight on the meteor's line when it has one", () => {
    const { landing, placed, flies } = setup();
    const params = { ...PARAMS, meteorDeg: 40 };
    landing.fly(BERN, params, { fromAltitudeM: 3e6 });
    const expected = meteorLinkStart(
      WGS84_ELLIPSOID,
      orbitPose(WGS84_ELLIPSOID, BERN),
      cameraPose().position,
      3e6,
      150,
      40,
      1000,
    );
    expect(placed[0]?.toArray()).toEqual(expected.position.toArray());
    const [, pin] = flies[0] as [number, PinFlight];
    expect(pin.hover).toEqual(expected);
  });

  it("aims at the located place, flies on to it, and replans onto its ground once read", async () => {
    const { landing, log, pin, resolveGround, setTime } = setup();
    landing.fly(null, PARAMS);
    landing.locate(ZURICH);
    log.length = 0;
    landing.aim();
    expect(log).toEqual([
      `aimPin ${ZURICH.lat}`,
      "updatePin 1000",
      `groundOf ${ZURICH.lat}`,
    ]);
    expect(pin()?.target).not.toBeNull();
    setTime(2000);
    resolveGround();
    await flush();
    expect(log.at(-1)).toBe("updatePin 2000");
    expect(pin()?.groundM).toBe(
      pinGround(pin() as PinFlight, 2000, 1000).groundM,
    );
  });

  it("drops a ground read for a place the flight no longer flies to, or one not read", async () => {
    for (const [ground, relocate] of [
      [500, true],
      [null, false],
    ] as const) {
      const { landing, log, resolveGround } = setup({ groundM: ground });
      landing.fly(null, PARAMS);
      landing.locate(ZURICH);
      landing.aim();
      if (relocate) landing.locate(BERN);
      log.length = 0;
      resolveGround();
      await flush();
      expect(log).toEqual([]);
    }
  });

  it("does nothing without a located place", () => {
    const { landing, log } = setup();
    landing.aim();
    landing.dive(PARAMS, (ms) => ms);
    landing.followGround(() => 1);
    expect(log).toEqual([]);
  });
});

describe("createGlobeLandingFlight: the fixed dive", () => {
  it("dives from the camera's pose to landKm, on the given clock", () => {
    const { landing, log, dives } = setup();
    landing.locate(BERN);
    const clock = (ms: number) => ms;
    landing.dive(PARAMS, clock);
    expect(log).toEqual(["ecefCamera", `diveFloorM ${BERN.lat}`, "dive 1000"]);
    const [now, target, from, options] = dives[0] as [
      number,
      unknown,
      {
        pose: { direction: THREE.Vector3; up: THREE.Vector3 };
        distanceM: number;
      },
      { durationMs: number; toAltitudeM: number; clock: unknown },
    ];
    expect(now).toBe(1000);
    expect(target).toEqual(BERN);
    const c = cameraPose();
    expect(from.distanceM).toBe(c.position.length());
    const want = orbitPose(WGS84_ELLIPSOID, BERN);
    from.pose.direction
      .toArray()
      .forEach((v, i) =>
        expect(v).toBeCloseTo(want.direction.getComponent(i), 9),
      );
    // The screen's up made perpendicular to the direction: north here.
    from.pose.up
      .toArray()
      .forEach((v, i) => expect(v).toBeCloseTo(want.up.getComponent(i), 9));
    expect(options).toEqual({ durationMs: 8000, toAltitudeM: 2000, clock });
  });

  it("never lands below the clearance over the target's ground", () => {
    const { landing, dives } = setup({ floorM: 3500 });
    landing.locate(BERN);
    landing.dive(PARAMS, (ms) => ms);
    expect((dives[0]?.[3] as { toAltitudeM: number }).toAltitudeM).toBe(3500);
  });
});

describe("createGlobeLandingFlight: per frame and the state", () => {
  it("paces the flight on the progress, and takes the relief's revised ground, counted", () => {
    const { landing, log, pin } = setup({ relief: 900 });
    expect(landing.flightState()).toBeNull();
    // A link's flight: the place's read ground, 500 m drawn as 1000 m.
    landing.fly(BERN, PARAMS);
    landing.locate(BERN);
    log.length = 0;
    const before = pin() as PinFlight;
    expect(before.groundM).toBe(1000);
    let asked = 0;
    landing.followGround(() => {
      asked += 1;
      return 0.5;
    });
    expect(asked).toBe(1);
    expect(log).toEqual(["updatePin 1000", "ecefCamera", "updatePin 1000"]);
    // Paced on that progress, then replanned onto the relief's 900 m, drawn
    // doubled (a raise far past the margin, the camera far above it).
    const paced = pinProgress(before, 1000, 0.5);
    const want = pinGround(paced, 1000, 1800);
    expect(pin()?.progress).toBe(want.progress);
    expect(pin()?.flight?.endsAtMs).toBe(want.flight?.endsAtMs);
    expect(pin()?.groundM).toBe(1800);
    expect(landing.flightState()).toMatchObject({
      groundM: 1800,
      groundSource: "tile",
      groundRevisions: 1,
      reliefGroundM: 900,
      landingM: 150,
    });
  });

  it("does not count a revision the flight did not take (a hold has no ground to replan)", () => {
    const { landing, log, pin } = setup({ relief: 900 });
    landing.fly(null, PARAMS);
    landing.locate(BERN);
    log.length = 0;
    landing.followGround(() => 0);
    // Offered (two updates), not taken: the hold stays on the ellipsoid.
    expect(log).toEqual(["updatePin 1000", "ecefCamera", "updatePin 1000"]);
    expect(pin()?.groundM).toBe(0);
    expect(landing.flightState()?.groundRevisions).toBe(0);
  });

  it("revises nothing while the relief has no height there, and does not read the progress without a flight", () => {
    const { landing, log } = setup({ relief: null });
    landing.locate(BERN);
    let asked = 0;
    landing.followGround(() => (asked += 1));
    expect(asked).toBe(0);
    expect(log).toEqual(["updatePin 1000"]);
    // A flying flight on the place's read ground (500 m, drawn as 1000 m):
    // with no relief height there, the ground stays as read, nothing is
    // counted and the flight takes only its progress. A hold would not
    // tell: its ground is the ellipsoid's, which a revision to 0 leaves.
    landing.fly(BERN, PARAMS);
    log.length = 0;
    landing.followGround(() => 0);
    expect(log.filter((l) => l.startsWith("updatePin"))).toEqual([
      "updatePin 1000",
    ]);
    expect(landing.flightState()).toMatchObject({
      groundM: 1000,
      groundRevisions: 0,
      reliefGroundM: null,
    });
  });

  it("reports the flight's own numbers", () => {
    const { landing, pin } = setup();
    landing.fly(null, PARAMS);
    const p = pin() as PinFlight;
    expect(landing.flightState()).toEqual({
      phase: p.phase,
      clockMs: p.clockMs,
      rate: p.rate,
      landingM: p.landingM,
      groundM: p.groundM,
      groundSource: null,
      groundRevisions: 0,
      reliefGroundM: null,
      meteorDeg: p.meteorDeg,
      progress: p.progress,
      gateClockMs: p.gateClockMs,
      endsAtMs: p.flight?.endsAtMs ?? null,
    });
    // `pressPin` is what the flight was built with.
    expect(p.landingM).toBe(
      pressPin(WGS84_ELLIPSOID, 0, p.hover, {
        target: null,
        landingM: 150,
        progress: 0,
      }).landingM,
    );
  });
});
