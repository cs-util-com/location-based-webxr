/**
 * The flat target capture mode's pure parts: surface classes, poses, light
 * bins, the four corner taps and the homography that rectifies the
 * reference, the guide frame, and the names and JSON of the exported files.
 *
 * @see flat-target.ts.md
 */
import { LIGHT_FLOOR_A } from "./bench-export";
import type { Frame } from "./bench-image";

/** A point in image pixels, pixel centres at integers, x right, y down. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A width and height in pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** An axis-aligned rectangle in pixels. */
export interface Rect extends Size {
  readonly x: number;
  readonly y: number;
}

/** The texture classes a surface is sorted into. */
export const SURFACE_CLASSES = [
  { id: "busy", label: "busy picture" },
  { id: "text", label: "text-heavy" },
  { id: "low", label: "low-texture" },
] as const;

export type SurfaceClass = (typeof SURFACE_CLASSES)[number]["id"];

/** How wide the surface appears, as a share of the frame width in %. */
export const DISTANCES = [40, 20, 12] as const;
/** The phone's tilt against the surface's normal, in degrees. */
const TILTS = [0, 40] as const;

export type Distance = (typeof DISTANCES)[number];
export type Tilt = (typeof TILTS)[number];
export type PoseId = `w${Distance}-t${Tilt}`;

export const poseId = (distance: Distance, tilt: Tilt): PoseId =>
  `w${String(distance)}-t${String(tilt)}` as PoseId;

/** The six poses, nearest first, each straight on before tilted. */
export const POSES: readonly {
  readonly id: PoseId;
  readonly distance: Distance;
  readonly tilt: Tilt;
  readonly label: string;
}[] = DISTANCES.flatMap((distance) =>
  TILTS.map((tilt) => ({
    id: poseId(distance, tilt),
    distance,
    tilt,
    label: `${String(distance)} % wide, ${String(tilt)} deg`,
  })),
);

/** The light bins, brightest first; `min` is the bin's inclusive lower bound. */
export const LIGHT_BINS = [
  { id: "b1", label: ">= 0.85", min: 0.85 },
  { id: "b2", label: "0.6-0.85", min: 0.6 },
  { id: "b3", label: "0.35-0.6", min: 0.35 },
  { id: "b4", label: "< 0.35", min: 0 },
] as const;

export type BinId = (typeof LIGHT_BINS)[number]["id"];

/**
 * The bin of a luma ratio: each bound belongs to the brighter bin, and a
 * ratio above 1 (auto exposure brightening a dimmer scene) is the
 * brightest.
 *
 * @throws RangeError for a negative or non-finite ratio.
 */
export function lightBin(ratio: number): BinId {
  if (!Number.isFinite(ratio) || ratio < 0) {
    throw new RangeError(`luma ratio must be 0 or more, got ${String(ratio)}`);
  }
  return LIGHT_BINS.find((b) => ratio >= b.min)!.id;
}

/**
 * A photo's grey mean against its pose's full-light shot (both 0..255,
 * from `greyStats`).
 *
 * @throws RangeError for a mean outside 0..255; Error when the full-light
 *   mean is below LIGHT_FLOOR_A (too dark to compare against).
 */
export function lumaRatio(mean: number, fullMean: number): number {
  for (const m of [mean, fullMean]) {
    if (!Number.isFinite(m) || m < 0 || m > 255) {
      throw new RangeError(`grey mean must be 0 to 255, got ${String(m)}`);
    }
  }
  if (fullMean < LIGHT_FLOOR_A) {
    throw new Error(
      `the full-light shot is too dark to compare against (grey mean ${fullMean.toFixed(1)})`,
    );
  }
  return mean / fullMean;
}

/** The corners in the order they are tapped. */
export const CORNERS = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
] as const;

export type CornerName = (typeof CORNERS)[number];

/** The corner to tap next, or null once all four are tapped. */
export const nextCorner = (taps: readonly Point[]): CornerName | null =>
  CORNERS[taps.length] ?? null;

/**
 * Why four taps cannot rectify the surface, or null when they can: four
 * taps, clockwise on screen from the top-left (a convex quadrilateral),
 * covering at least 1 % of the photo.
 */
export function cornersProblem(
  c: readonly Point[],
  width: number,
  height: number,
): string | null {
  if (c.length !== 4) {
    return `tap all 4 corners (${String(c.length)} tapped)`;
  }
  for (let i = 0; i < 4; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    const d = c[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (cross <= 0) {
      return "the corners are not in order: tap top-left, top-right, bottom-right, bottom-left";
    }
  }
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    area += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area) / 2 < 0.01 * width * height) {
    return "the surface is too small in the photo: come closer and take the reference again";
  }
  return null;
}

