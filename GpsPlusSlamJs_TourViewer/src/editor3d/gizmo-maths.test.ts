/**
 * Why these tests matter: the gizmo is the creator's grip on the scene -
 * the ring with its four dots, the turn knob on its stalk and the move
 * arrow in the middle - and its sizes are the design's (screen pixels,
 * so a handle stays grabbable at any zoom). A hit test that answers the
 * wrong handle turns a station when the creator meant to move it; a key
 * map off by a sign nudges the wrong way. These pin the layout, the hit
 * order, the drag maths and every key the scene owns, and that the keys
 * owned by the page and the shell (T, F, Home, Esc, Ctrl+Z, Ctrl+Y) are
 * not answered twice here.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GIZMO,
  KEY_STEPS,
  angleDiffDeg,
  bentDeg,
  compassDeg,
  draggedScale,
  draggedRadiusM,
  draggedSizeM,
  gizmoLayout,
  handleAt,
  sceneKey,
  turnedHeadingDeg,
  viewHeightAtOneM,
  type GizmoSubject,
} from "./gizmo-maths.js";
import {
  STATION_PLACEMENT,
  blockPlacement,
} from "../placement/placement-rows.js";

const CENTRE = { x: 10, y: 3, z: -4 };

/** A turning item without dots (a lectern, a picture in this step). */
const ITEM: GizmoSubject = {
  centre: CENTRE,
  headingDeg: 0,
  turns: true,
  extent: null,
  locked: false,
};
/** A model of `sizeM`. */
const model = (sizeM: number): GizmoSubject => ({
  ...ITEM,
  extent: { kind: "size", value: sizeM },
});
/** A station of found radius `radiusM`. */
const station = (radiusM: number, headingDeg = 0): GizmoSubject => ({
  ...ITEM,
  headingDeg,
  extent: { kind: "reach", value: radiusM },
});

/** A ground arrow at scale `scale`, bent `bendDeg` (its row's ring). */
const arrow = (scale: number, bendDeg = 0): GizmoSubject => ({
  ...ITEM,
  extent: { kind: "scale", value: scale, ring: { baseM: 0.3, perM: 0.075 } },
  bendDeg,
});
const RING = { baseM: 0.3, perM: 0.075 };

/** The dots' bounds, from the placement rows (one copy of them). */
function boundsOf(spec: { min: number; max: number } | undefined) {
  if (spec === undefined) throw new Error("the row has no extent");
  return { min: spec.min, max: spec.max };
}
const RADIUS = boundsOf(STATION_PLACEMENT.extent);
const SIZE = boundsOf(blockPlacement("model", "placed")?.extent);

function key(
  code: string,
  extra: Partial<{
    key: string;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }> = {},
) {
  return {
    code,
    key: extra.key ?? code,
    shiftKey: extra.shiftKey ?? false,
    altKey: extra.altKey ?? false,
    ctrlKey: extra.ctrlKey ?? false,
    metaKey: extra.metaKey ?? false,
  };
}

