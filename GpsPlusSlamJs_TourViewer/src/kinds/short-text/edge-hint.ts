/**
 * A short text as a hint at the screen's edge: a quiet ring on the ground
 * at its spot and a small tag that names it. While the spot is in view the
 * tag stands over it; once it leaves the view the tag slides to the
 * screen's edge on the side it went, with an arrow toward it. Fully in
 * view (the whole spot, with room to spare) the tag also shows its
 * description and the distance.
 *
 * The tag is drawn in the 3D scene, a plate set in front of the camera
 * each frame at a constant size on the screen, so it needs the camera a
 * frame hands its part (`world-part.ts`); with none the tag hides and the
 * ring stays. In the editor (`edit`) the tag always stands over its spot.
 *
 * The placement on the screen is pure (`edgeHintPlace`,
 * `edgeHintFullyInView`) and tested apart from three.
 *
 * @see edge-hint.ts.md
 */

import type { TourBlockOfKind } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
  type Camera,
  type Texture,
} from "three";

import type { WorldEnv, WorldPart } from "../../world-part.js";
import {
  canvasMeasure,
  makeCanvas,
  SHORT_TEXT_ACCENT,
  SHORT_TEXT_DEFAULT_ROLE,
  wrapText,
  type Measure,
} from "./plate.js";

type TourShortTextBlock = TourBlockOfKind["shortText"];

/** The hint's look and its rules on the screen (CSS px where not m). */
export const EDGE_HINT = {
  /** The ring on the ground (m): its radius, width and opacity. */
  ringR: 0.4,
  ringW: 0.05,
  ringOpacity: 0.5,
  /** The tag's spot over the ground (m), and the footprint (m) that must
   *  be in view for its description and distance to show. */
  tagAtM: 1.9,
  footprintM: 0.9,
  /** How far in front of the camera the tag is set in play (m). */
  depthM: 1,
  /** The screen's edges the tag keeps clear of (px). */
  insetTop: 14,
  insetX: 12,
  insetBottom: 70,
  /** The gap between the tag's pointer and its spot (px). */
  above: 8,
  /** In view: in once every footprint corner is this far inside, out once
   *  one is this far outside (px). */
  fullIn: 24,
  fullOut: 8,
  /** The tag: letters, padding, the bar and the arrow chip (px). */
  fontPx: 13,
  descPx: 11.5,
  padX: 9,
  padY: 6,
  bar: 3,
  chip: 18,
  gap: 7,
  pointer: 6,
  captionMax: 200,
  edgeCaptionMax: 140,
  descMaxLines: 3,
  /** The tag's fill: quieter than a sign's plate. */
  fill: "rgba(15,18,24,0.78)",
} as const;

/** Where the spot falls on a screen of `w` x `h` px. */
export interface ScreenSpot {
  /** Its point on the screen (px from the top left). */
  readonly sx: number;
  readonly sy: number;
  /** It lies behind the camera. */
  readonly behind: boolean;
  /** Its direction in the camera's frame (x right, y up), for the edge. */
  readonly dirX: number;
  readonly dirY: number;
}

/** Where the tag goes (its top left, px), whether at the edge, and the
 *  edge arrow's angle (radians, counter-clockwise from screen right). */
export interface TagPlace {
  readonly x: number;
  readonly y: number;
  readonly edge: boolean;
  readonly angle: number;
}

/**
 * The tag of `w` x `h` px for `spot` on a `screenW` x `screenH` screen:
 * over its spot while the spot leaves room for a tag of `fitW` x `fitH`
 * (its compact size, so a tag that grows does not flip out), else on the
 * edge toward it, the arrow pointing there. A spot behind the camera
 * goes to the side it is nearer (its height counts a fifth).
 */
