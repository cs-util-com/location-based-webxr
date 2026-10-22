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
  compassDeg,
  draggedRadiusM,
  draggedSizeM,
  gizmoLayout,
  handleAt,
  sceneKey,
  turnedHeadingDeg,
} from "./gizmo-maths.js";

const CENTRE = { x: 10, y: 3, z: -4 };

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
    const near = gizmoLayout(
      {
        kind: "item",
        centre: CENTRE,
        headingDeg: 0,
        radiusM: null,
        sizeM: null,
      },
      0.01,
    );
    expect(near.ringM).toBeCloseTo(1.25, 9);
    expect(near.moveM).toBeCloseTo(1.25, 9);
    expect(near.dots).toEqual([]);
    // 0.1 m a pixel: 32 px is 3.2 m.
    const far = gizmoLayout(
      {
        kind: "item",
        centre: CENTRE,
        headingDeg: 0,
        radiusM: null,
        sizeM: null,
      },
      0.1,
    );
    expect(far.ringM).toBeCloseTo(3.2, 9);
  });

  it("gives a model its four dots on a ring of 0.625 x its size", () => {
    const layout = gizmoLayout(
      { kind: "item", centre: CENTRE, headingDeg: 0, radiusM: null, sizeM: 8 },
      0.01,
    );
    expect(layout.ringM).toBeCloseTo(5, 9);
    expect(layout.dots).toHaveLength(4);
    // The first dot at 45 degrees from the heading (north-east): east is
    // +x, north is -z.
    const s = Math.SQRT1_2 * 5;
    expect(layout.dots[0]?.x).toBeCloseTo(CENTRE.x + s, 9);
    expect(layout.dots[0]?.z).toBeCloseTo(CENTRE.z - s, 9);
  });

  it("puts a station's dots on its found radius, no ring, and a move disc of 26 px or 2.2 m", () => {
    const layout = gizmoLayout(
      {
        kind: "station",
        centre: CENTRE,
        headingDeg: 90,
        radiusM: 25,
        sizeM: null,
      },
      0.2,
    );
    expect(layout.ringM).toBeNull();
    expect(layout.moveM).toBeCloseTo(5.2, 9);
    expect(layout.dots).toHaveLength(4);
    for (const dot of layout.dots) {
      expect(Math.hypot(dot.x - CENTRE.x, dot.z - CENTRE.z)).toBeCloseTo(25, 9);
    }
    // Facing east: the knob 30 px past the circle, east of the centre.
    expect(layout.knob.x).toBeCloseTo(CENTRE.x + 25 + 30 * 0.2, 9);
    expect(layout.knob.z).toBeCloseTo(CENTRE.z, 9);
    expect(layout.bar.fromM).toBe(25);
    expect(layout.bar.lengthM).toBeCloseTo(6, 9);
    expect(layout.bar.widthM).toBeCloseTo(0.4, 9);
  });

  it("refuses a scale nobody can draw", () => {
    expect(() =>
      gizmoLayout(
        {
          kind: "item",
          centre: CENTRE,
          headingDeg: 0,
          radiusM: null,
          sizeM: null,
        },
        0,
      ),
    ).toThrow(RangeError);
  });

  it("keeps the knob 30 px beyond the ring, along the heading, for any heading and zoom", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 1e-4, max: 5, noNaN: true }),
        (headingDeg, mpp) => {
          const l = gizmoLayout(
            {
              kind: "item",
              centre: CENTRE,
              headingDeg,
              radiusM: null,
              sizeM: 3,
            },
            mpp,
          );
          const ring = l.ringM ?? 0;
          const dx = l.knob.x - CENTRE.x;
          const dz = l.knob.z - CENTRE.z;
          expect(Math.hypot(dx, dz)).toBeCloseTo(ring + 30 * mpp, 6);
          expect(
            Math.abs(angleDiffDeg(compassDeg(CENTRE, l.knob), headingDeg)),
          ).toBeLessThan(1e-6);
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

  it("moves when the selected object or the disc is under the pointer, never another object", () => {
    const base = { pointer: { x: 0, y: 0 }, knob, dots };
    expect(handleAt({ ...base, onDisc: true, underPointer: null })).toBe(
      "move",
    );
    expect(handleAt({ ...base, onDisc: false, underPointer: "selected" })).toBe(
      "move",
    );
    // Another object under the pointer wins over the disc: a click there
    // selects it.
    expect(handleAt({ ...base, onDisc: true, underPointer: "other" })).toBe(
      null,
    );
    expect(handleAt({ ...base, onDisc: false, underPointer: null })).toBe(null);
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
    expect(draggedRadiusM(12.34, false)).toBe(12.5);
    expect(draggedRadiusM(12.34, true)).toBe(12.3);
    expect(draggedRadiusM(0.2, false)).toBe(2);
    expect(draggedRadiusM(9000, false)).toBe(300);
  });

  it("scales a model's size with the dot's distance, to 3 digits, within 0.05-500 m", () => {
    expect(draggedSizeM(2, 4, 8)).toBe(4);
    expect(draggedSizeM(2.4, 3, 4)).toBe(3.2);
    expect(draggedSizeM(1.234, 1, 1)).toBe(1.23);
    expect(draggedSizeM(1, 10, 0)).toBe(0.05);
    expect(draggedSizeM(400, 1, 10)).toBe(500);
  });

  it("keeps any dragged radius and size inside the format's bounds", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.boolean(),
        fc.double({ min: 0.05, max: 500, noNaN: true }),
        fc.double({ min: 0.2, max: 1e3, noNaN: true }),
        (d, fine, size0, d0) => {
          const r = draggedRadiusM(d, fine);
          expect(r).toBeGreaterThanOrEqual(2);
          expect(r).toBeLessThanOrEqual(300);
          const s = draggedSizeM(size0, d0, d);
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
