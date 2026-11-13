/**
 * Why this test matters: a sign stands in the world at its pose; its
 * board must rise with its reading distance (so it clears a crowd), its
 * posts must carry it, and it must turn toward the visitor only when
 * told to. These are the facts the field sees, checked on the built
 * object in Node.
 */
import fc from "fast-check";
import { Box3, Group, type Object3D } from "three";
import { describe, expect, it } from "vitest";

import { worldEnv, type WorldPart } from "../../world-part.js";
import { signMeasures, signPart } from "./sign.js";

const env = worldEnv("play", [], () => Promise.reject(new Error("none")));

function sign(fields: Record<string, unknown> = {}): WorldPart {
  return signPart(
    {
      id: "s",
      kind: "shortText",
      view: "sign",
      caption: "North gate",
      ...fields,
    } as Parameters<typeof signPart>[0],
    env,
  );
}

const boxOf = (part: WorldPart) => {
  part.object.updateMatrixWorld(true);
  return new Box3().setFromObject(part.object, true);
};

/** The sign's turning node: the one child of its object. */
const turnOf = (part: WorldPart): Object3D => {
  const turn = part.object.children[0];
  if (turn === undefined) throw new Error("no turn");
  return turn;
};

describe("a sign", () => {
  it("stands on the ground and its board rises with the reading distance", () => {
    // Why: the board's bottom is 0.95 m plus 4 cm per metre read.
    const near = boxOf(sign({ readAtM: 2 }));
    const far = boxOf(sign({ readAtM: 20 }));
    expect(near.min.y).toBeCloseTo(0, 5);
    expect(far.max.y).toBeGreaterThan(near.max.y);
    expect(signMeasures(20, 1).bottom).toBeCloseTo(0.95 + 0.8, 10);
  });

  it("has two posts on a wide board and one on a narrow one", () => {
    // Why: one post under a wide board looks like it would topple.
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 4, noNaN: true }), (w) => {
        const { postXs } = signMeasures(4, w);
        expect(postXs).toHaveLength(w > 0.9 ? 2 : 1);
        for (const x of postXs) expect(Math.abs(x)).toBeLessThan(w / 2);
      }),
    );
  });

  it.each([undefined, "world", "upright", "face"])(
    "orientation %s: keeps its turn, or turns about up to the visitor",
    (orientation) => {
      // Why: `world` (and none) keeps the creator's turn; `upright` and
      // `face` turn to the viewer without ever tilting.
      const part = sign(orientation === undefined ? {} : { orientation });
      new Group().add(part.object);
      part.update?.({ seconds: 1, viewer: [5, 1.6, 0] });
      const turn = turnOf(part);
      const turns = orientation === "upright" || orientation === "face";
      expect(turn.rotation.y).toBeCloseTo(turns ? Math.PI / 2 : 0, 5);
      expect(turn.rotation.x).toBe(0);
      expect(turn.rotation.z).toBe(0);
      part.dispose();
    },
  );

  it("eases its turn rather than jumping, after its first frame", () => {
    // Why: a sign that snapped to every step of the visitor would
    // jitter with the phone's tracking.
    const part = sign({ orientation: "upright" });
    new Group().add(part.object);
    part.update?.({ seconds: 1, viewer: [0, 1.6, 5] });
    part.update?.({ seconds: 1.016, viewer: [5, 1.6, 0] });
    const yaw = turnOf(part).rotation.y;
    expect(yaw).toBeGreaterThan(0);
    expect(yaw).toBeLessThan(Math.PI / 4);
  });

  it("turns its glyph toward the point it points to", () => {
    // Why: the glyph replaces the role icon and says where to go: a
    // point aside turns it away from a point straight past the board.
    const glyphAngle = (pointsTo: number[]) => {
      const part = sign({ pointsTo });
      new Group().add(part.object);
      part.update?.({ seconds: 1, viewer: [0, 1.6, 5] });
      let angle: number | null = null;
      part.object.traverse((o) => {
        if (o.renderOrder === 6 && angle === null) angle = o.rotation.z;
      });
      part.dispose();
      return angle;
    };
    const ahead = glyphAngle([0, 0, -10]);
    const right = glyphAngle([10, 0, 0]);
    expect(ahead).not.toBeNull();
    expect(Math.abs(right! - ahead!)).toBeGreaterThan(1);
  });
});
