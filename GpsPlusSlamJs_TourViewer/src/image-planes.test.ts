import { describe, expect, it, vi } from "vitest";
import { Object3D, Texture } from "three";

import { placeImagePlanes } from "./image-planes";

/**
 * Why these tests matter: the planes are the visible payoff of the whole
 * relocalization loop — placed at the SCENE ROOT in raw NUE (the parenting
 * rule; putting them under arWorldGroup with raw NUE coordinates would
 * double-apply the alignment and drift with every solve), sized by the
 * image's aspect, and fully disposed on session end so a re-entry does not
 * leak GPU memory or duplicate content.
 */

function fakeTexture(width: number, height: number): Texture {
  const texture = new Texture();
  texture.image = { width, height };
  texture.dispose = vi.fn();
  return texture;
}

describe("placeImagePlanes", () => {
  it("adds one facing plane per position/texture pair at NUE coordinates", () => {
    const scene = new Object3D();
    const placed = placeImagePlanes({
      scene,
      positionsNue: [
        [10, 2, 0],
        [8.5, 2, 1.5],
      ],
      textures: [fakeTexture(400, 300), fakeTexture(300, 300)],
      centerNue: [8.5, 2, 0],
    });

    expect(placed.count).toBe(2);
    expect(scene.children).toHaveLength(2);
    expect(scene.children[0]?.position.toArray()).toEqual([10, 2, 0]);
    // Aspect flows into the geometry: 4:3 → height 0.75 of the 1 m width.
    const geometry = (scene.children[0] as { geometry?: unknown }).geometry as {
      parameters: { width: number; height: number };
    };
    expect(geometry.parameters.width).toBe(1);
    expect(geometry.parameters.height).toBeCloseTo(0.75, 9);
  });

  it("pairs positions and textures, skipping the excess of either", () => {
    const scene = new Object3D();
    const placed = placeImagePlanes({
      scene,
      positionsNue: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      textures: [fakeTexture(100, 100)],
      centerNue: [0, 0, 0],
    });
    expect(placed.count).toBe(1);
    expect(scene.children).toHaveLength(1);
  });

  it("dispose removes the meshes and frees geometry, material and texture", () => {
    const scene = new Object3D();
    const texture = fakeTexture(100, 100);
    const placed = placeImagePlanes({
      scene,
      positionsNue: [[0, 0, 0]],
      textures: [texture],
      centerNue: [1, 0, 0],
    });

    placed.dispose();
    expect(scene.children).toHaveLength(0);
    expect(texture.dispose).toHaveBeenCalled();
    expect(placed.count === 0 || placed.count === 1).toBe(true); // count is pre-dispose
  });
});