describe("the gizmo's layout", () => {
  it("puts an item's ring on the ground under it, at least 32 px or 1.25 m", () => {
    // 0.01 m a pixel: 32 px is 0.32 m, so the 1.25 m floor holds.
    const near = gizmoLayout(ITEM, 0.01);
    expect(near.ringM).toBeCloseTo(1.25, 9);
    expect(near.moveM).toBeCloseTo(1.25, 9);
    expect(near.dots).toEqual([]);
    // 0.1 m a pixel: 32 px is 3.2 m.
    const far = gizmoLayout(ITEM, 0.1);
    expect(far.ringM).toBeCloseTo(3.2, 9);
  });

  it("gives a model its four dots on a ring of 0.625 x its size", () => {
    const layout = gizmoLayout(model(8), 0.01);
    expect(layout.ringM).toBeCloseTo(5, 9);
    expect(layout.dots).toHaveLength(4);
    // The first dot at 45 degrees from the heading (north-east): east is
    // +x, north is -z.
    const s = Math.SQRT1_2 * 5;
    expect(layout.dots[0]?.x).toBeCloseTo(CENTRE.x + s, 9);
    expect(layout.dots[0]?.z).toBeCloseTo(CENTRE.z - s, 9);
  });

  it("puts a station's dots on its found radius, no ring, and a move disc of 26 px or 2.2 m", () => {
    const layout = gizmoLayout(station(25, 90), 0.2);
    expect(layout.ringM).toBeNull();
    expect(layout.moveM).toBeCloseTo(5.2, 9);
    expect(layout.dots).toHaveLength(4);
    for (const dot of layout.dots) {
      expect(Math.hypot(dot.x - CENTRE.x, dot.z - CENTRE.z)).toBeCloseTo(25, 9);
    }
    // Facing east: the knob 30 px past the circle, east of the centre.
    expect(layout.knob?.x).toBeCloseTo(CENTRE.x + 25 + 30 * 0.2, 9);
    expect(layout.knob?.z).toBeCloseTo(CENTRE.z, 9);
    expect(layout.bar?.fromM).toBe(25);
    expect(layout.bar?.lengthM).toBeCloseTo(6, 9);
    expect(layout.bar?.widthM).toBeCloseTo(0.4, 9);
  });

  // Why: what always faces the camera or the viewer (a pin's label, a
  // sound's icon) shows no turn, so its gizmo offers none - a knob there
  // would turn a heading nobody ever sees. Its ring and disc stay.
  it("draws no knob and no stalk for what does not turn", () => {
    const pin = gizmoLayout({ ...ITEM, turns: false }, 0.01);
    expect(pin.knob).toBeNull();
    expect(pin.bar).toBeNull();
    expect(pin.ringM).toBeCloseTo(1.25, 9);
    expect(pin.posable).toBe(true);
    expect(
      handleAt({
        pointer: { x: 0, y: 0 },
        knob: null,
        dots: [],
        onDisc: true,
        underPointer: "selected",
      }),
    ).toBe("move");
  });

  it("refuses a scale nobody can draw", () => {
    expect(() => gizmoLayout(ITEM, 0)).toThrow(RangeError);
  });

  it("keeps the knob 30 px beyond the ring, along the heading, for any heading and zoom", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 1e-4, max: 5, noNaN: true }),
        (headingDeg, mpp) => {
          const l = gizmoLayout({ ...model(3), headingDeg }, mpp);
          const ring = l.ringM ?? 0;
          const knob = l.knob;
          if (knob === null) throw new Error("a turning model has a knob");
          const dx = knob.x - CENTRE.x;
          const dz = knob.z - CENTRE.z;
          expect(Math.hypot(dx, dz)).toBeCloseTo(ring + 30 * mpp, 6);
          expect(
            Math.abs(angleDiffDeg(compassDeg(CENTRE, knob), headingDeg)),
          ).toBeLessThan(1e-6);
        },
      ),
    );
  });

  // Why: a locked station's gizmo is its radius dots alone, so nothing
  // drawn invites a drag the lock would refuse.
  it("keeps a locked station's dots and takes its middle and knob", () => {
    const subject = station(25);
    expect(gizmoLayout(subject, 0.2).posable).toBe(true);
    const locked = gizmoLayout({ ...subject, locked: true }, 0.2);
    expect(locked.posable).toBe(false);
    expect(locked.dots).toHaveLength(4);
  });
});

