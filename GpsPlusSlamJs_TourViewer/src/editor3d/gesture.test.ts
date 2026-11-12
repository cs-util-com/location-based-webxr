/**
 * Why these tests matter: a drag in the 3D view follows the SAMPLED
 * ground under the pointer, and the ground streams in: a pointer over
 * ground not loaded yet must wait for it and try again (else the object
 * jumps to a wrong height, or freezes for good), while a pointer over the
 * sky must not be retried every frame forever. A click on a handle that
 * moved nothing must write nothing (an empty undo step), and each handle
 * must write the one edit it stands for - a move, a turn, a radius, a
 * size - with the height rule applied. What a placeable's row says it
 * cannot do (turn, lift, have dots) no handle and no key may do.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import {
  STATION_PLACEMENT,
  blockPlacement,
  type ExtentSpec,
} from "../placement/placement-rows.js";
import type { PlaceRef } from "../placement/placeables.js";
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

const block = (id: string): PlaceRef => ({ kind: "block", id });
const STATION_REF: PlaceRef = { kind: "station", id: "st" };

/** The dots a row gives, at `value`. */
function dots(spec: ExtentSpec | undefined, value: number) {
  if (spec === undefined) throw new Error("the row has no dots");
  return { ...spec, value };
}

/** A pin, as its row has it: it lifts, it does not turn, no dots. */
const PIN: GestureTarget = {
  ref: block("pin"),
  geo: { lat: 0, lon: 0, alt: 101.5, headingDeg: 0 },
  turns: false,
  lifts: true,
  extent: null,
  locked: false,
  centre: { x: 0, y: 0, z: 0 },
};

/** A reading stand, as its row has it: it turns and lifts, no dots. */
const LECTERN: GestureTarget = { ...PIN, ref: block("lectern"), turns: true };

/** A placed model of `sizeM`, as its row has it. */
function model(sizeM: number): GestureTarget {
  return {
    ...LECTERN,
    ref: block("m"),
    extent: dots(blockPlacement("model", "placed")?.extent, sizeM),
  };
}

/** A station at `geo` with its found radius, as its row has it. */
function station(
  geo: QrGeoPose,
  foundRadiusM: number,
  locked = false,
): GestureTarget {
  return {
    ref: STATION_REF,
    geo,
    turns: STATION_PLACEMENT.turns,
    lifts: STATION_PLACEMENT.lifts,
    extent: dots(STATION_PLACEMENT.extent, foundRadiusM),
    locked,
    centre: { x: 0, y: 0, z: 0 },
  };
}

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
    expect(g?.edit()).toEqual({ kind: "pose", ref: block("pin"), geo });
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
    const g = startGesture(
      "move",
      station({ lat: 0, lon: 0, alt: 50, headingDeg: 20 }, 12),
      at(0, 0),
      world,
    );
    g?.move(at(0, -7), false);
    expect(g?.edit()).toEqual({
      kind: "pose",
      ref: STATION_REF,
      geo: { lat: 7, lon: 0, alt: 57, headingDeg: 20 },
    });
  });
});

describe("a turn", () => {
  it("turns by the knob's sweep round the centre, in whole degrees", () => {
    const { world } = flatWorld();
    // The knob north of the stand; swept to the east.
    const g = startGesture("turn", LECTERN, at(0, -10), world);
    g?.move(at(10, 0), false);
    const edit = g?.edit();
    expect(edit?.kind).toBe("pose");
    expect(edit?.kind === "pose" ? edit.geo.headingDeg : null).toBe(90);
  });

  // Why: a pin's drawing does not follow its heading (it faces the
  // viewer), so a knob on it would turn a value nobody can see.
  it("is no handle of what does not turn", () => {
    const { world } = flatWorld();
    expect(startGesture("turn", PIN, at(0, -10), world)).toBeNull();
  });
});

