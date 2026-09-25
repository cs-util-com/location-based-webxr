/**
 * `normalizeModel` makes a GLB behave like the sprite template it shares a
 * waypoint slot with (D4, Shared-Contract.md): same footprint height, same
 * horizontal centering, base clearing the ground instead of trusting the
 * model's authored pivot/scale/position. See gltf-loading.ts and config.ts's
 * VISUAL_GROUND_CLEARANCE_M / SPRITE_HEIGHT_M.
 */

import { describe, expect, it } from "vitest";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";

import { normalizeModel } from "./gltf-loading.js";
import { VISUAL_GROUND_CLEARANCE_M } from "../config.js";

const SPRITE_HEIGHT_M = 1.8;

function worldBox(root: Group): Box3 {
  return new Box3().setFromObject(root);
}

describe("normalizeModel", () => {
  it("scales a model uniformly so its height matches the sprite height", () => {
    // A 1m cube centered on its own origin.
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));

    normalizeModel(root);

    const size = worldBox(root).getSize(new Vector3());
    expect(size.y).toBeCloseTo(SPRITE_HEIGHT_M);
    // Uniform scale: width shrinks/grows by the same factor as height, so a
    // 1:1:1 box stays 1:1:1 in proportion — not force-matched to sprite width.
    expect(size.x).toBeCloseTo(SPRITE_HEIGHT_M);
    expect(size.z).toBeCloseTo(SPRITE_HEIGHT_M);
  });

  it("does not distort a non-cubic model's proportions to fill the sprite's width", () => {
    // 4m wide, 1m tall — much wider than the sprite footprint (1.08m).
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(4, 1, 1), new MeshBasicMaterial()));

    normalizeModel(root);

    const size = worldBox(root).getSize(new Vector3());
    expect(size.y).toBeCloseTo(SPRITE_HEIGHT_M);
    // Scale factor is height-driven (1.8x here), so width scales by the same
    // 1.8x rather than being clamped/stretched to the sprite's own width.
    expect(size.x).toBeCloseTo(4 * SPRITE_HEIGHT_M);
  });

  it("re-centers an off-axis model onto the waypoint's vertical axis", () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.position.set(5, 3, -3); // authored pivot far from its own bounds' center
    root.add(mesh);

    normalizeModel(root);

    const center = worldBox(root).getCenter(new Vector3());
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
  });

  it("grounds the model so its base clears the ground by VISUAL_GROUND_CLEARANCE_M", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));

    normalizeModel(root);

    expect(worldBox(root).min.y).toBeCloseTo(VISUAL_GROUND_CLEARANCE_M);
  });

  it("does nothing to an empty group", () => {
    const root = new Group();

    expect(() => normalizeModel(root)).not.toThrow();
    expect(root.position.y).toBe(0);
    expect(root.scale.y).toBe(1);
  });
});