/** A 3 x 3 homography, row-major, h[8] = 1. */
export type Homography = readonly number[];

/**
 * The homography mapping each `src[i]` onto `dst[i]` (four points each),
 * from the 8 x 8 linear system with h33 = 1.
 *
 * @throws Error "degenerate" when three points lie on a line.
 */
export function homographyFromCorners(
  src: readonly Point[],
  dst: readonly Point[],
): Homography {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error("a homography needs 4 point pairs");
  }
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const scale = Math.max(1, ...a.flat().map(Math.abs));
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) {
        pivot = r;
      }
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12 * scale) {
      throw new Error("degenerate corners: three of them lie on a line");
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const row = a[col]!;
    for (let r = 0; r < 8; r++) {
      if (r === col) {
        continue;
      }
      const f = a[r]![col]! / row[col]!;
      for (let k = col; k < 9; k++) {
        a[r]![k]! -= f * row[k]!;
      }
    }
  }
  return [...a.map((row, i) => row[8]! / row[i]!), 1];
}

/** `m` applied to (x, y). */
export function applyHomography(m: Homography, x: number, y: number): Point {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return {
    x: (m[0]! * x + m[1]! * y + m[2]!) / w,
    y: (m[3]! * x + m[4]! * y + m[5]!) / w,
  };
}

const dist = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * The rectified reference's size: the longer of each pair of opposite
 * edges (so a slightly tilted reference is not shrunk), scaled down so
 * the long side is at most `maxLongEdge`.
 */
export function rectifiedSize(c: readonly Point[], maxLongEdge: number): Size {
  const [tl, tr, br, bl] = c as [Point, Point, Point, Point];
  const w = Math.max(dist(tl, tr), dist(bl, br));
  const h = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, maxLongEdge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * s)),
    height: Math.max(1, Math.round(h * s)),
  };
}

/**
 * The surface inside the four corners warped to a fronto-parallel image
 * of `size`, sampled bilinearly; the corners land on the output's corner
 * pixel centres. Outside the photo reads black.
 */
export function rectify(frame: Frame, c: readonly Point[], size: Size): Frame {
  const { width: w, height: h } = size;
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: w - 1, y: 0 },
    { x: w - 1, y: h - 1 },
    { x: 0, y: h - 1 },
  ];
  const m = homographyFromCorners(dst, c);
  const out = new Uint8ClampedArray(w * h * 4);
  const { width: sw, height: sh, rgba: s } = frame;
  const at = (x: number, y: number, ch: number): number =>
    x < 0 || y < 0 || x >= sw || y >= sh ? 0 : s[(y * sw + x) * 4 + ch]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = applyHomography(m, x, y);
      // Snap float noise so an exact pixel centre samples that pixel only.
      const fx = Math.abs(p.x - Math.round(p.x)) < 1e-6 ? Math.round(p.x) : p.x;
      const fy = Math.abs(p.y - Math.round(p.y)) < 1e-6 ? Math.round(p.y) : p.y;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const o = (y * w + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const top = at(x0, y0, ch) * (1 - tx) + at(x0 + 1, y0, ch) * tx;
        const bottom =
          at(x0, y0 + 1, ch) * (1 - tx) + at(x0 + 1, y0 + 1, ch) * tx;
        out[o + ch] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return { width: w, height: h, rgba: out };
}

/**
 * The guide frame for a pose: centred, `widthPercent` of the frame width
 * wide, with the reference's aspect (width / height), shrunk to fit the
 * frame height.
 */
export function guideRect(
  frameWidth: number,
  frameHeight: number,
  widthPercent: number,
  aspect: number,
): Rect {
  let width = (frameWidth * widthPercent) / 100;
  let height = width / aspect;
  if (height > frameHeight) {
    height = frameHeight;
    width = height * aspect;
  }
  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height,
  };
}

/**
 * A tap at client (x, y) on a picture shown with `object-fit: contain` in
 * `box`, in the picture's pixels; null on the bars beside the picture.
 */
export function toImagePoint(
  clientX: number,
  clientY: number,
  box: { readonly left: number; readonly top: number } & Size,
  imageWidth: number,
  imageHeight: number,
): Point | null {
  const scale = Math.min(box.width / imageWidth, box.height / imageHeight);
  const left = box.left + (box.width - imageWidth * scale) / 2;
  const top = box.top + (box.height - imageHeight * scale) / 2;
  const x = (clientX - left) / scale;
  const y = (clientY - top) / scale;
  if (x < 0 || y < 0 || x > imageWidth || y > imageHeight) {
    return null;
  }
  return { x: Math.min(x, imageWidth - 1), y: Math.min(y, imageHeight - 1) };
}

