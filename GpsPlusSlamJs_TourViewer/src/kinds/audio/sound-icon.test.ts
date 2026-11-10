/**
 * Why these tests matter: in the editor a sound has no body to find it by
 * - an ambient sound's glow is faint and often under the relief - so its
 * speaker icon is how a creator sees and selects it. An icon that shrinks
 * to a dot from a high camera, or turns edge-on, hides the sound again.
 * These pin its least size on the screen across the camera distances an
 * editor uses (5 m to 300 m), that it faces the camera through a turned
 * parent, and that it draws over the ground.
 */
import {
  Group,
  Mesh,
  type MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import {
  SOUND_ICON,
  showSoundIcons,
  soundIcon,
  soundIconSizeM,
} from "./sound-icon.js";

/** Metres per CSS px at 1 m through a vertical lens of `fovDeg` over a
 *  view `heightPx` tall. */
const lens = (fovDeg: number, heightPx: number) =>
  (2 * Math.tan((fovDeg * Math.PI) / 360)) / heightPx;

describe("the speaker icon's size", () => {
  it("is never under its least size on the screen from 5 m to 300 m, and its world size when near", () => {
    // Swept: a phone held upright (844 px) and a short desktop view
    // (600 px), at the editor's 50 degree lens and a wider 70 degrees.
    for (const fovDeg of [50, 70]) {
      for (const heightPx of [600, 844]) {
        const perPx = lens(fovDeg, heightPx);
        for (const distanceM of [5, 10, 20, 40, 80, 150, 300]) {
          const sizeM = soundIconSizeM(distanceM, perPx);
          const onScreenPx = sizeM / (distanceM * perPx);
          expect(onScreenPx).toBeGreaterThanOrEqual(SOUND_ICON.minPx - 1e-9);
          expect(sizeM).toBeGreaterThanOrEqual(SOUND_ICON.sizeM);
        }
        // Its floor is the common 48 px touch-target size.
        expect(SOUND_ICON.minPx).toBeGreaterThanOrEqual(48);
        // Near enough, its world size shows larger than the floor.
        expect(soundIconSizeM(5, perPx)).toBe(SOUND_ICON.sizeM);
      }
    }
  });

  it("falls back to its world size for a distance or lens it cannot use", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(soundIconSizeM(bad, 0.001)).toBe(SOUND_ICON.sizeM);
      expect(soundIconSizeM(50, bad)).toBe(SOUND_ICON.sizeM);
    }
  });
});

describe("the speaker icon", () => {
  it("faces the camera through a turned parent and keeps its least size", () => {
    const parent = new Group();
    parent.rotation.set(0, 1.1, 0);
    parent.position.set(3, 0, -2);
    const icon = soundIcon();
    parent.add(icon.object);
    const camera = new PerspectiveCamera(50, 1, 0.1, 5000);
    camera.position.set(80, 60, 40);
    camera.lookAt(3, 0, -2);
    const perPx = lens(50, 844);
    icon.update({ camera, metresPerPxAtOneM: perPx });
    // Again: the first update placed it from its starting size.
    icon.update({ camera, metresPerPxAtOneM: perPx });
    const face = icon.object.children[0];
    if (face === undefined) throw new Error("no face");
    parent.updateMatrixWorld(true);
    const faceQ = face.getWorldQuaternion(new Quaternion());
    expect(faceQ.angleTo(camera.quaternion)).toBeLessThan(1e-6);
    const centre = face.getWorldPosition(new Vector3());
    const expected = soundIconSizeM(camera.position.distanceTo(centre), perPx);
    // Sized from where its middle stood a frame before: within a centimetre.
    expect(face.scale.x).toBeCloseTo(expected, 2);
    // Its lower edge stays the lift over the foot.
    expect(face.position.y - face.scale.y / 2).toBeCloseTo(SOUND_ICON.liftM, 9);
    icon.dispose();
  });

  it("stands still without a camera, and draws over the ground between the rings and the gizmo", () => {
    const icon = soundIcon();
    icon.update({});
    const face = icon.object.children[0];
    expect(face?.scale.x).toBe(SOUND_ICON.sizeM);
    let meshes = 0;
    icon.object.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      meshes++;
      const material = o.material as MeshBasicMaterial;
      expect(material.depthTest).toBe(false);
      // After the found-radius rings (20), never tied with them; before the
      // gizmo's disc (21), so the gizmo stays on top.
      expect(o.renderOrder).toBeGreaterThan(20);
      expect(o.renderOrder).toBeLessThan(21);
    });
    expect(meshes).toBeGreaterThan(0);
    icon.dispose();
  });
});

// Why: the e2e proves the icon is seen over the relief by drawing the same
// pixels with it and without it; this holds that the switch reaches every
// icon under a root, at any depth, and touches nothing else.
describe("showSoundIcons", () => {
  it("hides and shows every icon under a root and leaves the rest alone", () => {
    const root = new Group();
    const other = new Group();
    const nested = new Group();
    const a = soundIcon();
    const b = soundIcon();
    root.add(a.object, nested, other);
    nested.add(b.object);
    showSoundIcons(root, false);
    expect(a.object.visible).toBe(false);
    expect(b.object.visible).toBe(false);
    expect(other.visible).toBe(true);
    expect(nested.visible).toBe(true);
    showSoundIcons(root, true);
    expect(a.object.visible).toBe(true);
    expect(b.object.visible).toBe(true);
    a.dispose();
    b.dispose();
  });
});