// Why: a ground arrow's ring is the prototype's (0.3 m + 0.075 m per unit
// of its scale), not a model's 0.625 per metre, and its bend knob stands
// behind its start, swung by the bend like a tiller: what the creator
// grabs must be where the arrow's own maths says.
describe("a ground arrow's gizmo", () => {
  it("rings its scale linearly and puts the dots on that ring", () => {
    const at6 = gizmoLayout(arrow(6), 1e-4);
    expect(at6.ringM).toBeCloseTo(0.75, 9);
    expect(
      Math.hypot(at6.dots[0]!.x - CENTRE.x, at6.dots[0]!.z - CENTRE.z),
    ).toBeCloseTo(0.75, 9);
    expect(gizmoLayout(arrow(40), 1e-4).ringM).toBeCloseTo(3.3, 9);
    // Far away the ring keeps its least on-screen size, as an item's.
    expect(gizmoLayout(arrow(6), 1).ringM).toBe(GIZMO.itemRingPx);
  });

  it("puts the bend knob behind the start, swung clockwise by the bend", () => {
    const straight = gizmoLayout(arrow(6), 1e-4);
    const r =
      straight.knob === null
        ? NaN
        : Math.hypot(straight.knob.x - CENTRE.x, straight.knob.z - CENTRE.z);
    expect(straight.bendKnob).not.toBeNull();
    const k = straight.bendKnob!;
    expect(Math.hypot(k.x - CENTRE.x, k.z - CENTRE.z)).toBeCloseTo(r, 9);
    expect(compassDeg(CENTRE, k)).toBeCloseTo(180, 6);
    const bent = gizmoLayout({ ...arrow(6, 30), headingDeg: 90 }, 1e-4);
    expect(compassDeg(CENTRE, bent.bendKnob!)).toBeCloseTo(-60, 6);
    expect(gizmoLayout(ITEM, 1e-4).bendKnob).toBeNull();
    expect(
      gizmoLayout({ ...arrow(6), locked: true }, 1e-4).bendKnob,
    ).toBeNull();
  });

  it("is the bend handle under the pointer, not on a locked placeable", () => {
    const base = {
      knob: null,
      dots: [],
      onDisc: true,
      underPointer: null,
    } as const;
    expect(
      handleAt({ ...base, pointer: { x: 3, y: 0 }, bendKnob: { x: 0, y: 0 } }),
    ).toBe("bend");
    expect(
      handleAt({
        ...base,
        pointer: { x: 3, y: 0 },
        bendKnob: { x: 0, y: 0 },
        posable: false,
      }),
    ).toBeNull();
  });

  it("sets the scale from the dot's distance: whole units, tenths with Shift, 1 to 40", () => {
    const B = { min: 1, max: 40 };
    expect(draggedScale(0.75, false, RING, B)).toBe(6);
    expect(draggedScale(0.8, false, RING, B)).toBe(7);
    expect(draggedScale(0.8, true, RING, B)).toBe(6.7);
    expect(draggedScale(0, false, RING, B)).toBe(1);
    expect(draggedScale(99, false, RING, B)).toBe(40);
  });

  it("bends by the knob's sweep, whole degrees or 5 with Shift, within the bound", () => {
    expect(bentDeg(0, 180, 210.4, false, 60)).toBe(30);
    expect(bentDeg(10, 180, 172, true, 60)).toBe(0);
    expect(bentDeg(50, 180, 230, false, 60)).toBe(60);
    expect(bentDeg(-50, 180, 130, false, 60)).toBe(-60);
  });

  it("holds every dragged scale and bend in bounds, and finds a ring's own scale again", () => {
    const B = { min: 1, max: 40 };
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e4, noNaN: true }),
        fc.boolean(),
        fc.integer({ min: 1, max: 40 }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        (d, fine, scale, b0, from, to) => {
          const s = draggedScale(d, fine, RING, B);
          expect(s).toBeGreaterThanOrEqual(1);
          expect(s).toBeLessThanOrEqual(40);
          const ring = gizmoLayout(arrow(scale), 1e-4).ringM ?? NaN;
          expect(draggedScale(ring, fine, RING, B)).toBe(scale);
          const b = bentDeg(b0, from, to, fine, 60);
          expect(Math.abs(b)).toBeLessThanOrEqual(60);
          expect(Number.isInteger(b)).toBe(true);
        },
      ),
    );
  });
});

