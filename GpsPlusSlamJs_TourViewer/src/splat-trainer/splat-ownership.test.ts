import { describe, expect, it } from "vitest";
import type {
  Matrix4,
  Quaternion,
  Vector3,
} from "gps-plus-slam-app-framework/core";

import { SYNTHETIC_PROJECTION } from "../test-support/synthetic-recording.js";
import {
  createOwnership,
  sees,
  shellCrop,
  type OwnershipCamera,
} from "./splat-ownership.js";
import { TRAINER_DEFAULTS } from "./trainer-defaults.js";
import { planWindows, type WalkFrame } from "./walk-windows.js";

/** Looking along -z (WebXR's forward) with no rotation. */
const FORWARD: Quaternion = [0, 0, 0, 1];
/** Turned 180 degrees about y: looking along +z. */
const BACKWARD: Quaternion = [0, 1, 0, 0];

/** A camera at x on the x axis; its distance along the walk defaults to
 *  x, as on a walk along x. */
function camera(
  x: number,
  window: number,
  rotation: Quaternion = FORWARD,
  along: number = x,
): OwnershipCamera {
  return { position: [x, 0, 0], rotation, window, along };
}

/** Turned about y so that WebXR's forward (-z) points along (dx, dz). */
function heading(dx: number, dz: number): Quaternion {
  const yaw = Math.atan2(-dx, -dz);
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

interface Walk {
  readonly frames: WalkFrame[];
  readonly rotations: Quaternion[];
}

/** A walk through `corners` (x, z) at eye height 0, one capture per metre
 *  and per second, each looking where it walks. */
function walkThrough(corners: readonly (readonly [number, number])[]): Walk {
  const frames: WalkFrame[] = [];
  const rotations: Quaternion[] = [];
  corners.slice(1).forEach(([x1, z1], k) => {
    const [x0, z0] = corners[k] ?? [x1, z1];
    const steps = Math.round(Math.hypot(x1 - x0, z1 - z0));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      frames.push({
        position: [x0 + t * (x1 - x0), 0, z0 + t * (z1 - z0)],
        capturedAt: frames.length * 1000,
      });
      rotations.push(heading(x1 - x0, z1 - z0));
    }
  });
  return { frames, rotations };
}

/** The walk's cameras as the export passes them: each window's core
 *  training cameras, with their distance along the walk. */
function camerasOf(walk: Walk): {
  cameras: OwnershipCamera[];
  windows: { segment: number }[];
} {
  const plan = planWindows(walk.frames, TRAINER_DEFAULTS);
  const held = new Set(plan.holdouts);
  const cameras = plan.windows.flatMap((w, window) =>
    w.core
      .filter((i) => !held.has(i))
      .map((i): OwnershipCamera => ({
        position: walk.frames[i]?.position ?? [0, 0, 0],
        rotation: walk.rotations[i] ?? FORWARD,
        window,
        along: plan.along[i] ?? 0,
      })),
  );
  return { cameras, windows: [...plan.windows] };
}

const P: Matrix4 = SYNTHETIC_PROJECTION;

/** The window of the nearest camera that sees `p` within range. */
function nearestSeeing(
  cameras: readonly OwnershipCamera[],
  p: Vector3,
  range: number,
): number | undefined {
  const seeing = cameras
    .map((c) => ({
      c,
      d: Math.hypot(
        c.position[0] - p[0],
        c.position[1] - p[1],
        c.position[2] - p[2],
      ),
    }))
    .filter(({ c, d }) => d <= range && sees(c, P, p))
    .sort((a, b) => a.d - b.d);
  return seeing[0]?.c.window;
}

describe("sees", () => {
  it("sees a point straight ahead and not one behind or far to the side", () => {
    // Why: the frustum test is what decides which cameras can claim a
    // splat; behind the camera (w <= 0) must never count.
    const cam = camera(0, 0);
    expect(sees(cam, P, [0, 0, -5])).toBe(true);
    expect(sees(cam, P, [0, 0, 5])).toBe(false);
    expect(sees(cam, P, [50, 0, -5])).toBe(false);
    expect(sees(camera(0, 0, BACKWARD), P, [0, 0, 5])).toBe(true);
  });

  it("ignores the near and far planes", () => {
    // Why: a splat closer than the near plane or past the far plane is
    // still in the camera's view cone; the clip planes are a renderer's.
    const cam = camera(0, 0);
    expect(sees(cam, P, [0, 0, -0.01])).toBe(true);
    expect(sees(cam, P, [0, 0, -5000])).toBe(true);
  });
});

