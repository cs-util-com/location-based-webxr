/**
 * Why these tests matter: a ground arrow is the one short text a visitor
 * walks along, so what it must never do is checked on the built object in
 * Node, for every style - sink into the ground, run into the last 2 m
 * before the thing it points at, bend to the wrong side, move in the
 * editor or for a visitor who asked for less motion, or keep an old layout
 * after its spot moved.
 */
import fc from "fast-check";
import {
  Box3,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import { TOUR_GROUND_STYLES } from "gps-plus-slam-app-framework/ar/tour-short-text";

import { pickObject, PICK_TOLERANCE_DEG } from "../../object-pick.js";
import { routeVisitorTap } from "../../visitor-stations.js";
import {
  tapShownWorldPart,
  worldEnv,
  type WorldEnv,
  type WorldPart,
} from "../../world-part.js";
import { groundPart } from "./ground.js";
import {
  GROUND,
  GROUND_DARK_DEFAULT,
  groundLengthM,
  groundScale,
} from "./ground-route.js";
import { SHORT_TEXT_ACCENT } from "./plate.js";

const none = () => Promise.reject(new Error("none"));
const playEnv = worldEnv("play", [], none);
const editEnv = worldEnv("edit", [], none);

function ground(
  fields: Record<string, unknown> = {},
  env: WorldEnv = playEnv,
): WorldPart {
  return groundPart(
    {
      id: "g",
      kind: "shortText",
      view: "ground",
      caption: "To the tower",
      pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      ...fields,
    },
    env,
  );
}

/** The marks (the object's first child) and the plate (its second). */
const arrowOf = (part: WorldPart): Object3D => part.object.children[0]!;
const plateOf = (part: WorldPart): Object3D => part.object.children[1]!;

/** `node`'s box in the part's own frame (the part stands at the origin). */
const boxOf = (node: Object3D): Box3 => {
  let root = node;
  while (root.parent !== null) root = root.parent;
  root.updateMatrixWorld(true);
  return new Box3().setFromObject(node, true);
};

/** Every flat colour the marks are drawn in, as hex. */
const coloursOf = (node: Object3D): Set<number> => {
  const out = new Set<number>();
  node.traverse((o) => {
    if (o instanceof Mesh && o.material instanceof MeshBasicMaterial) {
      if (!o.material.vertexColors) out.add(o.material.color.getHex());
    }
  });
  return out;
};

/** Each mark's height and colour, to compare two frames. */
const snapshot = (part: WorldPart): string[] => {
  const out: string[] = [];
  part.object.updateMatrixWorld(true);
  part.object.traverse((o) => {
    if (o instanceof Mesh) {
      const m = o.material as MeshBasicMaterial;
      out.push(
        `${o.matrixWorld.elements[13].toFixed(5)}:${m.color.getHexString()}`,
      );
    }
  });
  return out;
};

describe("a ground arrow", () => {
  it.each(TOUR_GROUND_STYLES)(
    "%s: stays above the ground and stops 2 m short of what it points at",
    (style) => {
      // Why: the stop keeps a visitor out of the thing's footprint; the
      // half metre over the stop is the reach of a mark beyond its route
      // point (a guide light's glow pool, a vane's nose).
      fc.assert(
        fc.property(fc.double({ min: 4, max: 40, noNaN: true }), (d) => {
          const part = ground({ style, pointsTo: [0, 0, d] });
          const box = boxOf(arrowOf(part));
          expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
          expect(box.max.z).toBeLessThanOrEqual(d - GROUND.stopM + 0.5);
          expect(box.max.z).toBeGreaterThan(0.5);
          part.dispose();
        }),
        { numRuns: 12 },
      );
    },
  );

  it("runs straight ahead along its front at its scale's length with nothing to point at", () => {
    // Why: a creator who has not set a point yet still sees an arrow,
    // along the part's front.
    const part = ground({ style: "floor" });
    const box = boxOf(arrowOf(part));
    const L = groundLengthM(groundScale(undefined, null));
    expect(box.max.z).toBeGreaterThan(L - 0.1);
    expect(box.max.z).toBeLessThan(L + 0.2);
    expect(box.min.z).toBeGreaterThan(-0.3);
  });

  it("lays no marks, only its plate, when the point is too near for an arrow", () => {
    // Why: under 2.5 m there is no room past the stop; an arrow there
    // would end inside the thing.
    const part = ground({ pointsTo: [0, 0, GROUND.stopM + 0.3] });
    expect(arrowOf(part).children).toHaveLength(0);
    expect(plateOf(part).visible).toBe(true);
  });

  it.each([
    ["right", 40, -1],
    ["left", -40, 1],
  ] as const)(
    "bends to the %s for bendDeg %d, its plate on the other side",
    (_, bendDeg, side) => {
      // Why: a positive bend is clockwise seen from above, to the walker's
      // right; walking along +Z the right is -X. The plate stands away from
      // the bend so the arrow never runs through it.
      const part = ground({ style: "ribbon", bendDeg, pointsTo: [0, 0, 12] });
      const box = boxOf(arrowOf(part));
      const reach = side < 0 ? -box.min.x : box.max.x;
      const other = side < 0 ? box.max.x : -box.min.x;
      expect(reach).toBeGreaterThan(other + 0.3);
      expect(Math.sign(plateOf(part).position.x)).toBe(-side);
    },
  );

  it("is drawn in the record's two colours, else the role's accent and the style's dark", () => {
    // Why: the creator's colours are what was checked against the sun
    // warning; without them the role decides, as on every short text.
    const own = coloursOf(
      arrowOf(
        ground({
          style: "vanes",
          color: "#ff2200",
          darkColor: "#002244",
          pointsTo: [0, 0, 10],
        }),
      ),
    );
    expect(own).toContain(0xff2200);
    expect(own).toContain(0x002244);
    const plain = coloursOf(
      arrowOf(
        ground({ style: "vanes", role: "warning", pointsTo: [0, 0, 10] }),
      ),
    );
    expect(plain).toContain(new Color(SHORT_TEXT_ACCENT.warning).getHex());
    expect(plain).toContain(new Color(GROUND_DARK_DEFAULT.vanes).getHex());
  });

  it.each(["vanes", "ribbon", "lights", "footprints"] as const)(
    "%s: moves (floats or glows) for a visitor, and holds still in the editor and under reduced motion",
    (style) => {
      // Why: motion draws the eye in the field, but the editor must show
      // where things are, and a visitor who asked for less motion gets
      // none.
      const frames = (env: WorldEnv) => {
        const part = ground({ style, pointsTo: [0, 0, 14] }, env);
        new Group().add(part.object);
        const shots = [0.4, 1.3, 2.2].map((seconds) => {
          part.update?.({ seconds, viewer: [0, 1.6, -3] });
          return snapshot(part).join("|");
        });
        part.dispose();
        return new Set(shots).size;
      };
      expect(frames(playEnv)).toBeGreaterThan(1);
      expect(frames(editEnv)).toBe(1);
      const calm = worldEnv("play", [], none, { reduceMotion: () => true });
      expect(frames(calm)).toBe(1);
    },
  );

  it("lays itself out again when its spot moves relative to its point", () => {
    // Why: the creator drags the spot in the editor; the arrow must end
    // 2 m short of the same point, not keep the old length.
    // A long scale, so the stop and not the scale limits the length.
    const fields = { style: "ribbon", readAtM: 40 };
    const station = new Group();
    const part = ground({ ...fields, pointsTo: [0, 0, 7] }, editEnv);
    station.add(part.object);
    part.update?.({ seconds: 0, viewer: [0, 1.6, -3] });
    const before = boxOf(arrowOf(part)).max.z;
    part.object.position.z = 3;
    part.update?.({ seconds: 0.1, viewer: [0, 1.6, -3] });
    const after = boxOf(arrowOf(part)).max.z - 3;
    const fresh = boxOf(
      arrowOf(ground({ ...fields, pointsTo: [0, 0, 4] }, editEnv)),
    );
    expect(before - after).toBeGreaterThan(2.5);
    expect(after).toBeCloseTo(fresh.max.z, 4);
  });

  it("turns its plate to the visitor only when told to", () => {
    // Why: the marks are fixed; only the plate may follow the reader.
    const still = ground({ pointsTo: [0, 0, 10] });
    const turning = ground({ pointsTo: [0, 0, 10], orientation: "upright" });
    for (const part of [still, turning]) {
      new Group().add(part.object);
      part.update?.({ seconds: 1, viewer: [20, 1.6, 0] });
    }
    expect(Math.abs(plateOf(still).rotation.y)).toBeCloseTo(Math.PI, 5);
    expect(Math.abs(plateOf(turning).rotation.y)).not.toBeCloseTo(Math.PI, 1);
  });
});

describe("a ground arrow's tap", () => {
  // Why: the arrow shows only its caption; its description was decided
  // to reach the visitor as a toast on a tap. The tap is cast like every
  // other part's (`pickObject`, its angular tolerance), so it must land
  // on the arrow and its plate, and a tap elsewhere must stay free for
  // the next handler (the pin sheet), whatever plausible tolerance the
  // pick uses.
  const TOLERANCES_DEG = [0, 1, PICK_TOLERANCE_DEG, 6, 10];

  function shown(fields: Record<string, unknown>, env: WorldEnv) {
    const part = ground({ pointsTo: [0, 0, 8], ...fields }, env);
    const scene = new Scene();
    const station = new Group();
    station.name = "station-content:s";
    scene.add(station);
    station.add(part.object);
    part.update?.({ seconds: 0, viewer: [0, 1.6, -2] });
    scene.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(60, 9 / 16, 0.05, 200);
    camera.position.set(0, 1.6, -2);
    camera.lookAt(0, 0, 3);
    camera.updateMatrixWorld(true);
    return { part, scene, camera };
  }

  /** `point` (the part's frame) on the screen, in NDC. */
  const ndcOf = (
    camera: PerspectiveCamera,
    x: number,
    y: number,
    z: number,
  ) => {
    const p = new Vector3(x, y, z).project(camera);
    return { x: p.x, y: p.y };
  };

  function tapAt(
    scene: Scene,
    camera: PerspectiveCamera,
    ndc: { x: number; y: number },
    part: WorldPart,
    toleranceDeg: number,
  ): boolean {
    return tapShownWorldPart(
      scene,
      (targets, at) => pickObject(camera, targets, { ndc: at, toleranceDeg }),
      ndc,
      [part],
    );
  }

  it("says the description when the arrow or its plate is tapped", () => {
    for (const style of TOUR_GROUND_STYLES) {
      for (const toleranceDeg of TOLERANCES_DEG) {
        const said: string[] = [];
        const env = worldEnv("play", [], none, { say: (t) => said.push(t) });
        const { part, scene, camera } = shown(
          { style, description: "  Up the stairs, then left. " },
          env,
        );
        const marks = boxOf(arrowOf(part)).getCenter(new Vector3());
        const plate = boxOf(plateOf(part)).getCenter(new Vector3());
        for (const at of [marks, plate]) {
          expect(
            tapAt(
              scene,
              camera,
              ndcOf(camera, at.x, at.y, at.z),
              part,
              toleranceDeg,
            ),
            `${style} at ${toleranceDeg} deg`,
          ).toBe(true);
        }
        expect(said).toEqual([
          "Up the stairs, then left.",
          "Up the stairs, then left.",
        ]);
      }
    }
  });

  it("leaves a tap elsewhere to the next handler", () => {
    for (const toleranceDeg of TOLERANCES_DEG) {
      const said: string[] = [];
      const env = worldEnv("play", [], none, { say: (t) => said.push(t) });
      const { part, scene, camera } = shown({ description: "Left." }, env);
      // The sky high up, and the ground well to the side of the arrow.
      for (const ndc of [{ x: 0, y: 0.95 }, ndcOf(camera, 6, 0, 3)]) {
        const sheet: unknown[] = [];
        routeVisitorTap(ndc as never, {
          character: () => false,
          model: () => false,
          part: () => tapAt(scene, camera, ndc, part, toleranceDeg),
          pinSheet: { close: () => undefined, tapped: (t) => sheet.push(t) },
        });
        expect(sheet, `${String(toleranceDeg)} deg`).toEqual([ndc]);
      }
      expect(said).toEqual([]);
    }
  });

  it("does not take a tap where a hidden plate would stand", () => {
    // Why: with its caption painted on a floor arrow the plate is hidden,
    // but a raycast still meets hidden meshes; the empty spot beside the
    // arrow's start must stay free for the next handler. Node paints no
    // caption (no canvas), so the test hides the plate as that layout does.
    for (const toleranceDeg of [0, 1]) {
      const said: string[] = [];
      const env = worldEnv("play", [], none, { say: (t) => said.push(t) });
      const { part, scene, camera } = shown(
        { style: "floor", captionOnArrow: true, description: "Left." },
        env,
      );
      plateOf(part).visible = false;
      const at = boxOf(plateOf(part).children[0]!).getCenter(new Vector3());
      expect(
        tapAt(
          scene,
          camera,
          ndcOf(camera, at.x, at.y, at.z),
          part,
          toleranceDeg,
        ),
      ).toBe(false);
      expect(said).toEqual([]);
    }
  });

  it("takes no tap without a description, in the editor or with no toast", () => {
    const said: string[] = [];
    const say = (t: string) => said.push(t);
    for (const part of [
      ground({ description: "   " }, worldEnv("play", [], none, { say })),
      ground({}, worldEnv("play", [], none, { say })),
      ground({ description: "Left." }, worldEnv("edit", [], none, { say })),
      ground({ description: "Left." }, playEnv),
    ]) {
      expect(part.tap).toBeUndefined();
    }
    expect(said).toEqual([]);
  });
});