describe("which handle the pointer is on", () => {
  const knob = { x: 100, y: 100 };
  const dots = [
    { x: 200, y: 100 },
    { x: 300, y: 100 },
  ];

  it("answers the knob and a dot within half their drawn size", () => {
    const at = (x: number, y: number) =>
      handleAt({
        pointer: { x, y },
        knob,
        dots,
        onDisc: false,
        underPointer: null,
      });
    expect(at(100 + GIZMO.knobPx / 2 - 0.5, 100)).toBe("turn");
    expect(at(100 + GIZMO.knobPx / 2 + 0.5, 100)).toBeNull();
    expect(at(200, 100 + GIZMO.dotPx / 2 - 0.5)).toBe("dot");
    expect(at(300, 100 + GIZMO.dotPx / 2 + 0.5)).toBeNull();
  });

  it("takes the handle nearest the pointer when two overlap", () => {
    expect(
      handleAt({
        pointer: { x: 112, y: 100 },
        knob,
        dots: [{ x: 120, y: 100 }],
        onDisc: true,
        underPointer: null,
      }),
    ).toBe("dot");
  });

  // Why: only the disc moves an item. A large item (an ambient sound's
  // glow, a model) covers much of the view; when its body moved it, every
  // drag meant to turn the camera shifted the item instead. One case per
  // thing that can lie under a press.
  describe("one case per thing under the press", () => {
    const base = { pointer: { x: 0, y: 0 }, knob, dots };

    it("the selected item's body, off the disc: the camera's (a tap selects)", () => {
      expect(
        handleAt({ ...base, onDisc: false, underPointer: "selected" }),
      ).toBeNull();
    });

    it("the disc: moves", () => {
      expect(handleAt({ ...base, onDisc: true, underPointer: null })).toBe(
        "move",
      );
    });

    it("the disc under the selected item's own body: moves", () => {
      // A pin or a model stands on its disc; from most views its body
      // covers the disc's middle, which must still move it.
      expect(
        handleAt({ ...base, onDisc: true, underPointer: "selected" }),
      ).toBe("move");
    });

    it("the turn knob: turns, over the body and the disc", () => {
      expect(
        handleAt({
          ...base,
          pointer: knob,
          onDisc: true,
          underPointer: "selected",
        }),
      ).toBe("turn");
    });

    it("a size dot: sizes, over the body and the disc", () => {
      expect(
        handleAt({
          ...base,
          pointer: { x: 200, y: 100 },
          onDisc: true,
          underPointer: "selected",
        }),
      ).toBe("dot");
    });

    it("another item, even over the disc: no handle, so a click selects it", () => {
      expect(
        handleAt({ ...base, onDisc: true, underPointer: "other" }),
      ).toBeNull();
      expect(
        handleAt({ ...base, onDisc: false, underPointer: "other" }),
      ).toBeNull();
    });

    it("empty ground: the camera's", () => {
      expect(
        handleAt({ ...base, onDisc: false, underPointer: null }),
      ).toBeNull();
    });
  });

  // Why: with the body no longer a grip, the disc is the one way to move
  // an item, so it must stay a fair touch target wherever the camera is.
  // Swept over camera distances of 5-300 m, a 50 degree lens and the
  // short side of a phone (390 px) and a desktop view (900 px): the disc
  // is never under 32 px across its radius for an item, nor 26 px for a
  // station, and never under its metre floor.
  it("keeps the move disc at least its touch size from 5 m to 300 m", () => {
    for (const viewportPx of [390, 900]) {
      for (const distanceM of [5, 10, 20, 50, 100, 200, 300]) {
        const mpp = (distanceM * viewHeightAtOneM(50)) / viewportPx;
        const item = gizmoLayout(ITEM, mpp);
        const disc = gizmoLayout(station(25), mpp);
        expect(item.moveM / mpp).toBeGreaterThanOrEqual(
          GIZMO.itemRingPx - 1e-9,
        );
        expect(item.moveM).toBeGreaterThanOrEqual(GIZMO.itemRingMinM);
        expect(disc.moveM / mpp).toBeGreaterThanOrEqual(
          GIZMO.stationMovePx - 1e-9,
        );
        expect(disc.moveM).toBeGreaterThanOrEqual(GIZMO.stationMoveMinM);
      }
    }
  });

  it("puts the knob and the dots before anything under them", () => {
    expect(
      handleAt({
        pointer: knob,
        knob,
        dots: [],
        onDisc: true,
        underPointer: "other",
      }),
    ).toBe("turn");
  });

  it("answers only a dot when the middle and the knob are no handles (a locked station)", () => {
    const base = { knob, dots, posable: false } as const;
    expect(
      handleAt({ ...base, pointer: knob, onDisc: true, underPointer: null }),
    ).toBeNull();
    expect(
      handleAt({
        ...base,
        pointer: { x: 0, y: 0 },
        onDisc: true,
        underPointer: "selected",
      }),
    ).toBeNull();
    expect(
      handleAt({
        ...base,
        pointer: { x: 200, y: 100 },
        onDisc: true,
        underPointer: null,
      }),
    ).toBe("dot");
  });
});

