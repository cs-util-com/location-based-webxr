/**
 * Why these tests matter: the look is drawn at the prototype's reference
 * width and scaled, so its size must follow the creator's width exactly
 * (the editor's size preview and the placement contract read it); a
 * cutout turns toward the visitor but never so far that it shows its
 * edge; and a porthole crops the clip to its centred square whatever its
 * shape.
 */
import {
  Box3,
  type Mesh,
  type Object3D,
  type ShaderMaterial,
  Texture,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import {
  CUTOUT_MAX_TURN,
  centredSquare,
  standHereSpot,
  videoLook,
  type LookState,
  type VideoWorldView,
} from "./video-look.js";

function look(view: VideoWorldView, widthM: number) {
  return videoLook({
    view,
    widthM,
    aspect: 0.5625,
    stacked: false,
    liftM: 0,
    edit: false,
    canvasTexture: () => {
      throw new Error("no canvas in node");
    },
  });
}

const STILL: LookState = {
  clip: null,
  poster: null,
  started: false,
  playing: false,
  progress: 0,
  time: "0:00 / 0:00",
  sound: false,
  seconds: 0,
  viewer: null,
};

function size(o: Object3D): Vector3 {
  o.updateMatrixWorld(true);
  return new Box3().setFromObject(o).getSize(new Vector3());
}

/** The heights, in the look's parent, of the meshes lying flat (its
 *  ground shadows). */
function shadowYs(o: Object3D): number[] {
  o.updateMatrixWorld(true);
  const ys: number[] = [];
  o.traverse((c) => {
    if ((c as Mesh).isMesh && Math.abs(c.rotation.x + Math.PI / 2) < 1e-9) {
      ys.push(c.getWorldPosition(new Vector3()).y);
    }
  });
  return ys;
}

/** The largest turn about the vertical among the look's parts. */
function turn(o: Object3D): number {
  let most = 0;
  o.traverse((c) => {
    if (Math.abs(c.rotation.y) > Math.abs(most)) most = c.rotation.y;
  });
  return most;
}

describe("a free video's look", () => {
  it("is exactly twice as large at twice the width, in every view", () => {
    for (const view of [
      "screen",
      "cutout",
      "porthole",
      "window",
      "standHere",
    ] as const) {
      const one = size(look(view, 1.6).object);
      const two = size(look(view, 3.2).object);
      expect(two.x / one.x, view).toBeCloseTo(2, 5);
      expect(two.y / one.y, view).toBeCloseTo(2, 5);
    }
  });

  it("turns a cutout toward the viewer, at most 30 degrees", () => {
    const cutout = look("cutout", 1.6);
    cutout.show({ ...STILL, viewer: [0, 1.5, 6], seconds: 0 });
    expect(Math.abs(turn(cutout.object))).toBeLessThan(1e-6);
    // Far to the side: it would face him only at 90 degrees.
    for (let s = 1; s < 30; s++) {
      cutout.show({ ...STILL, viewer: [100, 1.5, 0.5], seconds: s });
    }
    expect(turn(cutout.object)).toBeCloseTo(CUTOUT_MAX_TURN, 3);
  });

  // Why: a folder drawing the part at another scale moves where its
  // ground is in the part's own metres; the look must move its shadow
  // (and a cutout its foot) there, in its parent's metres, without being
  // rebuilt. Nonsense must not move it, and the porthole has no ground.
  it("stands its shadow the given lift below, and ignores nonsense", () => {
    for (const view of ["screen", "cutout", "window"] as const) {
      const l = look(view, 2);
      const at0 = shadowYs(l.object);
      expect(at0.length, view).toBeGreaterThan(0);
      l.ground(1.5);
      for (const [i, y] of shadowYs(l.object).entries()) {
        expect(y, view).toBeCloseTo((at0[i] ?? 0) - 1.5, 6);
      }
      l.ground(Number.NaN);
      for (const [i, y] of shadowYs(l.object).entries()) {
        expect(y, view).toBeCloseTo((at0[i] ?? 0) - 1.5, 6);
      }
    }
    const porthole = look("porthole", 2);
    expect(() => {
      porthole.ground(3);
    }).not.toThrow();
  });

  it("crops a clip to its centred square, whatever its shape", () => {
    expect(centredSquare(1)).toEqual([0, 0, 1, 1]);
    expect(centredSquare(0.5625)).toEqual([(1 - 0.5625) / 2, 0, 0.5625, 1]);
    expect(centredSquare(2)).toEqual([0, 0.25, 1, 0.5]);
    expect(centredSquare(Number.NaN)).toEqual([0, 0, 1, 1]);
  });
});

/** The meshes of `o` named `name`. */
function named(o: Object3D, name: string): Mesh[] {
  const found: Mesh[] = [];
  o.traverse((c) => {
    if (c.name === name) found.push(c as Mesh);
  });
  return found;
}

/** A clip material's uniform `name`. */
function uniform(mesh: Mesh | undefined, name: string): unknown {
  return (mesh?.material as ShaderMaterial | undefined)?.uniforms[name]?.value;
}

describe("a video in a window", () => {
  // Why: the clip plays deep in a real opening, so it reads as a room
  // behind the wall; the frame keeps to the opening's edge, since the
  // chosen look has nothing lying over the clip itself (no cross bars).
  it("plays behind the wall, its timber only round the opening's edge", () => {
    const w = 1.6;
    const h = w * 0.5625;
    const l = look("window", w);
    l.object.updateMatrixWorld(true);
    const [clip] = named(l.object, "video-window-clip");
    expect(clip?.position.z).toBeCloseTo(-0.38, 6);
    expect(l.tapTarget).toBe(clip);
    const bars = named(l.object, "video-window-bar");
    expect(bars).toHaveLength(4);
    for (const bar of bars) {
      const box = new Box3().setFromObject(bar);
      // Each bar touches the opening's outline and reaches no further in
      // than its own thickness.
      const atSide =
        Math.abs(Math.abs(bar.position.x) - (w / 2 - 0.03)) < 1e-6 &&
        box.max.y - box.min.y > h - 1e-6;
      const atTopOrFoot =
        Math.abs(Math.abs(bar.position.y) - (h / 2 - 0.03)) < 1e-6 &&
        box.max.x - box.min.x > w - 1e-6;
      expect(atSide || atTopOrFoot).toBe(true);
    }
    // The clip's edge darkens inward, as the prototype's reveal light.
    expect(uniform(clip, "inner")).toBeCloseTo(0.42, 6);
  });
});

describe("a stand-here video's look", () => {
  // Why: undeveloped the projection is a faint sepia ghost, developed the
  // clip; the look must hand the shade of the rule to its clip, and the
  // editor sees it developed (its creator places the picture, not the
  // ghost).
  it("is shaded by its develop, and drawn whole in the editor", () => {
    const l = look("standHere", 1.6);
    const [clip] = named(l.object, "video-stand-here-clip");
    expect(l.tapTarget).toBe(clip);
    l.show({ ...STILL, develop: 0 });
    expect(uniform(clip, "opacity")).toBeCloseTo(0.13, 6);
    expect(uniform(clip, "tone")).toBeCloseTo(1, 6);
    expect(uniform(clip, "ellipse")).toBe(1);
    l.show({ ...STILL, develop: 1 });
    expect(uniform(clip, "opacity")).toBeCloseTo(1, 6);
    expect(uniform(clip, "tone")).toBeCloseTo(0, 6);
    l.show(STILL);
    expect(uniform(clip, "opacity")).toBeCloseTo(1, 6);
  });

  // Why: the prototype's waiting ghost is the clip's own first frame; a
  // poster (a title card, another picture) would develop into a picture
  // that is not the clip. Other views still show their poster.
  it("shows the clip, never its poster, as the stand-here ghost", () => {
    const poster = new Texture();
    const l = look("standHere", 1.6);
    const [clip] = named(l.object, "video-stand-here-clip");
    l.show({ ...STILL, poster, develop: 0 });
    expect(uniform(clip, "hasPoster")).toBe(0);
    expect(uniform(clip, "posterMix")).toBe(0);
    const screen = look("screen", 1.6);
    screen.show({ ...STILL, poster });
    let mixes = 0;
    screen.object.traverse((c) => {
      const m = (c as Mesh).material as ShaderMaterial | undefined;
      if (m?.uniforms?.posterMix?.value === 1) mixes++;
    });
    expect(mixes).toBeGreaterThan(0);
  });

  it("stands its footprints at the viewpoint, on the ground, toes the way to face", () => {
    // Why: the spot is where the visitor must go; it is in the station's
    // frame (the part's anchor undoes its pose), and its toes point the
    // way the viewpoint looks, so standing on them faces the video.
    const spot = standHereSpot(
      {
        position: [4, 1.6, -2],
        // Facing east (`viewpointRotation(90, 0)`): a half turn about up,
        // so its -Z looks along +Z.
        rotation: [0, Math.sin(-Math.PI / 2), 0, Math.cos(-Math.PI / 2)],
        hfovDeg: 56,
        distanceM: 6,
      },
      () => {
        throw new Error("no canvas in node");
      },
    );
    expect(spot.object.position.toArray()).toEqual([4, 0.014, -2]);
    spot.object.updateMatrixWorld(true);
    const toes = new Vector3(0, 0, -1).transformDirection(
      spot.object.matrixWorld,
    );
    // Facing the viewpoint's own forward.
    expect(toes.x).toBeCloseTo(0, 6);
    expect(toes.z).toBeCloseTo(1, 6);
    expect(() => {
      spot.show(0.3, 1);
      spot.dispose();
    }).not.toThrow();
  });
});
