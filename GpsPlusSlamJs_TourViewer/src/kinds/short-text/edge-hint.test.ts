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
  edgeHintStepAside,
  type HintRect,
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

describe("tags that overlap step aside, nearest first", () => {
  // Why: two hints whose spots lie close together (or that go to the
  // same edge) drew their tags on top of each other, so neither could
  // be read. The nearest keeps its place; a farther tag in view moves up
  // over it, one at the edge moves down below it, a small gap between.
  const tagAt = (
    x: number,
    y: number,
    distance: number,
    edge = false,
  ): HintRect => ({ x, y, w: 120, h: 30, edge, distance });
  const pad = EDGE_HINT.stepPad;

  it("moves a farther tag in view up over the nearer one", () => {
    const ys = edgeHintStepAside([tagAt(410, 200, 9), tagAt(400, 205, 4)], H);
    expect(ys[1]).toBe(205);
    expect(ys[0]).toBe(205 - 30 - pad);
  });

  it("moves a farther tag at the edge down below the nearer one", () => {
    const ys = edgeHintStepAside(
      [tagAt(700, 150, 3, true), tagAt(700, 160, 12, true)],
      H,
    );
    expect(ys[0]).toBe(150);
    expect(ys[1]).toBe(150 + 30 + pad);
  });

  it("leaves tags that do not overlap where they are", () => {
    const ys = edgeHintStepAside([tagAt(100, 200, 9), tagAt(400, 200, 4)], H);
    expect(ys).toEqual([200, 200]);
  });

  it("steps a farther tag in view down when there is no room above", () => {
    // Why: near the top inset a tag cannot step up; it clamped back onto
    // the tag it moved away from and the two stayed one over the other.
    const top = EDGE_HINT.insetTop + 5;
    const ys = edgeHintStepAside(
      [tagAt(400, top, 2), tagAt(400, EDGE_HINT.insetTop + 8, 7)],
      H,
    );
    expect(ys[0]).toBe(top);
    expect(ys[1]).toBe(top + 30 + pad);
  });

  it("steps a farther tag at the bottom edge up, since none fits below", () => {
    // Why: a tag at the bottom edge is placed at the lowest top the
    // insets allow, so its step down always clamped back: two hints
    // below the view drew their tags exactly on top of each other.
    const bottom = H - EDGE_HINT.insetBottom - 30;
    const ys = edgeHintStepAside(
      [tagAt(400, bottom, 3, true), tagAt(410, bottom, 12, true)],
      H,
    );
    expect(ys[0]).toBe(bottom);
    expect(ys[1]).toBe(bottom - 30 - pad);
  });

  it("keeps a stepped tag inside the screen's insets when no side has room", () => {
    // Why: a tag pushed off the screen is as lost as one hidden under
    // another; with no room either way it stays inside the insets.
    const tiny = EDGE_HINT.insetTop + EDGE_HINT.insetBottom + 40;
    const ys = edgeHintStepAside(
      [
        tagAt(400, EDGE_HINT.insetTop + 5, 2),
        tagAt(400, EDGE_HINT.insetTop + 8, 7),
      ],
      tiny,
    );
    expect(ys[1]).toBeGreaterThanOrEqual(EDGE_HINT.insetTop);
    expect(ys[1]).toBeLessThanOrEqual(tiny - EDGE_HINT.insetBottom - 30);
    // A tag in view steps up first, so with no room either way it keeps
    // its own side's clamped place: the top inset.
    expect(ys[1]).toBe(EDGE_HINT.insetTop);
  });

  it("with room on the screen, no two tags overlap and the nearest never moves", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: 300, max: 500 }),
            // The whole range a tag is placed in, up to both insets.
            y: fc.integer({
              min: EDGE_HINT.insetTop,
              max: 800 - EDGE_HINT.insetBottom - 30,
            }),
            distance: fc.double({ min: 0.5, max: 80, noNaN: true }),
            edge: fc.boolean(),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        (raw) => {
          const tags = raw.map((t) => tagAt(t.x, t.y, t.distance, t.edge));
          const ys = edgeHintStepAside(tags, 800);
          const nearest = tags.reduce(
            (best, t, i) =>
              t.distance < (tags[best]?.distance ?? Infinity) ? i : best,
            0,
          );
          expect(ys[nearest]).toBe(tags[nearest]?.y);
          tags.forEach((a, i) => {
            tags.forEach((b, j) => {
              if (j <= i) return;
              const ay = ys[i] ?? 0;
              const by = ys[j] ?? 0;
              const overlap =
                a.x < b.x + b.w &&
                a.x + a.w > b.x &&
                ay < by + b.h &&
                ay + a.h > by;
              expect(overlap).toBe(false);
            });
            expect(ys[i]).toBeGreaterThanOrEqual(EDGE_HINT.insetTop);
            expect(ys[i]).toBeLessThanOrEqual(
              800 - EDGE_HINT.insetBottom - a.h,
            );
          });
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

  it("steps its tag aside from another hint's at the same spot, and back once that one goes", () => {
    // Why: the rule above only helps if the parts on one screen see each
    // other: two hints at one spot drew one tag over the other. The
    // farther one moves up by at least the nearer tag's height; once the
    // nearer one is gone it stands over its spot again.
    const scene = new Group();
    const near = edgeHintPart({ ...block, id: "near" }, env);
    const far = edgeHintPart({ ...block, id: "far" }, env);
    scene.add(near.object, far.object);
    near.object.position.set(0, 0, -6);
    far.object.position.set(0.05, 0, -6.4);
    const camera = new PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld(true);
    const metresPerPxAtOneM =
      2 / ((camera.projectionMatrix.elements[5] ?? 1) * H);
    type Part = ReturnType<typeof edgeHintPart>;
    const tick = (seconds: number, parts: readonly Part[]) => {
      for (const part of parts) {
        part.update?.({
          seconds,
          viewer: [0, 1.6, 0],
          camera,
          metresPerPxAtOneM,
        });
      }
      scene.updateMatrixWorld(true);
    };
    const tagY = (part: Part) =>
      (
        part.object.children
          .find((c) => c.visible && c.renderOrder === 999)
          ?.getWorldPosition(new Vector3()) ?? new Vector3()
      ).y;
    tick(1, [near, far]);
    tick(2, [near, far]);
    const nearY = tagY(near);
    // 1 m in front of the camera, one px covers metresPerPxAtOneM metres.
    expect((tagY(far) - nearY) / metresPerPxAtOneM).toBeGreaterThan(25);
    near.dispose();
    scene.remove(near.object);
    tick(3, [far]);
    tick(4, [far]);
    expect(Math.abs(tagY(far) - nearY) / metresPerPxAtOneM).toBeLessThan(10);
    far.dispose();
  });

  it("stops stepping aside from a hint that is not updated for a frame", () => {
    // Why: a hint whose station hides is no longer updated but never
    // disposed; its tag of the frame before still counts for one frame,
    // then must stop pushing the others away from their spots.
    const scene = new Group();
    const near = edgeHintPart({ ...block, id: "near" }, env);
    const far = edgeHintPart({ ...block, id: "far" }, env);
    scene.add(near.object, far.object);
    near.object.position.set(0, 0, -6);
    far.object.position.set(0.05, 0, -6.4);
    const camera = new PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld(true);
    const metresPerPxAtOneM =
      2 / ((camera.projectionMatrix.elements[5] ?? 1) * H);
    type Part = ReturnType<typeof edgeHintPart>;
    const tick = (seconds: number, parts: readonly Part[]) => {
      for (const part of parts) {
        part.update?.({
          seconds,
          viewer: [0, 1.6, 0],
          camera,
          metresPerPxAtOneM,
        });
      }
      scene.updateMatrixWorld(true);
    };
    const tagY = (part: Part) =>
      (
        part.object.children
          .find((c) => c.visible && c.renderOrder === 999)
          ?.getWorldPosition(new Vector3()) ?? new Vector3()
      ).y;
    tick(11, [near, far]);
    tick(12, [near, far]);
    const nearY = tagY(near);
    tick(13, [far]);
    expect((tagY(far) - nearY) / metresPerPxAtOneM).toBeGreaterThan(25);
    tick(14, [far]);
    expect(Math.abs(tagY(far) - nearY) / metresPerPxAtOneM).toBeLessThan(10);
    near.dispose();
    far.dispose();
  });
});
