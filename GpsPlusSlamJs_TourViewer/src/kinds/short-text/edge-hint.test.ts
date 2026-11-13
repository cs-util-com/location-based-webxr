/**
 * Why this test matters: a hint at the screen's edge is the visitor's
 * only clue to something out of view. Its tag must stay on the screen
 * whatever the spot does (in front, aside, behind), stand over the spot
 * while it is in view, and must not flicker between its compact and its
 * full look at the edge of the view. These rules are pure and pinned
 * here; the part itself is checked for drawing nothing it cannot place.
 */
import fc from "fast-check";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { worldEnv } from "../../world-part.js";
import {
  EDGE_HINT,
  edgeHintFullyInView,
  edgeHintPart,
  edgeHintPlace,
} from "./edge-hint.js";

const W = 844;
const H = 390;
const size = { w: 120, h: 30, fitW: 120, fitH: 30 };
const env = worldEnv("play", [], () => Promise.reject(new Error("none")));

describe("where the tag goes", () => {
  it("stands over a spot in view", () => {
    const at = edgeHintPlace(
      { sx: 400, sy: 200, behind: false, dirX: 0, dirY: 0 },
      W,
      H,
      size,
    );
    expect(at.edge).toBe(false);
    expect(at.x + size.w / 2).toBeCloseTo(400, 5);
    expect(at.y + size.h + EDGE_HINT.above).toBeCloseTo(200, 5);
  });

  it("goes to the edge on the side of a spot out of view, its arrow that way", () => {
    // Why: a spot to the right, off screen, puts the tag on the right
    // edge with its arrow pointing right; one behind goes to the side
    // it is nearer.
    const right = edgeHintPlace(
      { sx: 2000, sy: 200, behind: false, dirX: 5, dirY: 0 },
      W,
      H,
      size,
    );
    expect(right.edge).toBe(true);
    expect(right.x + size.w).toBeCloseTo(W - EDGE_HINT.insetX, 5);
    expect(right.angle).toBeCloseTo(0, 5);
    const behindLeft = edgeHintPlace(
      // Behind and a little up: its height counts a fifth, so the left.
      { sx: 300, sy: 200, behind: true, dirX: -1, dirY: 1 },
      W,
      H,
      size,
    );
    expect(behindLeft.edge).toBe(true);
    expect(behindLeft.x).toBeCloseTo(EDGE_HINT.insetX, 5);
  });

  it("places a spot with no direction on the edge toward its screen point", () => {
    // Why: a spot dead ahead of the lens but out of the tag's room (its
    // camera-frame direction zero) once made the tag's position NaN, so
    // the tag vanished; it goes to the edge its screen point lies toward.
    const at = edgeHintPlace(
      { sx: 0, sy: 0, behind: false, dirX: 0, dirY: 0 },
      W,
      H,
      size,
    );
    expect(at.edge).toBe(true);
    expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true);
    // Toward the top left, where the spot's screen point is.
    expect(at.angle).toBeGreaterThan(Math.PI / 2);
    expect(at.angle).toBeLessThan(Math.PI);
    expect(at.x).toBeGreaterThanOrEqual(EDGE_HINT.insetX - 1e-6);
    expect(at.y).toBeGreaterThanOrEqual(EDGE_HINT.insetTop - 1e-6);
  });

  it("is always on the screen, inside its insets", () => {
    // Why: wherever the spot is, the tag is readable: the property over
    // any spot and direction, on a phone on its side, upright, and a
    // desktop.
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.boolean(),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.constantFrom([844, 390], [390, 844], [1280, 800]),
        (sx, sy, behind, dirX, dirY, [w = 0, h = 0]) => {
          const at = edgeHintPlace({ sx, sy, behind, dirX, dirY }, w, h, size);
          const slack = 1e-6;
          expect(at.x).toBeGreaterThanOrEqual(EDGE_HINT.insetX - slack);
          expect(at.x + size.w).toBeLessThanOrEqual(
            w - EDGE_HINT.insetX + slack,
          );
          expect(at.y).toBeGreaterThanOrEqual(EDGE_HINT.insetTop - slack);
          expect(at.y + size.h).toBeLessThanOrEqual(
            h - EDGE_HINT.insetBottom + slack,
          );
        },
      ),
    );
  });
});

describe("fully in view, with hysteresis", () => {
  it("comes in only well inside, and goes out only well outside", () => {
    // Why: deciding at one line made the tag flip every frame as the
    // phone shook; in at 24 px inside, out at 8 px outside.
    const corner = [{ sx: EDGE_HINT.insetX + 10, sy: 200, front: true }];
    expect(edgeHintFullyInView(corner, W, H, EDGE_HINT.fullIn)).toBe(false);
    expect(edgeHintFullyInView(corner, W, H, -EDGE_HINT.fullOut)).toBe(true);
    expect(
      edgeHintFullyInView([{ sx: 400, sy: 200, front: false }], W, H, 0),
    ).toBe(false);
  });
});

describe("the hint's part", () => {
  const block = {
    id: "h",
    kind: "shortText",
    view: "edgeHint",
    caption: "Toilets",
  } as Parameters<typeof edgeHintPart>[0];

  it("shows only its ring without a camera", () => {
    // Why: a page that hands no camera cannot place the tag; it must
    // hide rather than stand at a wrong place.
    const part = edgeHintPart(block, env);
    new Group().add(part.object);
    part.update?.({ seconds: 0, viewer: [0, 1.6, 5] });
    expect(part.object.children.filter((c) => c.visible)).toHaveLength(1);
    part.dispose();
  });

  it("puts its tag in front of the camera, above the middle, for a spot ahead", () => {
    // Why: in view, the tag stands over its spot (1.9 m up, so above
    // a camera at eye height), set its depth in front of the camera.
    const part = edgeHintPart(block, env);
    const scene = new Group();
    scene.add(part.object);
    part.object.position.set(0, 0, -6);
    const camera = new PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld(true);
    part.update?.({
      seconds: 0,
      viewer: [0, 1.6, 0],
      camera,
      metresPerPxAtOneM: 2 / ((camera.projectionMatrix.elements[5] ?? 1) * H),
    });
    scene.updateMatrixWorld(true);
    const tag = part.object.children.find(
      (c) => c.visible && c.renderOrder === 999,
    );
    expect(tag).toBeDefined();
    const at = tag?.getWorldPosition(new Vector3()) ?? new Vector3();
    const d = at.distanceTo(camera.position);
    expect(d).toBeGreaterThan(EDGE_HINT.depthM - 0.01);
    expect(d).toBeLessThan(EDGE_HINT.depthM * 1.3);
    expect(at.y).toBeGreaterThan(1.6);
    part.dispose();
  });
});
