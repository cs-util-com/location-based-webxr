/**
 * Why these tests matter: a drag in the 3D view follows the SAMPLED
 * ground under the pointer, and the ground streams in: a pointer over
 * ground not loaded yet must wait for it and try again (else the object
 * jumps to a wrong height, or freezes for good), while a pointer over the
 * sky must not be retried every frame forever. A click on a handle that
 * moved nothing must write nothing (an empty undo step), and each handle
 * must write the one edit it stands for - a move, a turn, a radius, a
 * size - with the height rule applied.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { createTourViewerStore } from "../tour-viewer-session.js";
import type { ScreenPoint } from "./gizmo-maths.js";
import {
  poseLocked,
  startGesture,
  startKeyGesture,
  type GestureTarget,
  type GestureWorld,
  type GroundUnder,
} from "./gesture.js";
import { liftedGeo, nudgedGeo, turnedGeo } from "./pose-edits.js";

// The geodesy is licence-gated; the store activates it (as the page does).
beforeAll(() => {
  createTourViewerStore();
});

/** A world where a screen pixel is a metre on the ground (x east, the
 *  screen's y south), the place is the spot in metres (lat = -z, lon =
 *  x), and the ground's height is `ground(place)`. */
function flatWorld(
  ground: (p: { lat: number; lon: number }) => number | null = () => 100,
  under: (p: ScreenPoint) => GroundUnder = (p) => ({
    at: { x: p.x, y: 0, z: p.y },
  }),
) {
  const calls = { under: 0 };
  const world: GestureWorld = {
    groundUnder: (p) => {
      calls.under++;
      return under(p);
    },
    planeUnder: (p, y) => ({ x: p.x, y, z: p.y }),
    placeOf: (at) => ({ lat: -at.z, lon: at.x }),
    groundAt: (place) => ground(place),
  };
  return { world, calls };
}

const PIN: GestureTarget = {
  kind: "item",
  id: "pin",
  geo: { lat: 0, lon: 0, alt: 101.5, headingDeg: 0 },
  sizeM: null,
  centre: { x: 0, y: 0, z: 0 },
};

function at(x: number, y: number): ScreenPoint {
  return { x, y };
}