export function edgeHintPlace(
  spot: ScreenSpot,
  screenW: number,
  screenH: number,
  size: {
    readonly w: number;
    readonly h: number;
    readonly fitW: number;
    readonly fitH: number;
  },
): TagPlace {
  const { insetTop, insetX, insetBottom, above } = EDGE_HINT;
  const { w, h, fitW, fitH } = size;
  if (
    !spot.behind &&
    spot.sx > fitW / 2 + insetX &&
    spot.sx < screenW - fitW / 2 - insetX &&
    spot.sy > fitH + insetTop + above &&
    spot.sy < screenH - insetBottom
  ) {
    return {
      x: Math.min(Math.max(spot.sx - w / 2, insetX), screenW - insetX - w),
      y: Math.max(insetTop, spot.sy - h - above),
      edge: false,
      angle: 0,
    };
  }
  const cx = screenW / 2;
  const cy = (insetTop + screenH - insetBottom) / 2;
  let dx = spot.dirX;
  let dy = spot.dirY;
  if (spot.behind) {
    dy *= 0.2;
    if (Math.abs(dx) < 1e-3) dx = 1;
  }
  // No direction (a spot on the lens's axis): toward its screen point,
  // and right when that is the centre too.
  if (Math.hypot(dx, dy) < 1e-9) {
    dx = spot.sx - cx;
    dy = cy - spot.sy;
    if (Math.hypot(dx, dy) < 1e-9) dx = 1;
  }
  const len = Math.hypot(dx, dy);
  dx /= len;
  dy /= len;
  const hx = Math.max(0, screenW / 2 - insetX - w / 2);
  const hy = Math.max(0, (screenH - insetBottom - insetTop) / 2 - h / 2);
  const t = Math.min(
    Math.abs(dx) > 1e-6 ? hx / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 1e-6 ? hy / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );
  return {
    x: cx + dx * t - w / 2,
    y: cy - dy * t - h / 2,
    edge: true,
    angle: Math.atan2(dy, dx),
  };
}

/** Whether every corner (px on the screen, and whether in front of the
 *  camera) lies `margin` px inside the screen's usable part. */
export function edgeHintFullyInView(
  corners: readonly {
    readonly sx: number;
    readonly sy: number;
    readonly front: boolean;
  }[],
  screenW: number,
  screenH: number,
  margin: number,
): boolean {
  const { insetTop, insetX, insetBottom } = EDGE_HINT;
  return corners.every(
    (c) =>
      c.front &&
      c.sx >= insetX + margin &&
      c.sx <= screenW - insetX - margin &&
      c.sy >= insetTop + margin &&
      c.sy <= screenH - insetBottom - margin,
  );
}

/** The tag's three looks: over its spot, fully in view, at the edge. */
type TagMode = "spot" | "full" | "edge";

/** A painted tag: its size in CSS px and where its arrow chip sits. */
interface TagPicture {
  readonly canvas: HTMLCanvasElement | null;
  readonly w: number;
  readonly h: number;
  readonly chipX: number;
  readonly chipY: number;
}

/** Canvas px per CSS px. */
const SHARP = 2;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

