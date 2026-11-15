/**
 * A framed print's look (`framed` view): a dark bevelled frame, a cream
 * mat, the print, and under it a plate with the year, three lines of the
 * caption and the credit. Built from the chosen picture prototype's
 * numbers at its 1.6 m print, then scaled as one object to the block's
 * width, so a print of any width is the prototype's print made larger or
 * smaller (the prototype instead kept its mat, frame and plate text at
 * fixed sizes outside about 0.9 to 3.5 m).
 *
 * A soft shadow lies on the ground under it (`floor`, held level by
 * `level` and laid on the ground by `ground`), and in play it
 * arrives as the prototype's does (`arrive`): it rises out of the ground
 * and its picture comes out of the paper.
 *
 * Its origin is the print's centre; it faces local +Z.
 *
 * @see framed.ts.md
 */

import {
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  type Texture,
} from "three";

import { uprightTurn } from "../../content-placement.js";
import { smoothstep } from "../../smoothstep.js";
import { canvasTexture } from "../../world-part.js";
import type { PicturePainters, PlateWords } from "./picture-paint.js";

/** The print width the look is drawn at before it is scaled (m): the
 *  prototype's own, so the look matches it there exactly. */
export const PICTURE_REFERENCE_WIDTH_M = 1.6;

/** The gap between the frame's foot and the plate (m, at the reference
 *  width). */
const PLATE_GAP_M = 0.05;

/** How long the arrival takes (s): the prototype's appear, 0 to 1 at
 *  `dt / 1.6`. */
export const FRAMED_ARRIVAL_S = 1.6;

/** How far below its place the print starts (m, at the reference width,
 *  so it scales with the print like the rest of the look). */
export const FRAMED_RISE_M = 0.12;

/** The ground shadow's opacity and its height over the ground (m, in the
 *  station's metres): the prototype's `shadowDecal(ow * 1.2, 0.9, 0.2)`. */
export const FRAMED_SHADOW_OPACITY = 0.2;
export const FRAMED_SHADOW_LIFT_M = 0.012;

/** The shadow's width over the frame's and its depth (m, at the reference
 *  width). */
const SHADOW_WIDTH_SHARE = 1.2;
const SHADOW_DEPTH_M = 0.9;

/** Where the print stands at arrival `a` (0..1) against its place (m, at
 *  the reference width): `-FRAMED_RISE_M` at 0, risen by 0.7. Not a
 *  number: risen. */
export function framedRise(a: number): number {
  if (Number.isNaN(a)) return 0;
  return -FRAMED_RISE_M * (1 - smoothstep(0, 0.7, a));
}

/** How far the picture has come out of the paper at arrival `a`
 *  (0..1): from 0.3 on, whole at 1. Not a number: whole. */
export function framedDevelop(a: number): number {
  if (Number.isNaN(a)) return 1;
  return smoothstep(0.3, 1, a);
}

/** The prototype's develop: the paper's colour, giving way to the
 *  picture's darks first and its lights last. Runs after three's
 *  `map_fragment`, on the linear colour, as the prototype's did. */
const DEVELOP_GLSL = `
{
  float developLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  float developed = clamp(uDevelop * 1.7 - developLum * 0.7, 0.0, 1.0);
  diffuseColor.rgb = mix(vec3(0.84, 0.77, 0.62), diffuseColor.rgb, smoothstep(0.0, 1.0, developed));
}`;

/** The print's material: the picture as painted, with the develop wired
 *  into three's basic shader through `develop` (one uniform object, so a
 *  write needs no recompile). */
