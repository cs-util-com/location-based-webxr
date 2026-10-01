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

import { Matrix4, Vector3 } from "three";

import { ndcOfTargetRay, pickObject } from "./object-pick.js";

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

describe("pickObject with an angular tolerance (M4 review #4)", () => {
  // Why: a label 20 m away is 0.6 m wide - under 2 degrees - and a finger
  // tap lands a few degrees from where it aimed, so an exact ray hit made
  // far labels nearly unselectable. Within the tolerance the object
  // nearest the ray in ANGLE is taken; an exact hit still wins.
  const deg = (d: number) => (d * Math.PI) / 180;

  /** A label at `distance` m, `offDeg` degrees right of the view axis. */
  function labelAt(distance: number, offDeg: number): Group {
    return label(
      -distance * Math.cos(deg(offDeg)),
      distance * Math.sin(deg(offDeg)),
    );
  }

  it("takes a far label the ray passes just beside, within the tolerance only", () => {
    // 20 m away, its centre 2 degrees off: the sprite's half-width is
    // under 1 degree, so the exact ray misses it.
    const targets = new Map<string, Object3D>([["far", labelAt(20, 2)]]);
    expect(pickObject(camera(), targets, { toleranceDeg: 0 })).toBeNull();
    expect(pickObject(camera(), targets, { toleranceDeg: 3 })).toBe("far");
    expect(pickObject(camera(), targets, { toleranceDeg: 1 })).toBeNull();
  });

  it("prefers an exact hit, and otherwise the object nearest the ray in angle", () => {
    const exact = new Map<string, Object3D>([
      ["hit", labelAt(15, 0)],
      // Off the ray (its edge 0.07 m clear at 3 m), but under a degree
      // from it in angle - the exact hit still wins.
      ["beside", labelAt(3, 7)],
    ]);
    expect(pickObject(camera(), exact, { toleranceDeg: 6 })).toBe("hit");
    const neither = new Map<string, Object3D>([
      ["two", labelAt(10, 4)],
      ["one", labelAt(18, 2.5)],
    ]);
    expect(pickObject(camera(), neither, { toleranceDeg: 6 })).toBe("one");
  });

  it("picks at the tapped point, not the screen centre", () => {
    const targets = new Map<string, Object3D>([
      ["centre", labelAt(5, 0)],
      ["right", labelAt(5, 20)],
    ]);
    const c = camera();
    // The tapped point is where "right" projects.
    const p = new Vector3(
      5 * Math.sin(deg(20)),
      0,
      -5 * Math.cos(deg(20)),
    ).project(c);
    expect(pickObject(c, targets, { ndc: { x: p.x, y: p.y } })).toBe("right");
  });

  it("maps a tap's target ray in the camera's frame to the screen point it passes through", () => {
    const c = camera();
    // A ray from the camera turned 15 degrees to the right (about -Y).
    const ray = new Matrix4().makeRotationY(-deg(15)).toArray();
    const ndc = ndcOfTargetRay(c, ray);
    const expected = new Vector3(
      Math.sin(deg(15)),
      0,
      -Math.cos(deg(15)),
    ).project(c);
    expect(ndc?.x).toBeCloseTo(expected.x, 9);
    expect(ndc?.y).toBeCloseTo(0, 9);
    // The identity is the view axis; a ray pointing backwards or a
    // malformed matrix has no screen point.
    const axis = ndcOfTargetRay(c, new Matrix4().toArray());
    expect(axis?.x).toBeCloseTo(0, 12);
    expect(axis?.y).toBeCloseTo(0, 12);
    expect(
      ndcOfTargetRay(c, new Matrix4().makeRotationY(Math.PI).toArray()),
    ).toBeNull();
    expect(ndcOfTargetRay(c, [1, 2, 3])).toBeNull();
  });
});
