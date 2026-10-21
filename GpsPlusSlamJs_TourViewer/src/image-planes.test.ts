import { describe, expect, it, vi } from "vitest";
import { Object3D, Texture, type Mesh } from "three";

import { placeCapturedImagePlanes } from "./image-planes";

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

// Why these tests matter (geo-join plan Rev 2 D3): the capture variant's
// whole point is ORIENTATION — the plane must carry the capture's world
// rotation verbatim (a window back in time), not a lookAt toward anything.
// A silent fallback to any other facing would look plausible in AR and be
// wrong.
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

  it("sizes each plane by its image's aspect, and dispose frees material and texture", () => {
    const scene = new Object3D();
    const wide = fakeTexture(400, 200);
    const placed = placeCapturedImagePlanes({
      scene,
      poses: [{ positionNue: [0, 0, 0], rotationNue: [0, 0, 0, 1] }],
      textures: [wide],
    });
    const mesh = scene.children[0] as Mesh;
    expect(mesh.scale.y).toBeCloseTo(0.5, 10);
    const material = mesh.material as unknown as { dispose: () => void };
    const materialDispose = vi.spyOn(material, "dispose");
    placed.dispose();
    expect(scene.children.length).toBe(0);
    expect(wide.dispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
  });
});