/** `text` cut to `max` px, ending in an ellipsis where it was cut. */
function fitLine(
  text: string,
  max: number,
  width: (t: string) => number,
): string {
  if (width(text) <= max) return text;
  const chars = [...text];
  while (chars.length > 1 && width(`${chars.join("")}…`) > max) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

/** The tag of `caption` in `mode`, its description and distance shown
 *  `full`, painted (no canvas: sized only). */
function paintTag(
  caption: string,
  description: string | undefined,
  distance: string,
  accent: string,
  mode: TagMode,
  measure: Measure,
): TagPicture {
  const E = EDGE_HINT;
  const font = `600 ${String(E.fontPx)}px ${FONT}`;
  const small = `450 ${String(E.descPx)}px ${FONT}`;
  const distFont = `500 ${String(E.descPx)}px ${FONT}`;
  const cap = fitLine(
    caption,
    mode === "edge" ? E.edgeCaptionMax : E.captionMax,
    (t) => measure(font, t),
  );
  const desc =
    mode === "full" && description !== undefined && description.trim() !== ""
      ? wrapText(description, E.captionMax, (t) => measure(small, t)).slice(
          0,
          E.descMaxLines,
        )
      : [];
  const dist = mode === "full" ? distance : "";
  const capW = measure(font, cap);
  const descW = Math.max(0, ...desc.map((l) => measure(small, l)));
  const distW = dist === "" ? 0 : measure(distFont, dist) + E.gap;
  const chipW = mode === "edge" ? E.chip + E.gap : 0;
  const bodyW = Math.max(capW, descW);
  const lineH = E.fontPx * 1.25;
  const descH = desc.length * E.descPx * 1.3;
  const contentH = Math.max(mode === "edge" ? E.chip : 0, lineH + descH);
  const w = Math.ceil(
    E.padX - 2 + E.bar + E.gap + chipW + bodyW + distW + E.padX,
  );
  const bodyH = Math.ceil(E.padY * 2 + contentH);
  const pointer = mode === "edge" ? 0 : E.pointer;
  const h = bodyH + pointer;
  const chipX = E.padX - 2 + E.bar + E.gap + E.chip / 2;
  const chipY = bodyH / 2;
  const made = makeCanvas(w * SHARP, h * SHARP);
  if (made === null) return { canvas: null, w, h, chipX, chipY };
  const { canvas, g } = made;
  g.scale(SHARP, SHARP);
  g.fillStyle = E.fill;
  g.beginPath();
  g.roundRect(0.5, 0.5, w - 1, bodyH - 1, 10);
  if (pointer > 0) {
    g.moveTo(w / 2 - pointer, bodyH - 1);
    g.lineTo(w / 2, h);
    g.lineTo(w / 2 + pointer, bodyH - 1);
  }
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.08)";
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(0.5, 0.5, w - 1, bodyH - 1, 10);
  g.stroke();
  g.fillStyle = accent;
  g.beginPath();
  g.roundRect(E.padX - 2, E.padY, E.bar, bodyH - 2 * E.padY, 1.5);
  g.fill();
  const left = E.padX - 2 + E.bar + E.gap + chipW;
  const top = (bodyH - (lineH + descH)) / 2;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = font;
  g.fillStyle = "#f2efe8";
  g.fillText(cap, left, top + lineH / 2);
  g.font = small;
  g.fillStyle = "#c3c8cf";
  desc.forEach((line, i) => {
    g.fillText(line, left, top + lineH + (i + 0.5) * E.descPx * 1.3);
  });
  if (dist !== "") {
    g.font = distFont;
    g.fillText(dist, left + bodyW + E.gap, top + lineH / 2);
  }
  return { canvas, w, h, chipX, chipY };
}

/** The edge arrow's chip: an accent disc with a dark arrow pointing
 *  right (null: no canvas). */
function chipCanvas(accent: string): HTMLCanvasElement | null {
  const made = makeCanvas(64, 64);
  if (made === null) return null;
  const { canvas, g } = made;
  g.fillStyle = accent;
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#13171c";
  g.lineWidth = 7;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(17, 32);
  g.lineTo(46, 32);
  g.moveTo(35, 20);
  g.lineTo(47, 32);
  g.lineTo(35, 44);
  g.stroke();
  return canvas;
}

const v = new Vector3();
const camPos = new Vector3();
const camQ = new Quaternion();
const want = new Matrix4();
const scaleV = new Vector3();
const inv = new Matrix4();
const spin = new Quaternion();
const Z_AXIS = new Vector3(0, 0, 1);

/** Hidden, and of no size: a box round the part (the editor's) leaves
 *  it out. */
function hide(mesh: Mesh): void {
  mesh.visible = false;
  mesh.matrix.makeScale(0, 0, 0);
  mesh.matrixWorldNeedsUpdate = true;
}

/** The screen's size (px) from a camera's lens and the metres one px
 *  covers 1 m away (none: an 800 px tall screen). */
function screenOf(
  camera: Camera,
  metresPerPxAtOneM: number | undefined,
): { w: number; h: number } {
  const e = camera.projectionMatrix.elements;
  const p0 = e[0] ?? 1;
  const p5 = e[5] ?? 1;
  const h =
    metresPerPxAtOneM !== undefined && metresPerPxAtOneM > 0 && p5 !== 0
      ? 2 / (p5 * metresPerPxAtOneM)
      : 800;
  return { w: p0 === 0 ? h : (h * p5) / p0, h };
}

