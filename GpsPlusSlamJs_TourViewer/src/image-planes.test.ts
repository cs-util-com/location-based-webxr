import { describe, expect, it, vi } from "vitest";
import { Object3D, Texture, Vector3, type Mesh } from "three";

import { placeCapturedImagePlanes, placeImagePlanes } from "./image-planes";

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
  });

  it("faces each plane toward the ring centre and falls back to 4:3", () => {
    const scene = new Object3D();
    const noDims = new Texture();
    noDims.dispose = vi.fn();
    placeImagePlanes({
      scene,
      positionsNue: [[2, 0, 0]],
      textures: [noDims],
      centerNue: [0, 0, 0],
    });
    const mesh = scene.children[0] as unknown as {
      geometry: { parameters: { height: number } };
      getWorldDirection(v: { x: number; z: number }): { x: number; z: number };
    };
    expect(mesh.geometry.parameters.height).toBeCloseTo(0.75, 9); // 4:3
    // lookAt turns +z toward the centre: from [2,0,0] that is -x.
    const direction = mesh.getWorldDirection(new Vector3());
    expect(direction.x).toBeCloseTo(-1, 6);
    expect(direction.z).toBeCloseTo(0, 6);
  });
});

// Why these tests matter (geo-join plan Rev 2 D3): the capture variant's
// whole point is ORIENTATION — the plane must carry the capture's world
// rotation verbatim (a window back in time), not a lookAt toward anything.
// A silent fallback to ring-facing would look plausible in AR and be wrong.
describe("placeCapturedImagePlanes", () => {
  it("places one plane per pose at its position with the capture quaternion", () => {
    const scene = new Object3D();
    const texture = new Texture();
    const placed = placeCapturedImagePlanes({
      scene,
      poses: [
        {
          positionNue: [1, 2, 3],
          rotationNue: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
        },
      ],
      textures: [texture],
    });
    expect(placed.count).toBe(1);
    const mesh = scene.children[0] as Mesh;
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    expect(mesh.quaternion.y).toBeCloseTo(Math.SQRT1_2, 10);
    expect(mesh.quaternion.w).toBeCloseTo(Math.SQRT1_2, 10);
    placed.dispose();
    expect(scene.children.length).toBe(0);
  });

  it("pairs poses and textures, skipping the excess of either", () => {
    const scene = new Object3D();
    const placed = placeCapturedImagePlanes({
      scene,
      poses: [
        { positionNue: [0, 0, 0], rotationNue: [0, 0, 0, 1] },
        { positionNue: [1, 0, 0], rotationNue: [0, 0, 0, 1] },
      ],
      textures: [new Texture()],
    });
    expect(placed.count).toBe(1);
    placed.dispose();
  });
});
