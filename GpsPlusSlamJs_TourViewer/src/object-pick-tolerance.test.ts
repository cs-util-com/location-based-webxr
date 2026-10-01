/**
 * The pick tolerance, swept (M4 review #4; the owner's parameter rule: a
 * constant is justified across a plausible range, with the value that
 * would reverse it named).
 *
 * Why this test matters: `PICK_TOLERANCE_DEG` trades two failures against
 * each other. Too small and a far label (0.6 m wide, under 2 degrees at
 * 20 m) cannot be selected by a finger that lands a few degrees off; too
 * large and a tap picks the WRONG object when two stand close, or selects
 * something when the creator tapped empty scene to clear the selection.
 * This simulates both on synthetic scenes - real three.js label sprites at
 * 2-20 m, taps aimed at one of them with Gaussian angular error, and taps
 * at empty scene - through the real `pickObject`, and pins the shape of
 * the trade at the chosen value. The table it computes is in the sidecar.
 *
 * Deterministic: a seeded generator, so the numbers do not move between
 * runs.
 */
import { describe, expect, it } from "vitest";
import {
  Group,
  PerspectiveCamera,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
} from "three";

import { PICK_TOLERANCE_DEG, pickObject } from "./object-pick.js";

/** mulberry32: a small seeded generator, uniform in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal sample (Box-Muller). */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const DEG = Math.PI / 180;

/** A phone held portrait in AR: about 60 degrees of view vertically. */
function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(60, 9 / 16, 0.05, 200);
  c.updateMatrixWorld(true);
  return c;
}

/** A label as the preview renders one: a 0.6 x 0.3 m sprite in a group. */
function labelGroup(position: Vector3): Group {
  const group = new Group();
  const sprite = new Sprite(new SpriteMaterial());
  sprite.scale.set(0.6, 0.3, 1);
  sprite.position.copy(position);
  group.add(sprite);
  group.updateMatrixWorld(true);
  return group;
}

/** A direction `yawDeg` right and `pitchDeg` up of the view axis (-Z). */
function direction(yawDeg: number, pitchDeg: number): Vector3 {
  const yaw = yawDeg * DEG;
  const pitch = pitchDeg * DEG;
  return new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
}

/** Where a camera-space direction lands on the screen (NDC). */
function ndcOf(c: PerspectiveCamera, dir: Vector3) {
  const p = dir.clone().applyMatrix4(c.projectionMatrix);
  return { x: p.x, y: p.y };
}

interface Rates {
  /** The aimed-at object was picked. */
  hit: number;
  /** Another object was picked. */
  wrong: number;
  /** A tap at empty scene picked something. */
  emptyPicked: number;
}

/**
 * One cell of the sweep: `objects` labels at `near`-`far` m, spread over
 * ±20 degrees of yaw and ±8 of pitch; taps aimed at a random one with
 * `sigmaDeg` of angular error per axis, and as many at random directions
 * the exact ray finds empty (a tap meant to clear the selection).
 */
function sweepCell(options: {
  toleranceDeg: number;
  sigmaDeg: number;
  near: number;
  far: number;
  objects: number;
  scenes: number;
  seed: number;
}): Rates {
  const random = seeded(options.seed);
  const c = camera();
  let hit = 0;
  let wrong = 0;
  let aimed = 0;
  let emptyPicked = 0;
  let empty = 0;
  for (let scene = 0; scene < options.scenes; scene += 1) {
    const placed: { id: string; yaw: number; pitch: number }[] = [];
    const targets = new Map<string, Object3D>();
    for (let i = 0; i < options.objects; i += 1) {
      const yaw = (random() * 2 - 1) * 20;
      const pitch = (random() * 2 - 1) * 8;
      const distance = options.near + random() * (options.far - options.near);
      const id = `o${String(i)}`;
      placed.push({ id, yaw, pitch });
      targets.set(
        id,
        labelGroup(direction(yaw, pitch).multiplyScalar(distance)),
      );
    }
    // A tap aimed at one label, off by the finger's error.
    const aim = placed[Math.floor(random() * placed.length)]!;
    const tapYaw = aim.yaw + gaussian(random) * options.sigmaDeg;
    const tapPitch = aim.pitch + gaussian(random) * options.sigmaDeg;
    const picked = pickObject(c, targets, {
      ndc: ndcOf(c, direction(tapYaw, tapPitch)),
      toleranceDeg: options.toleranceDeg,
    });
    aimed += 1;
    if (picked === aim.id) hit += 1;
    else if (picked !== null) wrong += 1;
    // A tap at empty scene, meant to clear the selection: a random
    // direction the exact ray finds empty.
    for (let tries = 0; tries < 20; tries += 1) {
      const ndc = ndcOf(
        c,
        direction((random() * 2 - 1) * 20, (random() * 2 - 1) * 8),
      );
      if (pickObject(c, targets, { ndc, toleranceDeg: 0 }) !== null) continue;
      empty += 1;
      const stray = pickObject(c, targets, {
        ndc,
        toleranceDeg: options.toleranceDeg,
      });
      if (stray !== null) emptyPicked += 1;
      break;
    }
  }
  return {
    hit: hit / aimed,
    wrong: wrong / aimed,
    emptyPicked: empty === 0 ? 0 : emptyPicked / empty,
  };
}

