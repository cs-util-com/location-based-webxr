/**
 * Why these tests matter: selecting an object in AR (authoring plan
 * 2026-09-28-0953 §3.4, D7) is a camera-ray raycast against the objects
 * themselves. The reticle's hit point cannot stand in for it - it sits on
 * a surface, while pin labels float above theirs (cold review #11) - so
 * the pick has to hit real geometry: a label's sprite and a photo's plane,
 * nearest first, and a hit on any child must name the object it belongs
 * to. The e2e suite's scene is a stub with no geometry, so this is the
 * only place the ray is ever cast against real three.js objects.
 */
import { describe, expect, it } from "vitest";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  type Object3D,
} from "three";

import { pickObject } from "./object-pick.js";

/** A camera at the origin looking down -Z (three's default). */
function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(60, 1, 0.05, 100);
  c.updateMatrixWorld(true);
  return c;
}

/** A pin label as the preview renders one: a sprite inside a group. */
function label(z: number, x = 0): Group {
  const group = new Group();
  const sprite = new Sprite(new SpriteMaterial());
  sprite.scale.set(0.6, 0.3, 1);
  sprite.position.set(x, 0, z);
  group.add(sprite);
  group.updateMatrixWorld(true);
  return group;
}

/** A photo plane facing the camera. */
function plane(z: number): Group {
  const group = new Group();
  const mesh = new Mesh(new PlaneGeometry(1, 0.75), new MeshBasicMaterial());
  mesh.position.set(0, 0, z);
  group.add(mesh);
  group.updateMatrixWorld(true);
  return group;
}

describe("pickObject", () => {
  it("names the object a label's sprite belongs to", () => {
    const targets = new Map<string, Object3D>([["pin-1", label(-3)]]);
    expect(pickObject(camera(), targets)).toBe("pin-1");
  });

  it("names a photo whose plane is under the screen centre", () => {
    const targets = new Map<string, Object3D>([["photo-1", plane(-2)]]);
    expect(pickObject(camera(), targets)).toBe("photo-1");
  });

  it("takes the NEAREST of two objects on the ray", () => {
    const targets = new Map<string, Object3D>([
      ["far", label(-6)],
      ["near", plane(-2)],
    ]);
    expect(pickObject(camera(), targets)).toBe("near");
  });

  it("names nothing when the ray misses every object", () => {
    const targets = new Map<string, Object3D>([["aside", label(-3, 5)]]);
    expect(pickObject(camera(), targets)).toBeNull();
    expect(pickObject(camera(), new Map())).toBeNull();
  });

  it("finds an object nested deeper under its root", () => {
    const root = new Group();
    root.add(label(-3));
    root.updateMatrixWorld(true);
    expect(pickObject(camera(), new Map([["deep", root]]))).toBe("deep");
  });
});