describe("the drag maths", () => {
  it("measures bearings clockwise from north (east +x, north -z)", () => {
    const o = { x: 0, z: 0 };
    expect(compassDeg(o, { x: 0, z: -1 })).toBeCloseTo(0, 9);
    expect(compassDeg(o, { x: 1, z: 0 })).toBeCloseTo(90, 9);
    expect(compassDeg(o, { x: 0, z: 1 })).toBeCloseTo(180, 9);
    expect(compassDeg(o, { x: -1, z: 0 })).toBeCloseTo(-90, 9);
    expect(angleDiffDeg(350, 10)).toBeCloseTo(20, 9);
    expect(angleDiffDeg(10, 350)).toBeCloseTo(-20, 9);
  });

  it("turns by the knob's sweep to whole degrees, or 15 with Shift", () => {
    expect(turnedHeadingDeg(30, 0, 44.6, false)).toBe(75);
    expect(turnedHeadingDeg(30, 0, 44.6, true)).toBe(75);
    expect(turnedHeadingDeg(30, 0, 50, true)).toBe(75);
    expect(turnedHeadingDeg(350, 0, 20, false)).toBe(10);
    expect(turnedHeadingDeg(10, 0, -20, false)).toBe(350);
  });

  it("sets a station's radius in half metres, tenths with Shift, within 2-300 m", () => {
    expect(RADIUS).toEqual({ min: 2, max: 300 });
    expect(draggedRadiusM(12.34, false, RADIUS)).toBe(12.5);
    expect(draggedRadiusM(12.34, true, RADIUS)).toBe(12.3);
    expect(draggedRadiusM(0.2, false, RADIUS)).toBe(2);
    expect(draggedRadiusM(9000, false, RADIUS)).toBe(300);
  });

  it("scales a model's size with the dot's distance, to 3 digits, within 0.05-500 m", () => {
    expect(SIZE).toEqual({ min: 0.05, max: 500 });
    expect(draggedSizeM(2, 4, 8, SIZE)).toBe(4);
    expect(draggedSizeM(2.4, 3, 4, SIZE)).toBe(3.2);
    expect(draggedSizeM(1.234, 1, 1, SIZE)).toBe(1.23);
    expect(draggedSizeM(1, 10, 0, SIZE)).toBe(0.05);
    expect(draggedSizeM(400, 1, 10, SIZE)).toBe(500);
  });

  // Why: the bounds are the placement row's, so a row with other bounds
  // (a picture's width) is held to its own, not to a model's.
  it("holds a dot to the bounds it is given", () => {
    expect(draggedSizeM(1, 1, 100, { min: 0.1, max: 50 })).toBe(50);
    expect(draggedRadiusM(1, false, { min: 5, max: 10 })).toBe(5);
  });

  it("keeps any dragged radius and size inside the format's bounds", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.boolean(),
        fc.double({ min: 0.05, max: 500, noNaN: true }),
        fc.double({ min: 0.2, max: 1e3, noNaN: true }),
        (d, fine, size0, d0) => {
          const r = draggedRadiusM(d, fine, RADIUS);
          expect(r).toBeGreaterThanOrEqual(2);
          expect(r).toBeLessThanOrEqual(300);
          const s = draggedSizeM(size0, d0, d, SIZE);
          expect(s).toBeGreaterThanOrEqual(0.05);
          expect(s).toBeLessThanOrEqual(500);
        },
      ),
    );
  });
});