describe("a move", () => {
  it("follows the ground under the pointer from where it was grabbed, keeping the height above it", () => {
    const heights = (p: { lat: number; lon: number }) => 100 + p.lon / 10;
    const { world } = flatWorld(heights);
    const g = startGesture("move", PIN, at(2, 0), world);
    expect(g).not.toBeNull();
    g?.move(at(12, -5), false);
    // Grabbed 2 m east of the pin: the pin goes 10 m east, 5 m north.
    const geo = g?.preview().geo as QrGeoPose;
    expect(geo.lon).toBeCloseTo(10, 9);
    expect(geo.lat).toBeCloseTo(5, 9);
    expect(geo.alt - heights(geo)).toBeCloseTo(1.5, 9);
    expect(g?.edit()).toEqual({ kind: "item-pose", id: "pin", geo });
  });

  it("snaps to half metres with Shift", () => {
    const { world } = flatWorld();
    const g = startGesture("move", PIN, at(0, 0), world);
    g?.move(at(3.3, -1.1), true);
    expect(g?.preview().geo.lon).toBeCloseTo(3.5, 9);
    expect(g?.preview().geo.lat).toBeCloseTo(1, 9);
  });

  it("waits on ground not loaded and tries again each frame until it loads", () => {
    let loaded = false;
    const { world, calls } = flatWorld(undefined, (p) =>
      loaded ? { at: { x: p.x, y: 0, z: p.y } } : { miss: "not-loaded" },
    );
    const g = startGesture("move", PIN, at(0, 0), {
      ...world,
      // The grab itself finds no ground: the level plane stands in.
      groundUnder: (p) => world.groundUnder(p),
    });
    expect(g).not.toBeNull();
    g?.move(at(4, 0), false);
    expect(g?.waiting()).toBe(true);
    expect(g?.preview().geo).toEqual(PIN.geo);
    const before = calls.under;
    g?.retry();
    expect(calls.under).toBe(before + 1);
    expect(g?.waiting()).toBe(true);
    loaded = true;
    g?.retry();
    expect(g?.waiting()).toBe(false);
    expect(g?.preview().geo.lon).toBeCloseTo(4, 9);
  });

  it("does not retry a pointer over the sky or under the ground", () => {
    for (const miss of ["above", "below-start", "out-of-reach"] as const) {
      const { world, calls } = flatWorld(undefined, (p) =>
        p.x > 1 ? { miss } : { at: { x: p.x, y: 0, z: p.y } },
      );
      const g = startGesture("move", PIN, at(0, 0), world);
      g?.move(at(1, 0), false);
      g?.move(at(9, 0), false);
      expect(g?.waiting()).toBe(false);
      const before = calls.under;
      g?.retry();
      g?.retry();
      expect(calls.under).toBe(before);
      // The last spot the ground was found at stays.
      expect(g?.preview().geo.lon).toBeCloseTo(1, 9);
    }
  });

  it("waits while the ground under the new spot has no height yet", () => {
    let known = false;
    const { world } = flatWorld((p) => (p.lon > 5 && !known ? null : 100));
    const g = startGesture("move", PIN, at(0, 0), world);
    g?.move(at(8, 0), false);
    expect(g?.waiting()).toBe(true);
    known = true;
    g?.retry();
    expect(g?.preview().geo.lon).toBeCloseTo(8, 9);
  });

  it("starts on the level plane when the ground under the grab is missing, and not at all with neither", () => {
    const { world } = flatWorld(undefined, () => ({ miss: "not-loaded" }));
    expect(startGesture("move", PIN, at(0, 0), world)).not.toBeNull();
    expect(
      startGesture("move", PIN, at(0, 0), {
        ...world,
        planeUnder: () => null,
      }),
    ).toBeNull();
  });

  it("writes nothing for a grab that moved nothing", () => {
    const { world } = flatWorld();
    const g = startGesture("move", PIN, at(1, 1), world);
    g?.move(at(1, 1), false);
    expect(g?.edit()).toBeNull();
  });

  it("moves a station's anchor, keeping its height above the ground", () => {
    const { world } = flatWorld((p) => 50 + p.lat);
    const station: GestureTarget = {
      kind: "station",
      id: "st",
      geo: { lat: 0, lon: 0, alt: 50, headingDeg: 20 },
      foundRadiusM: 12,
      centre: { x: 0, y: 0, z: 0 },
    };
    const g = startGesture("move", station, at(0, 0), world);
    g?.move(at(0, -7), false);
    expect(g?.edit()).toEqual({
      kind: "station-pose",
      id: "st",
      geo: { lat: 7, lon: 0, alt: 57, headingDeg: 20 },
    });
  });
});

describe("a turn", () => {
  it("turns by the knob's sweep round the centre, in whole degrees", () => {
    const { world } = flatWorld();
    // The knob north of the pin; swept to the east.
    const g = startGesture("turn", PIN, at(0, -10), world);
    g?.move(at(10, 0), false);
    const edit = g?.edit();
    expect(edit?.kind).toBe("item-pose");
    expect(edit?.kind === "item-pose" ? edit.geo.headingDeg : null).toBe(90);
  });
});

describe("a dot", () => {
  it("sets a station's radius from the dot's distance", () => {
    const { world } = flatWorld();
    const station: GestureTarget = {
      kind: "station",
      id: "st",
      geo: { lat: 0, lon: 0, alt: 100, headingDeg: 0 },
      foundRadiusM: 12,
      centre: { x: 0, y: 0, z: 0 },
    };
    const g = startGesture("dot", station, at(12, 0), world);
    g?.move(at(20.3, 0), false);
    expect(g?.edit()).toEqual({ kind: "radius", id: "st", foundRadiusM: 20.5 });
  });

  it("sets a model's size by the dot's distance against where it was grabbed", () => {
    const { world } = flatWorld();
    const model: GestureTarget = { ...PIN, id: "m", sizeM: 2 };
    const g = startGesture("dot", model, at(0, 4), world);
    g?.move(at(0, 8), false);
    expect(g?.edit()).toEqual({ kind: "size", id: "m", sizeM: 4 });
  });

  it("is no handle of a pin or a photo", () => {
    const { world } = flatWorld();
    expect(startGesture("dot", PIN, at(1, 0), world)).toBeNull();
  });
});

