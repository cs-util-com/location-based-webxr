/**
 * A cut-out's look (`cutout` view): the picture standing on the ground
 * at its foot, with a soft contact shadow and, unless its creator turned it
 * off (`showTag: false`), a small tag on a stake in front (its year and
 * title). Seen edge-on it fades out, and from behind it shows as a dark
 * silhouette, so it never turns into a sliver. A picture without
 * see-through parts shows as its rectangle (the reader cannot check; the
 * editor warns on pick).
 *
 * Built at the prototype's 1.6 m width and scaled as one object by the
 * caller, as the framed print is (`framed.ts`). Its origin is its foot on
 * the ground; it faces local +Z.
 *
 * @see cutout.ts.md
 */

import { smoothstep } from "../../smoothstep.js";
import {
  BackSide,
  CylinderGeometry,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type Object3D,
  type Texture,
} from "three";

import { canvasTexture } from "../../world-part.js";
import { PICTURE_REFERENCE_WIDTH_M } from "./framed.js";
import {
  TAG_HEIGHT_M,
  TAG_WIDTH_M,
  type PicturePainters,
  type TagWords,
} from "./picture-paint.js";

/** The silhouette's opacity seen from behind. */
export const CUTOUT_BACK_OPACITY = 0.6;

/**
 * How much of a cut-out shows when seen from `toViewer` (level, from its
 * foot) while it faces `facing` (both level unit vectors): 0 edge-on (the
 * two at right angles, within about 6 degrees), 1 from 24 degrees off its
 * plane on, front or back alike.
 */
export function cutoutFacingFade(facing: Vector3, toViewer: Vector3): number {
  return smoothstep(0.1, 0.4, Math.abs(facing.dot(toViewer)));
}

/** A cut-out's built look. */
export interface CutoutLook {
  /** At the reference width; the caller scales it. */
  readonly root: Group;
  /** What a tap is cast against: the cut-out and its tag. */
  readonly tapTarget: Group;
  /** Fades it for a viewer at `viewer` in the parent frame of `placed`
   *  (the object the renderer placed and turned). */
  face(placed: Object3D, viewer: readonly [number, number, number]): void;
}

/** A cut-out showing `picture` (`aspect` its height over width). */
export function buildCutoutLook(
  picture: Texture,
  aspect: number,
  tag: TagWords | null,
  painters: PicturePainters,
): CutoutLook {
  const w = PICTURE_REFERENCE_WIDTH_M;
  const h = w * aspect;
  const root = new Group();
  root.name = "picture-cutout";
  const tapTarget = new Group();
  root.add(tapTarget);
  const shape = new PlaneGeometry(w, h);
  shape.translate(0, h / 2, 0);
  const frontMat = new MeshBasicMaterial({
    map: picture,
    transparent: true,
    alphaTest: 0.02,
    side: FrontSide,
    toneMapped: false,
  });
  const backMat = new MeshBasicMaterial({
    map: picture,
    color: 0x000000,
    transparent: true,
    opacity: CUTOUT_BACK_OPACITY,
    alphaTest: 0.02,
    side: BackSide,
    toneMapped: false,
  });
  const front = new Mesh(shape, frontMat);
  front.name = "picture-cutout-front";
  const back = new Mesh(shape, backMat);
  back.name = "picture-cutout-back";
  tapTarget.add(front, back);

  const shadow = new Mesh(
    new PlaneGeometry(w * 1.05, 1.35),
    new MeshBasicMaterial({
      map: canvasTexture(painters.shadow()),
      color: 0x000000,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  );
  shadow.name = "picture-cutout-shadow";
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.012, -0.3);
  shadow.raycast = () => undefined;
  root.add(shadow);

  if (tag !== null) {
    const stand = new Group();
    stand.name = "picture-cutout-tag";
    stand.position.set(-w * 0.5 * 0.55, 0, 0.75);
    const card = new Mesh(
      new PlaneGeometry(TAG_WIDTH_M, TAG_HEIGHT_M),
      new MeshBasicMaterial({
        map: canvasTexture(painters.tag(tag)),
        transparent: true,
        toneMapped: false,
      }),
    );
    card.position.y = 0.62;
    card.rotation.x = -0.6;
    const stake = new Mesh(
      new CylinderGeometry(0.012, 0.016, 0.6, 8),
      new MeshStandardMaterial({ color: 0x1d1915, roughness: 0.6 }),
    );
    stake.position.y = 0.3;
    stand.add(card, stake);
    tapTarget.add(stand);
  }

  const facing = new Vector3();
  const toViewer = new Vector3();
  return {
    root,
    tapTarget,
    face(placed, viewer) {
      facing.set(0, 0, 1).applyQuaternion(placed.quaternion);
      facing.y = 0;
      toViewer.set(
        viewer[0] - placed.position.x,
        0,
        viewer[2] - placed.position.z,
      );
      if (facing.lengthSq() < 1e-12 || toViewer.lengthSq() < 1e-12) return;
      facing.normalize();
      toViewer.normalize();
      const fade = cutoutFacingFade(facing, toViewer);
      frontMat.opacity = fade;
      backMat.opacity = CUTOUT_BACK_OPACITY * fade;
    },
  };
}