/**
 * The part of `frame` inside `rect`, clamped to the frame.
 *
 * @throws RangeError when nothing of the rectangle is inside the frame.
 */
export function cropFrame(frame: Frame, rect: Rect): Frame {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(frame.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(frame.height, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) {
    throw new RangeError("the crop is outside the frame");
  }
  const w = x1 - x0;
  const out = new Uint8ClampedArray(w * (y1 - y0) * 4);
  for (let y = y0; y < y1; y++) {
    const from = (y * frame.width + x0) * 4;
    out.set(frame.rgba.subarray(from, from + w * 4), (y - y0) * w * 4);
  }
  return { width: w, height: y1 - y0, rgba: out };
}

/** The names of one surface's files. */
export interface FlatFileNames {
  readonly zip: string;
  readonly reference: string;
  readonly rectified: string;
  readonly info: string;
  query(pose: PoseId, shot: number, bin: BinId): string;
  original(fileName: string): string;
}

/**
 * The names of a surface's files, e.g. `flat-target-s03-busy.zip` holding
 * `s03-reference.png` and `s03-w40-t0-q2-b3.png` (surface, pose, shot
 * number within the pose, light bin).
 */
export function flatFileNames(
  surface: number,
  cls: SurfaceClass,
): FlatFileNames {
  const s = `s${String(surface).padStart(2, "0")}`;
  return {
    zip: `flat-target-${s}-${cls}.zip`,
    reference: `${s}-reference.png`,
    rectified: `${s}-reference-rectified.png`,
    info: `${s}-info.json`,
    query: (pose, shot, bin) => `${s}-${pose}-q${String(shot)}-${bin}.png`,
    original: (fileName) => {
      const m = /\.([a-z0-9]{1,5})$/i.exec(fileName);
      return `${s}-original.${m ? m[1]!.toLowerCase() : "bin"}`;
    },
  };
}

/**
 * One query photo as the JSON lists it; file, width and height are null
 * for a photo not in this zip (downloaded before a reload).
 */
export interface ShotInfo {
  readonly file: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly pose: PoseId;
  readonly shot: number;
  readonly fullLight: boolean;
  readonly greyMean: number;
  readonly lumaRatio: number;
  readonly bin: BinId;
}

/** What one surface's JSON holds. */
export interface FlatInfoInput {
  readonly surface: number;
  readonly cls: SurfaceClass;
  readonly session: string;
  readonly original: { readonly exists: boolean; readonly file: string | null };
  readonly captureMaxLongEdge: number;
  readonly reference: Size & {
    readonly file: string | null;
    readonly corners: readonly Point[];
    readonly rectifiedFile: string | null;
    readonly rectified: Size;
  };
  readonly shots: readonly ShotInfo[];
}

const round = (v: number, places: number): number =>
  Math.round(v * 10 ** places) / 10 ** places;

/**
 * One surface's JSON: a fixed list of fields, no time and no place. A
 * file name is null when its photo is not in this zip (taken before a
 * reload, in an earlier download).
 */
export function flatInfo(v: FlatInfoInput): string {
  const poseOf = (id: PoseId) => POSES.find((p) => p.id === id)!;
  return `${JSON.stringify(
    {
      format: "flat-target/1",
      surface: v.surface,
      class: v.cls,
      session: v.session,
      original: v.original,
      captureMaxLongEdge: v.captureMaxLongEdge,
      reference: {
        file: v.reference.file,
        width: v.reference.width,
        height: v.reference.height,
        coordinates:
          "reference photo pixels, pixel centres at integers, x right, y down",
        corners: v.reference.corners.map((p, i) => ({
          corner: CORNERS[i],
          x: round(p.x, 2),
          y: round(p.y, 2),
        })),
        rectifiedFile: v.reference.rectifiedFile,
        rectifiedWidth: v.reference.rectified.width,
        rectifiedHeight: v.reference.rectified.height,
      },
      shots: v.shots.map((s) => ({
        file: s.file,
        pose: s.pose,
        distanceWidthPercent: poseOf(s.pose).distance,
        tiltDeg: poseOf(s.pose).tilt,
        shot: s.shot,
        fullLight: s.fullLight,
        greyMean: round(s.greyMean, 2),
        lumaRatio: round(s.lumaRatio, 4),
        bin: s.bin,
        binRange: LIGHT_BINS.find((b) => b.id === s.bin)!.label,
        width: s.width,
        height: s.height,
      })),
    },
    null,
    2,
  )}\n`;
}
