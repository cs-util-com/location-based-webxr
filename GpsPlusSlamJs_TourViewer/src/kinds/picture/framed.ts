/**
 * A framed print's look (`framed` view): a dark bevelled frame, a cream
 * mat, the print, and under it a plate with the year, three lines of the
 * caption and the credit. Built from the chosen picture prototype's
 * numbers at its 1.6 m print, then scaled as one object to the block's
 * width, so a print of any width is the prototype's print made larger or
 * smaller (the prototype instead kept its mat, frame and plate text at
 * fixed sizes outside about 0.9 to 3.5 m).
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
  Shape,
  type Texture,
} from "three";

import { canvasTexture } from "../../world-part.js";
import type { PicturePainters, PlateWords } from "./picture-paint.js";

/** The print width the look is drawn at before it is scaled (m): the
 *  prototype's own, so the look matches it there exactly. */
export const PICTURE_REFERENCE_WIDTH_M = 1.6;

/** The gap between the frame's foot and the plate (m, at the reference
 *  width). */
const PLATE_GAP_M = 0.05;

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
    new MeshBasicMaterial({ map: picture, toneMapped: false }),
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
  return { root, tapTarget };
}
