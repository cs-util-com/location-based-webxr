/**
 * Why this test matters: a pin says "here": a head with the text on a
 * stem over a ring on the ground. Its head must float higher the farther
 * it is meant to be read from (to clear a crowd), its stem must reach
 * from the ground to the head, it must turn only as its orientation says,
 * and its turning arrow must point toward the place it points to as seen
 * from where the visitor stands. A first version of this look had an
 * arrow pointing straight away from its target; the arrow test below
 * checks the direction in the world, not an angle.
 */
import { Box3, Group, Vector3, type Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";

import { worldEnv, type WorldPart } from "../../world-part.js";
import { PIN, pinMeasures, pinPart } from "./pin.js";

const none = () => Promise.reject(new Error("none"));
const env = worldEnv("play", [], none);

function pin(fields: Record<string, unknown> = {}, at = env): WorldPart {
  return pinPart(
    {
      id: "p",
      kind: "shortText",
      view: "pin",
      caption: "This way to the guild house",
      ...fields,
    } as Parameters<typeof pinPart>[0],
    at,
  );
}

const named = (part: WorldPart, name: string): Object3D => {
  const found = part.object.getObjectByName(name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
};

/** A pin in a parent at the origin, given one frame from `viewer`. */
function standing(
  fields: Record<string, unknown>,
  viewer: [number, number, number] = [0, 1.6, 5],
): WorldPart {
  const part = pin(fields);
  new Group().add(part.object);
  part.update?.({ seconds: 1, viewer });
  return part;
}

describe("a pin", () => {
  it.each([1, 2, 4, 6, 12, 20, 40])(
    "at %s m: its head floats at 1.7 m plus 10 cm per metre, on a stem from the ground",
    (readAtM) => {
      // Why: the height rule is what lets a far-read pin clear a crowd;
      // the stem is what ties the head to its spot.
      const part = standing({ readAtM });
      const m = pinMeasures(readAtM);
      expect(m.liftM).toBeCloseTo(1.7 + 0.1 * readAtM, 10);
      expect(named(part, "pin-head").position.y).toBeCloseTo(m.liftM, 10);
      const stem = new Box3().setFromObject(named(part, "pin-stem"), true);
      expect(stem.min.y).toBeCloseTo(0, 5);
      expect(stem.max.y).toBeCloseTo(m.liftM, 5);
      part.dispose();
    },
  );

  it("clamps its reading distance as the letters do", () => {
    // Why: a distance past the format's bounds must not lift a head to
    // ten metres or bury it.
    expect(pinMeasures(400).liftM).toBeCloseTo(pinMeasures(40).liftM, 10);
    expect(pinMeasures(0).liftM).toBeCloseTo(pinMeasures(1).liftM, 10);
  });

  it("stands its ring on the ground, wider for a pin read from farther", () => {
    // Why: the ring advertises the spot; it must lie on the ground and
    // stay visible at the distance the pin is read from.
    const near = new Box3().setFromObject(
      named(standing({ readAtM: 3 }), "pin-ring"),
      true,
    );
    const far = new Box3().setFromObject(
      named(standing({ readAtM: 20 }), "pin-ring"),
      true,
    );
    expect(near.max.y).toBeLessThan(0.05);
    expect(far.max.x - far.min.x).toBeGreaterThan(near.max.x - near.min.x);
  });

  it.each([undefined, "world", "upright", "face"])(
    "orientation %s: keeps its turn, turns about up, or also tilts to the eyes",
    (orientation) => {
      // Why: `world` (and none) keeps the creator's turn; `upright`
      // turns about the stem; `face` also tilts the head toward the eyes.
      const part = standing(
        orientation === undefined ? {} : { orientation },
        [5, 1.6, 0],
      );
      const head = named(part, "pin-head");
      const turns = orientation === "upright" || orientation === "face";
      expect(head.rotation.y).toBeCloseTo(turns ? Math.PI / 2 : 0, 5);
      if (orientation === "face") {
        // The eyes are below the head: it tips its face down to them.
        expect(head.rotation.x).toBeGreaterThan(0.05);
      } else {
        expect(head.rotation.x).toBe(0);
      }
      expect(head.rotation.z).toBe(0);
      part.dispose();
    },
  );

  it("shows its text on both faces, so a fixed pin reads from behind", () => {
    // Why: a `world` pin is passed from every side.
    const part = standing({});
    const faces = named(part, "pin-head").children.filter(
      (o): o is Mesh => (o as Mesh).isMesh === true,
    );
    expect(faces).toHaveLength(2);
  });

  /** The world direction the arrow on the face toward the viewer points. */
  function arrowFrom(
    viewer: [number, number, number],
    pointsTo: [number, number, number],
    orientation = "upright",
  ): Vector3 {
    const part = standing(
      { pointsTo, orientation, role: "instruction" },
      viewer,
    );
    part.object.updateMatrixWorld(true);
    const eye = new Vector3(...viewer);
    let best: { glyph: Object3D; toEye: number } | null = null;
    part.object.traverse((o) => {
      if (o.name !== "pin-arrow") return;
      // The glyph whose face looks toward the viewer.
      const normal = new Vector3(0, 0, 1).transformDirection(o.matrixWorld);
      const at = o.getWorldPosition(new Vector3());
      const toEye = normal.dot(eye.clone().sub(at).normalize());
      if (best === null || toEye > best.toEye) best = { glyph: o, toEye };
    });
    if (best === null) throw new Error("no arrow");
    const { glyph } = best as { glyph: Object3D };
    const up = new Vector3(0, 1, 0).transformDirection(glyph.matrixWorld);
    part.dispose();
    return up;
  }

  it.each(["world", "upright", "face"])(
    "turns its arrow toward the point it points to, as seen by the visitor (%s)",
    (orientation) => {
      // Why: up means "go past the pin", right means "turn right",
      // down means "behind you", from where the visitor stands. The
      // visitor stands at +z looking toward -z; right is +x.
      const viewer: [number, number, number] = [0, 1.6, 5];
      const past = arrowFrom(viewer, [0, 0, -20], orientation);
      const right = arrowFrom(viewer, [20, 0, 0], orientation);
      const left = arrowFrom(viewer, [-20, 0, 0], orientation);
      const behind = arrowFrom(viewer, [0, 0, 30], orientation);
      expect(past.y).toBeGreaterThan(0.9);
      expect(right.x).toBeGreaterThan(0.9);
      expect(left.x).toBeLessThan(-0.9);
      expect(behind.y).toBeLessThan(-0.9);
    },
  );

  it("points the same way from behind a fixed pin", () => {
    // Why: from behind a `world` pin the back face's arrow is the one
    // read, and right is now -x.
    const viewer: [number, number, number] = [0, 1.6, -5];
    expect(arrowFrom(viewer, [-20, 0, 0], "world").x).toBeLessThan(-0.9);
    expect(arrowFrom(viewer, [0, 0, 20], "world").y).toBeGreaterThan(0.9);
  });

  it("has no arrow without a point", () => {
    // Why: without `pointsTo` the role icon stays; no arrow may claim a
    // direction it does not know.
    const part = standing({ role: "instruction" });
    expect(part.object.getObjectByName("pin-arrow")).toBeUndefined();
  });

  it("pulses its ring slowly while played, and holds it still when asked to", () => {
    // Why: the pulse says "here" without words; a visitor who asked for
    // less motion, and the editor, get a still ring.
    const scaleAt = (at: ReturnType<typeof worldEnv>, seconds: number) => {
      const part = pin({}, at);
      new Group().add(part.object);
      part.update?.({ seconds, viewer: [0, 1.6, 5] });
      const s = named(part, "pin-pulse").scale.x;
      part.dispose();
      return s;
    };
    const t0 = 10;
    const tHalf = t0 + PIN.pulsePeriodS / 2;
    expect(scaleAt(env, t0)).not.toBeCloseTo(scaleAt(env, tHalf), 2);
    const calm = worldEnv("play", [], none, { reduceMotion: () => true });
    expect(scaleAt(calm, t0)).toBeCloseTo(scaleAt(calm, tHalf), 10);
    const edit = worldEnv("edit", [], none);
    expect(scaleAt(edit, t0)).toBeCloseTo(scaleAt(edit, tHalf), 10);
  });

  it("frees what it made", () => {
    // Why: stations are drawn and freed again as the visitor walks.
    const part = standing({ pointsTo: [1, 0, -3], description: "Open daily." });
    expect(() => {
      part.dispose();
    }).not.toThrow();
  });
});