/** `block` as a hint at the screen's edge. */
export function edgeHintPart(
  block: TourShortTextBlock,
  env: WorldEnv,
): WorldPart {
  const accent = SHORT_TEXT_ACCENT[block.role ?? SHORT_TEXT_DEFAULT_ROLE];
  const object = new Group();
  object.name = "short-text-edge-hint";
  const ringGeometry = new RingGeometry(
    EDGE_HINT.ringR - EDGE_HINT.ringW,
    EDGE_HINT.ringR,
    48,
  );
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: EDGE_HINT.ringOpacity,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  });
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.position.y = 0.03;
  ring.renderOrder = 2;
  object.add(ring);

  const play = env.mode === "play";
  const quad = new PlaneGeometry(1, 1);
  const overlay = (
    params: ConstructorParameters<typeof MeshBasicMaterial>[0],
  ) =>
    new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: !play,
      toneMapped: false,
      ...params,
    });
  const tagMaterial = overlay({ color: 0xffffff });
  const tag = new Mesh(quad, tagMaterial);
  tag.matrixAutoUpdate = false;
  tag.frustumCulled = false;
  tag.renderOrder = 999;
  hide(tag);
  const chipPicture = chipCanvas(accent);
  const chipMap = chipPicture === null ? null : env.canvasTexture(chipPicture);
  const chipMaterial = overlay(
    chipMap === null ? { color: accent } : { map: chipMap },
  );
  const chip = new Mesh(quad, chipMaterial);
  chip.matrixAutoUpdate = false;
  chip.frustumCulled = false;
  chip.renderOrder = 1000;
  hide(chip);
  object.add(tag, chip);

  const measure = canvasMeasure();
  const painted = new Map<
    string,
    { picture: TagPicture; map: Texture | null }
  >();
  const pictureOf = (mode: TagMode, distance: string) => {
    const key = `${mode}|${mode === "full" ? distance : ""}`;
    let made = painted.get(key);
    if (made === undefined) {
      // Only the newest distance is kept: the old one is freed.
      for (const [k, old] of painted) {
        if (k.startsWith("full|") && mode === "full") {
          old.map?.dispose();
          painted.delete(k);
        }
      }
      const picture = paintTag(
        block.caption,
        block.description,
        distance,
        accent,
        mode,
        measure,
      );
      made = {
        picture,
        map: picture.canvas === null ? null : env.canvasTexture(picture.canvas),
      };
      painted.set(key, made);
    }
    return made;
  };
  const compact = pictureOf("spot", "").picture;
  let full = false;

  /** Sets `mesh` to a `wPx` x `hPx` plate centred on screen px (`cx`,
   *  `cy`), `depth` m in front of `camera`, turned by `angle`. */
  const setOnScreen = (
    mesh: Mesh,
    camera: Camera,
    screen: { w: number; h: number },
    cx: number,
    cy: number,
    wPx: number,
    hPx: number,
    depth: number,
    angle: number,
  ) => {
    const e = camera.projectionMatrix.elements;
    const p0 = e[0] ?? 1;
    const p5 = e[5] ?? 1;
    const ndcX = (cx / screen.w) * 2 - 1;
    const ndcY = 1 - (cy / screen.h) * 2;
    const metresPerPx = (2 / (p5 * screen.h)) * depth;
    // A point `depth` m along the view axis at that place on the screen.
    v.set((ndcX * depth) / p0, (ndcY * depth) / p5, -depth);
    v.applyMatrix4(camera.matrixWorld);
    camera.getWorldQuaternion(camQ);
    if (angle !== 0) {
      camQ.multiply(spin.setFromAxisAngle(Z_AXIS, angle));
    }
    scaleV.set(wPx * metresPerPx, hPx * metresPerPx, 1);
    want.compose(v, camQ, scaleV);
    inv.copy(object.matrixWorld).invert();
    mesh.matrix.multiplyMatrices(inv, want);
    mesh.matrixWorldNeedsUpdate = true;
  };

  const corners: { sx: number; sy: number; front: boolean }[] = [];
  const half = EDGE_HINT.footprintM / 2;

  return {
    object,
    update(frame) {
      const camera = frame.camera;
      if (camera === undefined) {
        hide(tag);
        hide(chip);
        return;
      }
      camera.updateMatrixWorld();
      object.updateWorldMatrix(true, false);
      const screen = screenOf(camera, frame.metresPerPxAtOneM);
      camera.getWorldPosition(camPos);
      const toScreen = (x: number, y: number, z: number) => {
        v.set(x, y, z);
        object.localToWorld(v);
        const world = v.clone();
        v.applyMatrix4(camera.matrixWorldInverse);
        const front = v.z < -0.1;
        const camX = v.x;
        const camY = v.y;
        world.project(camera);
        return {
          sx: ((world.x + 1) / 2) * screen.w,
          sy: ((1 - world.y) / 2) * screen.h,
          front,
          camX,
          camY,
          depth: -v.z,
        };
      };
      const at = toScreen(0, EDGE_HINT.tagAtM, 0);
      const spot: ScreenSpot = {
        sx: at.sx,
        sy: at.sy,
        behind: !at.front,
        dirX: at.camX,
        dirY: at.camY,
      };
      object.getWorldPosition(v);
      const distance = `${String(Math.round(Math.hypot(v.x - camPos.x, v.z - camPos.z)))} m`;
      let mode: TagMode;
      let place: TagPlace;
      if (play) {
        const first = edgeHintPlace(spot, screen.w, screen.h, {
          w: compact.w,
          h: compact.h,
          fitW: compact.w,
          fitH: compact.h,
        });
        corners.length = 0;
        for (const y of [0, EDGE_HINT.tagAtM]) {
          for (const x of [-half, half]) {
            for (const z of [-half, half]) corners.push(toScreen(x, y, z));
          }
        }
        full =
          !first.edge &&
          edgeHintFullyInView(
            corners,
            screen.w,
            screen.h,
            full ? -EDGE_HINT.fullOut : EDGE_HINT.fullIn,
          );
        mode = first.edge ? "edge" : full ? "full" : "spot";
        const shown = pictureOf(mode, distance).picture;
        place = edgeHintPlace(spot, screen.w, screen.h, {
          w: shown.w,
          h: shown.h,
          fitW: compact.w,
          fitH: compact.h,
        });
      } else {
        mode = "spot";
        place = {
          x: spot.sx - compact.w / 2,
          y: spot.sy - compact.h - EDGE_HINT.above,
          edge: false,
          angle: 0,
        };
        if (!at.front) {
          hide(tag);
          hide(chip);
          return;
        }
      }
      const { picture, map } = pictureOf(mode, distance);
      if (tagMaterial.map !== map) {
        tagMaterial.map = map;
        tagMaterial.color.set(map === null ? "#0f1218" : 0xffffff);
        tagMaterial.needsUpdate = true;
      }
      const depth = play ? EDGE_HINT.depthM : Math.max(0.2, at.depth);
      setOnScreen(
        tag,
        camera,
        screen,
        place.x + picture.w / 2,
        place.y + picture.h / 2,
        picture.w,
        picture.h,
        depth,
        0,
      );
      tag.visible = true;
      if (mode !== "edge") hide(chip);
      else {
        chip.visible = true;
        setOnScreen(
          chip,
          camera,
          screen,
          place.x + picture.chipX,
          place.y + picture.chipY,
          EDGE_HINT.chip,
          EDGE_HINT.chip,
          depth * 0.999,
          place.angle,
        );
      }
    },
    dispose() {
      ringGeometry.dispose();
      ringMaterial.dispose();
      quad.dispose();
      tagMaterial.dispose();
      chipMaterial.dispose();
      chipMap?.dispose();
      for (const { map } of painted.values()) map?.dispose();
      painted.clear();
    },
  };
}