function developingPrint(
  picture: Texture,
  develop: { value: number },
): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ map: picture, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uDevelop"] = develop;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uDevelop;",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>${DEVELOP_GLSL}`,
      );
  };
  material.customProgramCacheKey = () => "picture-framed-develop";
  return material;
}

/** The sizes of a framed print `widthM` wide whose picture is `aspect`
 *  (height over width) tall (m). */
function framedSizes(widthM: number, aspect: number) {
  const w = widthM;
  const h = widthM * aspect;
  const mat = Math.max(0.05, w * 0.07);
  const frame = Math.min(0.12, Math.max(0.03, w * 0.034));
  const innerW = w + 2 * mat;
  const innerH = h + 2 * mat;
  return {
    w,
    h,
    mat,
    frame,
    innerW,
    innerH,
    outerW: innerW + 2 * frame,
    outerH: innerH + 2 * frame,
  };
}

/** A framed print's built look. */
export interface FramedLook {
  /** At the reference width; the caller scales it. */
  readonly root: Group;
  /** What a tap is cast against: the frame, the print and the plate. */
  readonly tapTarget: Group;
  /** The ground shadow, apart from `root` so that no bounds of the tap
   *  target reach the ground: the caller hangs it beside the root, at its
   *  place and with its scale. */
  readonly floor: Group;
  /** Lays the shadow `liftM` (in the floor's parent's metres) below the
   *  print's centre, where the ground is. Not a finite number: it stays. */
  ground(liftM: number): void;
  /** Keeps the shadow level under a part turned by `partRotation` (its
   *  rotation in an upright parent): only the turn about the vertical is
   *  kept, a pitch or a roll is undone. Worked out only when the rotation
   *  changes. */
  level(partRotation: Quaternion): void;
  /** Shows arrival `a` (0..1): `framedRise` and `framedDevelop`. A
   *  new look stands arrived (1). */
  arrive(a: number): void;
}

/** A material showing `map` as painted (no light, no tone mapping). */
function painted(map: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({ map, transparent: true, toneMapped: false });
}

/** The look of a print showing `picture` (its image's size gives the
 *  aspect), with `words` on its plate. */
export function buildFramedLook(
  picture: Texture,
  aspect: number,
  words: PlateWords,
  painters: PicturePainters,
): FramedLook {
  const s = framedSizes(PICTURE_REFERENCE_WIDTH_M, aspect);
  const develop = { value: 1 };
  const root = new Group();
  root.name = "picture-framed";
  const tapTarget = new Group();
  root.add(tapTarget);

  const outline = new Shape();
  outline.moveTo(-s.outerW / 2, -s.outerH / 2);
  outline.lineTo(s.outerW / 2, -s.outerH / 2);
  outline.lineTo(s.outerW / 2, s.outerH / 2);
  outline.lineTo(-s.outerW / 2, s.outerH / 2);
  outline.closePath();
  const hole = new Path();
  hole.moveTo(-s.innerW / 2, -s.innerH / 2);
  hole.lineTo(-s.innerW / 2, s.innerH / 2);
  hole.lineTo(s.innerW / 2, s.innerH / 2);
  hole.lineTo(s.innerW / 2, -s.innerH / 2);
  hole.closePath();
  outline.holes.push(hole);
  const frame = new Mesh(
    new ExtrudeGeometry(outline, {
      depth: 0.028,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.011,
      bevelSegments: 3,
      curveSegments: 1,
    }),
    new MeshStandardMaterial({
      color: 0x2b2018,
      roughness: 0.45,
      metalness: 0.05,
    }),
  );
  frame.name = "picture-frame";
  const back = new Mesh(
    new BoxGeometry(s.outerW, s.outerH, 0.014),
    new MeshStandardMaterial({ color: 0x15110d, roughness: 0.8 }),
  );
  back.name = "picture-back";
  back.position.z = -0.02;
  const mat = new Mesh(
    new PlaneGeometry(s.innerW, s.innerH),
    painted(canvasTexture(painters.mat(s.innerW, s.innerH, s.w, s.h))),
  );
  mat.name = "picture-mat";
  mat.position.z = 0.004;
  const print = new Mesh(
    new PlaneGeometry(s.w, s.h),
    developingPrint(picture, develop),
  );
  print.name = "picture-print";
  print.position.z = 0.007;
  const plateArt = painters.plate(words, s.outerW);
  const plate = new Mesh(
    new PlaneGeometry(plateArt.widthM, plateArt.heightM),
    painted(canvasTexture(plateArt.image)),
  );
  plate.name = "picture-plate";
  plate.position.y = -s.outerH / 2 - PLATE_GAP_M - plateArt.heightM / 2;
  tapTarget.add(frame, back, mat, print, plate);

  // Out of the root and its tap target: the ground under the print takes
  // no tap and stretches no bounds.
  const floor = new Group();
  floor.name = "picture-framed-floor";
  const shadow = new Mesh(
    new PlaneGeometry(s.outerW * SHADOW_WIDTH_SHARE, SHADOW_DEPTH_M),
    new MeshBasicMaterial({
      map: canvasTexture(painters.shadow()),
      color: 0x000000,
      transparent: true,
      opacity: FRAMED_SHADOW_OPACITY,
      depthWrite: false,
    }),
  );
  shadow.name = "picture-framed-shadow";
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  shadow.raycast = () => undefined;
  floor.add(shadow);
  // The rotation last levelled for: NaN until the first.
  const levelledFor = new Quaternion(Number.NaN, 0, 0, 0);
  const undo = new Quaternion();

  return {
    root,
    tapTarget,
    floor,
    ground(liftM) {
      const scale = floor.scale.y;
      if (!Number.isFinite(liftM) || !(scale > 0)) return;
      shadow.position.y = (FRAMED_SHADOW_LIFT_M - liftM) / scale;
    },
    level(partRotation) {
      if (levelledFor.equals(partRotation)) return;
      levelledFor.copy(partRotation);
      const q = partRotation;
      undo.copy(q).invert();
      uprightTurn([q.x, q.y, q.z, q.w], floor.quaternion).premultiply(undo);
    },
    arrive(a) {
      tapTarget.position.y = framedRise(a);
      develop.value = framedDevelop(a);
    },
  };
}
