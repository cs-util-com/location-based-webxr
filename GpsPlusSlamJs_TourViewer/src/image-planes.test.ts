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

  it("draws each plane its pose's width wide (1 m when it names none), the aspect kept", () => {
    // Why this matters: a picture's width in the file is its real size in
    // the world. Every plane used to be 1 m wide whatever the file said,
    // which captured photos (all 1 m) hid. Swept over widths from a
    // thumbnail to a billboard so no one value hides a fixed size.
    for (const widthM of [0.05, 1, 3, 12.5, 100]) {
      const scene = new Object3D();
      const placed = placeCapturedImagePlanes({
        scene,
        poses: [
          { positionNue: [0, 0, 0], rotationNue: [0, 0, 0, 1], widthM },
          { positionNue: [0, 0, 0], rotationNue: [0, 0, 0, 1] },
        ],
        textures: [fakeTexture(400, 200), fakeTexture(400, 200)],
      });
      const [sized, plain] = scene.children as Mesh[];
      expect(sized!.scale.x).toBeCloseTo(widthM, 10);
      expect(sized!.scale.y).toBeCloseTo(widthM / 2, 10);
      expect(plain!.scale.toArray()).toEqual([1, 0.5, 1]);
      placed.dispose();
    }
  });
});