describe("a key gesture", () => {
  const STATION: GestureTarget = {
    kind: "station",
    id: "st",
    geo: { lat: 48, lon: 11, alt: 560, headingDeg: 0 },
    foundRadiusM: 25,
    centre: { x: 0, y: 0, z: 0 },
  };

  // Why: a held key repeats; each repeat moves the drawing, and the hold
  // writes ONE edit (one undo step) when the keys are let go - every
  // press of it applied in turn, as the same presses one by one would.
  it("adds the presses of one hold up into one edit", () => {
    const ground = (p: { lat: number; lon: number }) => 100 + p.lon;
    const { world } = flatWorld(ground);
    const pin: GestureTarget = {
      ...PIN,
      geo: { ...PIN.geo, lat: 48, lon: 11 },
    };
    const g = startKeyGesture(pin, world);
    g.press({ kind: "nudge", eastM: 0.1, northM: 0 });
    g.press({ kind: "nudge", eastM: 0.1, northM: 0 });
    g.press({ kind: "turn", deg: 5 });
    g.press({ kind: "lift", m: 1 });
    const want = liftedGeo(
      turnedGeo(
        nudgedGeo(nudgedGeo(pin.geo, 0.1, 0, ground), 0.1, 0, ground),
        5,
      ),
      1,
    );
    expect(g.preview().geo).toEqual(want);
    expect(g.edit()).toEqual({ kind: "item-pose", id: "pin", geo: want });
  });

  // Why: a station stands on the ground (the design leaves PageUp and
  // PageDown to items); its nudges and turns move its anchor.
  it("moves and turns a station, and leaves its height alone", () => {
    const { world } = flatWorld(() => 515);
    const g = startKeyGesture(STATION, world);
    g.press({ kind: "lift", m: 1 });
    expect(g.edit()).toBeNull();
    g.press({ kind: "turn", deg: -15 });
    expect(g.edit()).toEqual({
      kind: "station-pose",
      id: "st",
      geo: { ...STATION.geo, headingDeg: 345 },
    });
  });

  // Why: an empty undo step is noise: a hold that changed nothing (no
  // press yet, or presses that cancel out exactly) writes nothing.
  it("writes nothing for a hold that changed nothing", () => {
    const { world } = flatWorld();
    const g = startKeyGesture(PIN, world);
    expect(g.edit()).toBeNull();
    g.press({ kind: "turn", deg: 5 });
    g.press({ kind: "turn", deg: -5 });
    expect(g.edit()).toBeNull();
  });
});

// Why: a locked station's pose must not move however the gizmo is
// grabbed - its middle and its knob take no gesture - while its radius
// stays a drag of its dots.
describe("a locked station", () => {
  const LOCKED: GestureTarget = {
    kind: "station",
    id: "st",
    geo: { lat: 0, lon: 0, alt: 100, headingDeg: 0 },
    foundRadiusM: 12,
    centre: { x: 0, y: 0, z: 0 },
    locked: true,
  };

  it("takes no move and no turn, and still its radius", () => {
    const { world } = flatWorld();
    expect(poseLocked(LOCKED)).toBe(true);
    expect(poseLocked({ ...LOCKED, locked: false })).toBe(false);
    expect(poseLocked(PIN)).toBe(false);
    expect(startGesture("move", LOCKED, at(0, 0), world)).toBeNull();
    expect(startGesture("turn", LOCKED, at(0, -10), world)).toBeNull();
    const g = startGesture("dot", LOCKED, at(12, 0), world);
    g?.move(at(20.3, 0), false);
    expect(g?.edit()).toEqual({ kind: "radius", id: "st", foundRadiusM: 20.5 });
  });
});
