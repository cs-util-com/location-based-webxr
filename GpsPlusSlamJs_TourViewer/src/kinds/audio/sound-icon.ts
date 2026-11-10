/**
 * The editor's mark of a sound in the world: a round speaker icon that
 * always faces the camera, at the sound's centre, never drawn smaller on
 * the screen than `SOUND_ICON.minPx` (`soundIconSizeM`), and drawn over
 * the ground and buildings, as the editor's labels are - a sound has no
 * body of its own to find it by. It is what the editor picks the sound
 * by. Built from flat shapes, no canvas, so it draws (and is tested) the
 * same everywhere. The visitor never sees it.
 *
 * @see sound-icon.ts.md
 */

import {
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Object3D,
} from "three";

/** The icon's sizes. */
export const SOUND_ICON = Object.freeze({
  /** Its diameter in the world when near (m). */
  sizeM: 0.9,
  /** Its least diameter on the screen (CSS px): the common touch-target
   *  size, and large enough that its speaker reads from far off. */
  minPx: 48,
  /** The gap between the ground and its lower edge (m). */
  liftM: 0.6,
});

/** Draws after the scene's default order and the found-radius rings (20),
 *  so it never ties with a ring, and before the gizmo (21 and up), so the
 *  gizmo's disc stays on top. */
const SOUND_ICON_RENDER_ORDER = 20.5;

/**
 * The icon's diameter (m) seen `distanceM` from the camera through a lens
 * of `metresPerPxAtOneM` (how many metres one CSS px covers 1 m from the
 * camera): `SOUND_ICON.sizeM`, or more where that would show smaller than
 * `SOUND_ICON.minPx`. A distance or lens that is not a positive finite
 * number gives `sizeM`.
 */
export function soundIconSizeM(
  distanceM: number,
  metresPerPxAtOneM: number,
): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return SOUND_ICON.sizeM;
  if (!Number.isFinite(metresPerPxAtOneM) || metresPerPxAtOneM <= 0) {
    return SOUND_ICON.sizeM;
  }
  return Math.max(
    SOUND_ICON.sizeM,
    SOUND_ICON.minPx * distanceM * metresPerPxAtOneM,
  );
}

/** What the icon reads each frame. */
interface SoundIconFrame {
  readonly camera?: Camera;
  readonly metresPerPxAtOneM?: number;
}

export interface SoundIcon {
  /** The group to add to the part's object (its foot at the origin). */
  readonly object: Object3D;
  /** Faces the camera and keeps its least size on the screen; without a
   *  camera it stays as it is. Allocates nothing. */
  update(frame: SoundIconFrame): void;
  dispose(): void;
}

/** The icon's group's name, which `showSoundIcons` finds it by. */
const SOUND_ICON_NAME = "sound-icon";

/**
 * Show (true) or hide every speaker icon under `root` (the page's checks:
 * the same pixels drawn with the icon and without it).
 */
export function showSoundIcons(root: Object3D, on: boolean): void {
  root.traverse((o) => {
    if (o.name === SOUND_ICON_NAME) o.visible = on;
  });
}

const BACKGROUND = 0x1f2430;
const GLYPH = 0xffd27a;

/** The speaker: a box and its cone, facing right, in a unit circle. */
function speakerShape(): Shape {
  const s = new Shape();
  s.moveTo(-0.34, -0.11);
  s.lineTo(-0.18, -0.11);
  s.lineTo(0.0, -0.28);
  s.lineTo(0.0, 0.28);
  s.lineTo(-0.18, 0.11);
  s.lineTo(-0.34, 0.11);
  s.closePath();
  return s;
}

const camWorld = new Vector3();
const iconWorld = new Vector3();
const parentQ = new Quaternion();
const camQ = new Quaternion();

/** The icon, `SOUND_ICON.sizeM` across until its first `update`. */
export function soundIcon(): SoundIcon {
  const object = new Group();
  object.name = SOUND_ICON_NAME;
  const face = new Group();
  object.add(face);
  const geometries: BufferGeometry[] = [];
  const materials: MeshBasicMaterial[] = [];
  const add = (geometry: BufferGeometry, color: number, opacity: number) => {
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = SOUND_ICON_RENDER_ORDER;
    geometries.push(geometry);
    materials.push(material);
    face.add(mesh);
    return mesh;
  };
  // Drawn in order: the disc, its rim, the speaker and two waves.
  add(new CircleGeometry(0.5, 40), BACKGROUND, 0.92);
  add(new RingGeometry(0.44, 0.5, 40), GLYPH, 1);
  add(new ShapeGeometry(speakerShape()), GLYPH, 1);
  for (const [inner, outer] of [
    [0.1, 0.15],
    [0.2, 0.25],
  ] as const) {
    const wave = new RingGeometry(
      inner,
      outer,
      16,
      1,
      -Math.PI / 4,
      Math.PI / 2,
    );
    wave.translate(0.04, 0, 0);
    add(wave, GLYPH, 1);
  }
  const place = (sizeM: number) => {
    face.scale.setScalar(sizeM);
    face.position.set(0, SOUND_ICON.liftM + sizeM / 2, 0);
  };
  place(SOUND_ICON.sizeM);
  return {
    object,
    update(frame) {
      const camera = frame.camera;
      if (camera === undefined) return;
      camera.updateMatrixWorld();
      camera.getWorldPosition(camWorld);
      face.getWorldPosition(iconWorld);
      place(
        soundIconSizeM(
          camWorld.distanceTo(iconWorld),
          frame.metresPerPxAtOneM ?? Number.NaN,
        ),
      );
      // Facing the camera: its turn in the world, less its parent's.
      object.getWorldQuaternion(parentQ);
      camera.getWorldQuaternion(camQ);
      face.quaternion.copy(parentQ.invert().multiply(camQ));
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