describe("a dot", () => {
  it("sets a station's radius from the dot's distance", () => {
    const { world } = flatWorld();
    const g = startGesture(
      "dot",
      station({ lat: 0, lon: 0, alt: 100, headingDeg: 0 }, 12),
      at(12, 0),
      world,
    );
    g?.move(at(20.3, 0), false);
    expect(g?.edit()).toEqual({
      kind: "extent",
      ref: STATION_REF,
      value: 20.5,
    });
  });

  it("sets a model's size by the dot's distance against where it was grabbed", () => {
    const { world } = flatWorld();
    const g = startGesture("dot", model(2), at(0, 4), world);
    g?.move(at(0, 8), false);
    expect(g?.edit()).toEqual({ kind: "extent", ref: block("m"), value: 4 });
  });

  // Why: the bounds are the row's, so one placeable's dots can never
  // write a value its format refuses (a picture's width tops out at 50 m,
  // a model's size at 500 m).
  it("keeps the value within the bounds its row gives", () => {
    const { world } = flatWorld();
    const picture: GestureTarget = {
      ...LECTERN,
      ref: block("pic"),
      extent: dots(blockPlacement("picture", "plane")?.extent, 40),
    };
    const g = startGesture("dot", picture, at(0, 4), world);
    g?.move(at(0, 8), false);
    expect(g?.preview().value).toBe(50);
    const big = startGesture("dot", model(40), at(0, 4), world);
    big?.move(at(0, 8), false);
    expect(big?.preview().value).toBe(80);
  });

  it("is no handle of a pin or a photo", () => {
    const { world } = flatWorld();
    expect(startGesture("dot", PIN, at(1, 0), world)).toBeNull();
  });
});

describe("a key gesture", () => {
  const STATION = station({ lat: 48, lon: 11, alt: 560, headingDeg: 0 }, 25);

  // Why: a held key repeats; each repeat moves the drawing, and the hold
  // writes ONE edit (one undo step) when the keys are let go - every
  // press of it applied in turn, as the same presses one by one would.
  it("adds the presses of one hold up into one edit", () => {
    const ground = (p: { lat: number; lon: number }) => 100 + p.lon;
    const { world } = flatWorld(ground);
    const lectern: GestureTarget = {
      ...LECTERN,
      geo: { ...LECTERN.geo, lat: 48, lon: 11 },
    };
    const g = startKeyGesture(lectern, world);
    g.press({ kind: "nudge", eastM: 0.1, northM: 0 });
    g.press({ kind: "nudge", eastM: 0.1, northM: 0 });
    g.press({ kind: "turn", deg: 5 });
    g.press({ kind: "lift", m: 1 });
    const want = liftedGeo(
      turnedGeo(
        nudgedGeo(nudgedGeo(lectern.geo, 0.1, 0, ground), 0.1, 0, ground),
        5,
      ),
      1,
    );
    expect(g.preview().geo).toEqual(want);
    expect(g.edit()).toEqual({
      kind: "pose",
      ref: block("lectern"),
      geo: want,
    });
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
      kind: "pose",
      ref: STATION_REF,
      geo: { ...STATION.geo, headingDeg: 345 },
    });
  });

  // Why: the keys answer the row as the knob does: what does not turn
  // takes no turn key, while its nudges and lifts still apply.
  it("leaves the heading of what does not turn alone", () => {
    const { world } = flatWorld();
    const g = startKeyGesture(PIN, world);
    g.press({ kind: "turn", deg: 15 });
    expect(g.edit()).toBeNull();
    g.press({ kind: "lift", m: 1 });
    expect(g.edit()).toEqual({
      kind: "pose",
      ref: block("pin"),
      geo: liftedGeo(PIN.geo, 1),
    });
  });

  // Why: an empty undo step is noise: a hold that changed nothing (no
  // press yet, or presses that cancel out exactly) writes nothing.
  it("writes nothing for a hold that changed nothing", () => {
    const { world } = flatWorld();
    const g = startKeyGesture(LECTERN, world);
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
  const LOCKED = station({ lat: 0, lon: 0, alt: 100, headingDeg: 0 }, 12, true);

  it("takes no move and no turn, and still its radius", () => {
    const { world } = flatWorld();
    expect(poseLocked(LOCKED)).toBe(true);
    expect(poseLocked({ ...LOCKED, locked: false })).toBe(false);
    expect(poseLocked(PIN)).toBe(false);
    expect(startGesture("move", LOCKED, at(0, 0), world)).toBeNull();
    expect(startGesture("turn", LOCKED, at(0, -10), world)).toBeNull();
    const g = startGesture("dot", LOCKED, at(12, 0), world);
    g?.move(at(20.3, 0), false);
    expect(g?.edit()).toEqual({
      kind: "extent",
      ref: STATION_REF,
      value: 20.5,
    });
  });
});