describe("createOwnership", () => {
  const windows = [{ segment: 0 }, { segment: 0 }, { segment: 0 }];

  it("gives a point to the nearest camera that sees it within range", () => {
    // Why: the nearest view has the finest detail of the spot.
    const own = createOwnership(
      [camera(0, 0), camera(10, 1), camera(20, 2)],
      windows,
      P,
      40,
    );
    expect(own.ownerOf([11, 0, -3])).toBe(1);
    expect(own.ownerOf([1, 0, -3])).toBe(0);
  });

  it("gives a point no camera sees to no window", () => {
    const own = createOwnership([camera(0, 0)], [{ segment: 0 }], P, 40);
    expect(own.ownerOf([0, 0, 5])).toBe(-1);
  });

  it("gives a point seen only from beyond the range to the nearest camera that sees it", () => {
    // Why: a far view is still the only view; dropping it would leave a
    // hole where the walk saw something.
    const own = createOwnership(
      [camera(0, 0), camera(10, 1, BACKWARD)],
      [{ segment: 0 }, { segment: 0 }],
      P,
      5,
    );
    expect(own.ownerOf([0, 0, -50])).toBe(0);
  });

  it("gives a revisited spot to the earliest window, whichever camera is nearer", () => {
    // Why: window 2 came back to window 0's spot 200 m later along the
    // walk (a loop); if each kept the splats its nearer camera claims, the
    // spot would hold two interleaved copies of itself.
    const own = createOwnership(
      [camera(0, 0), camera(500, 1, FORWARD, 100), camera(1, 2, FORWARD, 200)],
      windows,
      P,
      40,
    );
    expect(own.ownerOf([1, 0, -2])).toBe(0);
    expect(own.ownerOf([0.2, 0, -2])).toBe(0);
  });

  it.each([20, 40, 80])(
    "never reads a straight forward walk as a revisit (ownRangeM %d)",
    (ownRangeM) => {
      // Why: on a plain walk the window two back still sees the start of
      // each window from 30 to 40 m away. Counting it as a revisit gave
      // that distant view the spot and dropped the window standing on it.
      // A revisit is decided by distance along the walk, not by how many
      // windows lie between.
      const { cameras, windows: plan } = camerasOf(
        walkThrough([
          [0, 0],
          [0, -90],
        ]),
      );
      expect(plan).toHaveLength(3);
      const own = createOwnership(cameras, plan, P, ownRangeM);
      // On the ground, 5 m into window 2 (which starts at z = -60).
      expect(own.ownerOf([0, -1.5, -65])).toBe(2);
    },
  );

  it.each([20, 40, 80])(
    "gives the spot of a walked loop to the first pass, though the second is nearer (ownRangeM %d)",
    (ownRangeM) => {
      // Why: a loop that comes back to its start passes the same spot
      // about 220 m later along the walk, with a little drift (0.3 m
      // here). The two passes' models of it must never be kept together.
      const { cameras, windows: plan } = camerasOf(
        walkThrough([
          [0, 0],
          [0, -90],
          [20, -90],
          [20, 0],
          [0.3, 0],
          [0.3, -30],
        ]),
      );
      const own = createOwnership(cameras, plan, P, ownRangeM);
      const spot: Vector3 = [0.3, -1.5, -15];
      // The nearer view is the second pass's, so the revisit rule decides.
      expect(nearestSeeing(cameras, spot, ownRangeM)).toBe(plan.length - 1);
      expect(own.ownerOf(spot)).toBe(0);
    },
  );

  it("gives a spot of an out-and-back walk to the nearest window of the first pass, not the earliest", () => {
    // Why: the walk goes out 150 m and comes back 0.6 m beside itself.
    // The return pass is nearest here, so the revisit rule decides; but
    // windows 0, 1 and 2 of the way out all see the spot within range.
    // Taking the earliest of them gave window 0's view from 36 m away the
    // spot standing 5 m into window 2, interleaving it with window 2's
    // close-up splats at every spot where window 2 is nearest. Of the
    // first pass, the nearest seeing window must keep it.
    const { cameras, windows: plan } = camerasOf(
      walkThrough([
        [0, 0],
        [0, -150],
        [0.6, -150],
        [0.6, 0],
      ]),
    );
    const own = createOwnership(cameras, plan, P, 40);
    const spot: Vector3 = [0.5, -1.5, -65];
    expect(nearestSeeing(cameras, spot, 40)).toBeGreaterThan(4);
    expect(own.ownerOf(spot)).toBe(2);
  });

  it("never lets a camera beyond the range claim a revisit", () => {
    // Why: rule 1 counts only cameras within ownRangeM. An earlier window
    // that saw a spot from 74 m away, however far back along the walk,
    // must not take it from the window standing 5 m from it. The far
    // camera sits in the grid cell next to the spot's, so the grid alone
    // does not hide it.
    const own = createOwnership(
      [
        { position: [0, 0, -1], rotation: FORWARD, window: 0, along: 0 },
        { position: [0, 0, -70], rotation: FORWARD, window: 2, along: 300 },
      ],
      windows,
      P,
      40,
    );
    expect(own.ownerOf([0, -1.5, -75])).toBe(2);
  });

  it("splits a seam between neighbouring windows by the nearest camera", () => {
    // Why: neighbours share the overlap on purpose; the nearest view wins
    // there, with no first-come rule.
    const own = createOwnership(
      [camera(0, 0), camera(4, 1)],
      [{ segment: 0 }, { segment: 0 }],
      P,
      40,
    );
    // Both cameras see these two points.
    expect(own.ownerOf([2.5, 0, -4])).toBe(1);
    expect(own.ownerOf([1.5, 0, -4])).toBe(0);
  });

  it("treats windows of different segments as a revisit whatever their distance along the walk", () => {
    // Why: distances along two segments are not comparable; the two sides
    // of a tracking jump never share a spot.
    const own = createOwnership(
      [camera(0, 0), camera(1, 1)],
      [{ segment: 0 }, { segment: 1 }],
      P,
      40,
    );
    expect(own.ownerOf([1, 0, -2])).toBe(0);
  });

  it("rejects a camera of an unknown window, a bad range or a bad distance along the walk", () => {
    expect(() => createOwnership([camera(0, 3)], windows, P, 40)).toThrow(
      RangeError,
    );
    expect(() => createOwnership([camera(0, 0)], windows, P, 0)).toThrow(
      RangeError,
    );
    expect(() =>
      createOwnership([camera(0, 0, FORWARD, Number.NaN)], windows, P, 40),
    ).toThrow(RangeError);
  });
  it("rejects a camera too far from the origin to key its grid cell", () => {
    // Why: past the cell key's range two cells share one key, so a camera
    // there would be found from a spot on the other side of the world.
    // 70 000 cells of the range is past the key's 65 535.
    expect(() =>
      createOwnership([camera(70000 * 40, 0)], [{ segment: 0 }], P, 40),
    ).toThrow(RangeError);
  });

  it("answers a spot far outside the key's range by rules 3 and 4, never from an aliased cell", () => {
    // Why: a splat can land anywhere, and its cell is never keyed past the
    // range; the spot at cell y 65 541 packs to the same key as the
    // camera's cell (1, -65 531, 0), and must still be told by the
    // cameras that see it, not by a key that only collides.
    const up: Quaternion = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const cam: OwnershipCamera = {
      position: [1.5, -65530.5, 0.5],
      rotation: up,
      window: 0,
      along: 0,
    };
    const own = createOwnership([cam], [{ segment: 0 }], P, 1);
    // Seen, but from 131 072 m: rule 3 names the camera's window.
    expect(own.ownerOf([1.5, 65541.5, 0.5])).toBe(0);
    // Below the camera, seen by nothing: rule 4.
    expect(own.ownerOf([1.5, -70000, 0.5])).toBe(-1);
    expect(own.ownerOf([1e12, 1e12, 1e12])).toBe(-1);
  });
});

describe("shellCrop", () => {
  it("keeps a point within the keep distance of one of the window's cameras", () => {
    // Why: past the keep distance lie the background shell's splats,
    // which every window grows on its own and the merge must not stack.
    const keep = shellCrop(
      [
        [0, 0, -5],
        [0, 0, -50],
        [30, 0, 0],
      ] as Vector3[],
      [
        [0, 0, 0],
        [28, 0, 0],
      ] as Vector3[],
      0.8 * 25,
    );
    expect(keep).toEqual([true, false, true]);
  });

  it("rejects a non-positive keep distance or a camera too far out to key", () => {
    expect(() => shellCrop([], [], 0)).toThrow(RangeError);
    expect(() => shellCrop([], [[70000 * 20, 0, 0]], 20)).toThrow(RangeError);
  });
});