const SCENES = 150;

describe("the pick tolerance (M4 review #4)", () => {
  it("swept over 0-6 degrees, finger error 1-3 degrees, 2-20 m and 3 or 8 objects", () => {
    const tolerances = [0, 1, 2, 3, 4, 5, 6];
    const table: Record<string, Record<number, Rates>> = {};
    for (const sigmaDeg of [1, 2, 3]) {
      for (const [near, far] of [
        [2, 5],
        [10, 20],
      ] as const) {
        for (const objects of [3, 8]) {
          const key = `sigma ${String(sigmaDeg)} deg, ${String(near)}-${String(far)} m, ${String(objects)} objects`;
          table[key] = {};
          for (const toleranceDeg of tolerances) {
            table[key][toleranceDeg] = sweepCell({
              toleranceDeg,
              sigmaDeg,
              near,
              far,
              objects,
              scenes: SCENES,
              seed: 7919 * sigmaDeg + near + objects,
            });
          }
        }
      }
    }
    if (process.env["PICK_SWEEP_PRINT"] === "1") {
      for (const [key, row] of Object.entries(table)) {
        const cells = tolerances
          .map((t) => {
            const r = row[t]!;
            return `${String(t)}: ${(r.hit * 100).toFixed(0)}/${(r.wrong * 100).toFixed(0)}/${(r.emptyPicked * 100).toFixed(0)}`;
          })
          .join("  ");
        process.stdout.write(`${key} | ${cells}\n`);
      }
    }
    const at = (key: string, t: number): Rates => table[key]![t]!;
    // Far labels, the realistic finger error (1 degree): the exact ray
    // alone misses most taps, the chosen tolerance almost none.
    const far = "sigma 1 deg, 10-20 m, 3 objects";
    expect(at(far, 0).hit).toBeLessThan(0.4);
    expect(at(far, PICK_TOLERANCE_DEG).hit).toBeGreaterThan(0.9);
    // A shakier hand (2 degrees): still a large gain.
    const shaky = "sigma 2 deg, 10-20 m, 3 objects";
    expect(at(shaky, PICK_TOLERANCE_DEG).hit).toBeGreaterThan(
      at(shaky, 0).hit + 0.3,
    );
    // ...without picking the wrong object often with 8 close by...
    expect(
      at("sigma 2 deg, 10-20 m, 8 objects", PICK_TOLERANCE_DEG).wrong,
    ).toBeLessThan(0.15);
    // ...and near labels, already larger than the tolerance on screen,
    // keep a tap at empty scene beside them empty.
    const near = Object.entries(table).filter(([key]) => key.includes("2-5 m"));
    for (const [key, row] of near) {
      expect(row[PICK_TOLERANCE_DEG]!.emptyPicked, key).toBeLessThan(0.06);
    }
    // The trade itself: wrong picks never fall as the tolerance grows.
    for (const row of Object.values(table)) {
      expect(row[6]!.wrong).toBeGreaterThanOrEqual(row[0]!.wrong);
    }
  });
});