describe("the scene's keys", () => {
  it("nudges 0.1 m east and north by the arrows, 1 m with Shift", () => {
    expect(sceneKey(key("ArrowRight"))).toEqual({
      kind: "nudge",
      eastM: 0.1,
      northM: 0,
    });
    expect(sceneKey(key("ArrowLeft"))).toEqual({
      kind: "nudge",
      eastM: -0.1,
      northM: 0,
    });
    expect(sceneKey(key("ArrowUp", { shiftKey: true }))).toEqual({
      kind: "nudge",
      eastM: 0,
      northM: 1,
    });
    expect(sceneKey(key("ArrowDown"))).toEqual({
      kind: "nudge",
      eastM: 0,
      northM: -0.1,
    });
  });

  it("turns 5 degrees with Q and E and Alt+Left/Right, 15 with Shift", () => {
    expect(sceneKey(key("KeyE", { key: "e" }))).toEqual({
      kind: "turn",
      deg: 5,
    });
    expect(sceneKey(key("KeyQ", { key: "Q", shiftKey: true }))).toEqual({
      kind: "turn",
      deg: -15,
    });
    expect(sceneKey(key("ArrowRight", { altKey: true }))).toEqual({
      kind: "turn",
      deg: 5,
    });
    expect(
      sceneKey(key("ArrowLeft", { altKey: true, shiftKey: true })),
    ).toEqual({ kind: "turn", deg: -15 });
    // Alt with Up and Down still nudges, as the design does.
    expect(sceneKey(key("ArrowUp", { altKey: true }))).toEqual({
      kind: "nudge",
      eastM: 0,
      northM: 0.1,
    });
  });

  it("lifts with PageUp and PageDown, 0.1 m or 1 m", () => {
    expect(sceneKey(key("PageUp"))).toEqual({ kind: "lift", m: 0.1 });
    expect(sceneKey(key("PageDown", { shiftKey: true }))).toEqual({
      kind: "lift",
      m: -1,
    });
  });

  it("deletes with Delete and Backspace, duplicates with Ctrl+D or Cmd+D", () => {
    expect(sceneKey(key("Delete"))).toEqual({ kind: "delete" });
    expect(sceneKey(key("Backspace"))).toEqual({ kind: "delete" });
    expect(sceneKey(key("KeyD", { key: "d", ctrlKey: true }))).toEqual({
      kind: "duplicate",
    });
    expect(sceneKey(key("KeyD", { key: "d", metaKey: true }))).toEqual({
      kind: "duplicate",
    });
    expect(sceneKey(key("KeyD", { key: "d" }))).toBeNull();
  });

  it("leaves the keys the shell and the page answer to them", () => {
    for (const k of [
      key("KeyT", { key: "t" }),
      key("KeyF", { key: "f" }),
      key("Home"),
      key("Escape"),
      key("KeyZ", { key: "z", ctrlKey: true }),
      key("KeyZ", { key: "Z", ctrlKey: true, shiftKey: true }),
      key("KeyY", { key: "y", ctrlKey: true }),
      key("ArrowRight", { ctrlKey: true }),
    ]) {
      expect(sceneKey(k), k.code).toBeNull();
    }
  });

  it("uses the design's steps", () => {
    expect(KEY_STEPS).toEqual({
      nudgeM: 0.1,
      nudgeShiftM: 1,
      turnDeg: 5,
      turnShiftDeg: 15,
      liftM: 0.1,
      liftShiftM: 1,
    });
  });
});

// Why: the lens arithmetic (the view's height at 1 m, 2 tan(fov / 2)) was
// written out in three 3D-editor modules (PR bot finding 14, DEC-H3: one
// rule, one implementation); the gizmo's sprites, the billboards and a
// code's size on screen must agree on it.
describe("viewHeightAtOneM", () => {
  it("is 2 tan(fov / 2): 2 m at 90 degrees, about 0.9326 m at 50", () => {
    expect(viewHeightAtOneM(90)).toBeCloseTo(2, 12);
    expect(viewHeightAtOneM(50)).toBeCloseTo(0.932615, 6);
    expect(viewHeightAtOneM(60)).toBeCloseTo(2 / Math.sqrt(3), 12);
  });
});
