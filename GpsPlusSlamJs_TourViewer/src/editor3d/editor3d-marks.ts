/**
 * The 3D editor's drawn marks, browser only (each draws on a canvas):
 *
 * - a station's billboard, a tag: a dark pill with the station's
 *   number in a blue box (amber when selected) and its name, the same
 *   size on screen at any distance (`sizeAttenuation` off), drawn over
 *   the scene;
 * - a printed code's square: white with a dark frame and the code's three
 *   finder squares on its printed face (+z), plain grey on its back, so a
 *   code reads as a code and its facing is seen.
 *
 * @see editor3d-marks.ts.md
 */
import * as THREE from "three";

import { viewHeightAtOneM } from "./gizmo-maths.js";
import { truncated } from "../truncated.js";

/** The billboard's canvas (px) and its height on screen (px). */
const BILLBOARD_W = 512;
const BILLBOARD_H = 128;
const BILLBOARD_SCREEN_PX = 34;
/** The pill's rows on the canvas: transparent above and below. */
const PILL_TOP = 18;
const PILL_H = 92;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * A station's billboard sprite. Its scale is set for a viewport
 * `viewportPx` tall seen through a `fovDeg` lens, so the pill is about
 * 34 px tall on screen; `resize` sets it again for a new viewport.
 */
export function createBillboard(
  number: number,
  title: string,
  selected: boolean,
  view: { viewportPx: number; fovDeg: number },
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = BILLBOARD_W;
  canvas.height = BILLBOARD_H;
  const ctx = canvas.getContext("2d");
  let width = BILLBOARD_W;
  if (ctx !== null) {
    const pad = 14;
    ctx.font = `600 44px ${FONT}`;
    const num = String(number);
    const numW = Math.max(56, ctx.measureText(num).width + 28);
    ctx.font = `500 46px ${FONT}`;
    const name = truncated(title, 26);
    const nameW = Math.min(
      BILLBOARD_W - numW - 3 * pad,
      ctx.measureText(name).width,
    );
    width = Math.min(BILLBOARD_W, numW + nameW + 3 * pad + 8);
    const x0 = (BILLBOARD_W - width) / 2;
    ctx.fillStyle = "rgba(28, 29, 32, 0.88)";
    roundRect(ctx, x0, PILL_TOP, width, PILL_H, 14);
    ctx.fill();
    ctx.strokeStyle = selected ? "#e9a23b" : "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = selected ? "#e9a23b" : "#3d5a78";
    roundRect(ctx, x0 + pad, 32, numW, 64, 8);
    ctx.fill();
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = `600 44px ${FONT}`;
    ctx.fillStyle = selected ? "#1c1c1c" : "#e6f0fa";
    ctx.fillText(num, x0 + pad + numW / 2, 66);
    ctx.textAlign = "left";
    ctx.font = `500 46px ${FONT}`;
    ctx.fillStyle = "#e6e8ec";
    ctx.fillText(name, x0 + 2 * pad + numW, 66, nameW);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      sizeAttenuation: false,
    }),
  );
  // Anchored at its bottom middle, over its station.
  sprite.center.set(0.5, 0);
  sprite.renderOrder = selected ? 31 : 30;
  sprite.name = `billboard ${String(number)}`;
  sprite.userData["width"] = width;
  pickOnlyOnPill(sprite, width);
  resizeBillboard(sprite, view);
  return sprite;
}

/**
 * Keep a billboard's ray hits only on its drawn pill: `widthPx` of the
 * canvas's 512 wide, centred, rows 18 to 110 of its 128. The sprite is the
 * whole canvas, so without this a click on what is seen through its
 * transparent margin would select the station.
 */
export function pickOnlyOnPill(sprite: THREE.Sprite, widthPx: number): void {
  const halfU = Math.min(BILLBOARD_W, Math.max(0, widthPx)) / BILLBOARD_W / 2;
  // The canvas is uploaded flipped (uv y 0 at its bottom row); the pill's
  // rows are the same distance from either edge.
  const v0 = PILL_TOP / BILLBOARD_H;
  const v1 = (PILL_TOP + PILL_H) / BILLBOARD_H;
  sprite.raycast = (raycaster, hits) => {
    const start = hits.length;
    THREE.Sprite.prototype.raycast.call(sprite, raycaster, hits);
    for (let i = hits.length - 1; i >= start; i--) {
      const uv = hits[i]!.uv;
      const onPill =
        uv !== undefined &&
        Math.abs(uv.x - 0.5) <= halfU &&
        uv.y >= v0 &&
        uv.y <= v1;
      if (!onPill) hits.splice(i, 1);
    }
  };
}

/** Keep `sprite` about 34 px tall on a viewport `viewportPx` tall. */
export function resizeBillboard(
  sprite: THREE.Sprite,
  view: { viewportPx: number; fovDeg: number },
): void {
  // With sizeAttenuation off a sprite's scale is its size at 1 m: the view
  // at 1 m is 2 tan(fov / 2) tall.
  const atOneM = viewHeightAtOneM(view.fovDeg);
  const h = (BILLBOARD_SCREEN_PX / Math.max(1, view.viewportPx)) * atOneM;
  sprite.scale.set((h * BILLBOARD_W) / BILLBOARD_H, h, 1);
}

/**
 * A code's printed face, for every square of one 3D view: the view owns it
 * and disposes it with itself. (Never module-wide: a texture outlives its
 * renderer's disposal by holding the renderer through its dispose
 * listener, and with it a WebGL context per view.)
 */
export function createCodeFace(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#1f2328";
    const finder = (x: number, y: number) => {
      ctx.fillRect(x, y, 36, 36);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 6, y + 6, 24, 24);
      ctx.fillStyle = "#1f2328";
      ctx.fillRect(x + 12, y + 12, 12, 12);
    };
    finder(10, 10);
    finder(82, 10);
    finder(10, 82);
    ctx.fillRect(56, 56, 16, 16);
    ctx.fillRect(84, 84, 10, 10);
    ctx.fillRect(104, 92, 10, 10);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A printed code's square, `sizeM` on a side, its face +z, drawn with
 *  `faceTexture` (`createCodeFace`), which is shared: freeing a square leaves it. */
export function createCodeSquare(
  sizeM: number,
  faceTexture: THREE.Texture,
): THREE.Object3D {
  const square = new THREE.Group();
  square.name = "code";
  const plane = new THREE.PlaneGeometry(sizeM, sizeM);
  const face = new THREE.Mesh(
    plane,
    new THREE.MeshBasicMaterial({ map: faceTexture }),
  );
  face.position.z = 0.004;
  const back = new THREE.Mesh(
    plane.clone(),
    new THREE.MeshLambertMaterial({ color: 0x8b8e93 }),
  );
  back.rotation.y = Math.PI;
  back.position.z = -0.004;
  // The shared face must outlive the square (`freeObject` frees maps).
  face.userData["sharedMap"] = true;
  square.add(face, back);
  return square;
}
