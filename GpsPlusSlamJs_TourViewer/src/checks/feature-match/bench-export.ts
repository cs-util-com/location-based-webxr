/**
 * Saving the benchmark's captured camera frames to the device: the file
 * names, a check that a PNG carries image chunks only (no EXIF, text or
 * time), the JSON that travels with the frames, and one zip of them all.
 *
 * @see bench-export.ts.md
 */
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { toFramePoint } from "./bench-image";
import type { MethodResult, Points } from "./bench-run";
import type { SquareCrop, TurnDegrees } from "./rotation-square";

/** The names the saved files get. */
export const FRAME_FILES = {
  A: "feature-match-frame-a.png",
  B: "feature-match-frame-b.png",
  info: "feature-match-frames.json",
  matches: "feature-match-matches.json",
  log: "feature-match-log.txt",
  report: "feature-match-report.txt",
  all: "feature-match-all.zip",
} as const;

/**
 * The protocol's pair keys and labels: the vocabulary the frames JSON and
 * the PC side share. The pairs themselves are derived from shots
 * (`scenes.ts`); the old duplicate controls 3a and 4a no longer occur.
 * The turns of a centre square cut from F1 and F2 are made, not captured,
 * so they have keys of their own (t0, t90, t180): the old 2b and 2c named
 * a phone turned by hand and are not reused for a different measurement.
 */
export const PAIRS = [
  { key: "1a", label: "light: control (same light)" },
  { key: "1b", label: "light: dimmed" },
  { key: "1c", label: "light: dark, not black" },
  { key: "2a", label: "rotation: control (both upright)" },
  { key: "t0", label: "rotation: control, centre squares" },
  { key: "t90", label: "rotation: centre square turned 90 deg" },
  { key: "t180", label: "rotation: centre square turned 180 deg" },
  // The PC reader reads this label as it is; the shot is a turn in plane.
  { key: "2d", label: "rotation: tilted 30-45 deg" },
  { key: "3b", label: "distance: 1.5 m to 3 m" },
  { key: "3c", label: "distance: 1 m to 3 m" },
  { key: "4b", label: "side step, flat: 1 m" },
  { key: "4c", label: "side step, deep: control" },
  { key: "4d", label: "side step, deep: 1 m" },
  { key: "x", label: "other" },
] as const;

/** A key of PAIRS. */
export type PairKey = (typeof PAIRS)[number]["key"];

/** The places the light pairs (and the light scene) are repeated at. */
export const MAX_SPOTS = 3;

/** A dimmed pair's photo B must be at most this share of A's grey mean. */
export const LIGHT_DARKER_RATIO = 0.8;
/** The control pair's photo B may differ from A's grey mean by this share. */
export const LIGHT_CONTROL_TOLERANCE = 0.2;
/**
 * Below this grey mean photo A is too dark to measure a dimming against;
 * the control pair then allows LIGHT_FLOOR_B grey levels instead of a share.
 */
export const LIGHT_FLOOR_A = 10;
/** Below this grey mean a dimmed pair's photo B is black: nothing to match. */
export const LIGHT_FLOOR_B = 3;

/**
 * Whether the light changed as a light pair needs: "ok", "not-darker" (a
 * dimmed pair whose B is not clearly darker than A), "too-dark-a" (a
 * dimmed pair whose A is almost black), "too-dark-b" (a dimmed pair's B
 * is black) or "changed" (the control pair's light changed). Null for every
 * other pair.
 */
export type LightCheck =
  "ok" | "not-darker" | "too-dark-a" | "too-dark-b" | "changed";

/** A light shot's check: the pair checks, plus L4 brighter than L3. */
export type ShotLight = LightCheck | "not-darker-than-dimmed";

/**
 * @throws RangeError on a grey mean that is not a number from 0 to 255.
 */
export function lightCheck(
  key: string,
  meanA: number,
  meanB: number,
): LightCheck | null {
  for (const m of [meanA, meanB]) {
    if (!Number.isFinite(m) || m < 0 || m > 255) {
      throw new RangeError(`grey mean must be 0 to 255, got ${String(m)}`);
    }
  }
  if (key === "1b" || key === "1c") {
    return dimmedCheck(meanA, meanB);
  }
  if (key === "1a") {
    const tolerance =
      meanA < LIGHT_FLOOR_A ? LIGHT_FLOOR_B : LIGHT_CONTROL_TOLERANCE * meanA;
    return Math.abs(meanB - meanA) > tolerance ? "changed" : "ok";
  }
  return null;
}

/** A dimmed pair's check, the same for the dimmed and the dark pair. */
function dimmedCheck(meanA: number, meanB: number): LightCheck {
  if (meanA < LIGHT_FLOOR_A) {
    return "too-dark-a";
  }
  if (meanB < LIGHT_FLOOR_B) {
    return "too-dark-b";
  }
  return meanB > LIGHT_DARKER_RATIO * meanA ? "not-darker" : "ok";
}

/**
 * A page load's token for the frames JSON: random bytes as hex, no time
 * and no place. It tells two runs apart, and names the run's zip.
 *
 * @throws RangeError for fewer than 4 bytes.
 */
export function sessionToken(bytes: Uint8Array): string {
  if (bytes.length < 4) {
    throw new RangeError(
      `session token needs 4 bytes at least, got ${String(bytes.length)}`,
    );
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Chunks a PNG of plain pixels may hold: header, palette, transparency,
 * colour space, data and end, and the ancillary chunks that only describe
 * the pixels (density, significant bits, background, colour coding and
 * HDR levels), which another encoder may add. Anything else (`eXIf`,
 * `tEXt`, `iTXt`, `zTXt`, `tIME`, an unknown chunk) is refused.
 */
const IMAGE_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "tRNS",
  "sRGB",
  "gAMA",
  "cHRM",
  "iCCP",
  "pHYs",
  "sBIT",
  "bKGD",
  "cICP",
  "cLLI",
  "mDCV",
  "IDAT",
  "IEND",
]);

/**
 * The chunk types of a PNG, in order. CRCs are not checked.
 *
 * @throws Error "not a PNG" on a wrong signature, "truncated" when a chunk
 *   runs past the end.
 */
export function pngChunkTypes(bytes: Uint8Array): string[] {
  if (
    bytes.length < SIGNATURE.length ||
    SIGNATURE.some((b, i) => bytes[i] !== b)
  ) {
    throw new Error("not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  let at = SIGNATURE.length;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) {
      throw new Error("PNG truncated");
    }
    const length = view.getUint32(at);
    const end = at + 12 + length;
    if (end > bytes.length) {
      throw new Error("PNG truncated");
    }
    types.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
    at = end;
  }
  return types;
}

/**
 * @throws Error `<label>: PNG carries a <type> chunk` for any chunk that is
 *   not image data, or `<label>: PNG has no IEND` for a cut-off file.
 */
export function assertPlainPng(bytes: Uint8Array, label: string): void {
  const types = pngChunkTypes(bytes);
  const extra = types.find((t) => !IMAGE_CHUNKS.has(t));
  if (extra !== undefined) {
    throw new Error(`${label}: PNG carries a ${extra} chunk`);
  }
  if (types.at(-1) !== "IEND") {
    throw new Error(`${label}: PNG has no IEND`);
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

interface Size {
  readonly width: number;
  readonly height: number;
}

/** Points computed at `size`, in the pixels of `frame`, to 0.01 px. */
function inFrame(p: Points, size: Size, frame: Size): [number, number][] {
  return Array.from(p.x, (x, i) => [
    round2(toFramePoint(x, size.width, frame.width)),
    round2(toFramePoint(p.y[i]!, size.height, frame.height)),
  ]);
}

/**
 * How a run zip's pair was measured: the shot files its frames are, what
 * ran beside the measuring, whether the page was hidden, the run settings
 * line, and the methods and sizes ticked.
 */
export interface MatchesAbout {
  readonly files: { readonly a: string; readonly b: string };
  readonly context: "beside-camera" | "idle";
  readonly hidden: boolean;
  readonly settings: string;
  readonly methods: Readonly<Record<string, boolean>>;
  readonly sizes: readonly number[];
  /**
   * A rotation pair: both frames were cut to these centre squares of the
   * shot files and B turned clockwise, so the keypoints are in the
   * squares' pixels (B's after the turn).
   */
  readonly square?: {
    readonly a: SquareCrop;
    readonly b: SquareCrop;
    readonly turn: TurnDegrees;
  };
}

/**
 * The JSON of every method's keypoints and matches on the camera pair,
 * for checking offline against the saved frames. Positions are in the
 * pixels of the saved PNGs (mapped from the size each was computed at,
 * which is kept with them); `matches` pairs an index into `keypointsA`
 * with one into `keypointsB`. Raw output: nothing is verified here. No
 * device, time or place.
 */
export function matchesInfo(
  results: readonly MethodResult[],
  frames: { readonly a: Size; readonly b: Size },
  about?: MatchesAbout,
): string {
  return `${JSON.stringify({
    format: "feature-match-matches/1",
    coordinates:
      "pixels of the saved frames, pixel centres at integers, x right, y down",
    frames: {
      A: {
        file: about?.files.a ?? FRAME_FILES.A,
        width: frames.a.width,
        height: frames.a.height,
      },
      B: {
        file: about?.files.b ?? FRAME_FILES.B,
        width: frames.b.width,
        height: frames.b.height,
      },
    },
    ...(about === undefined
      ? {}
      : {
          measured: {
            context: about.context,
            hidden: about.hidden,
            settings: about.settings,
            methods: about.methods,
            sizes: about.sizes,
            ...(about.square
              ? {
                  square: {
                    a: about.square.a,
                    b: about.square.b,
                    turn: { degrees: about.square.turn, direction: "cw" },
                  },
                }
              : {}),
          },
        }),
    methods: results.map((r) => ({
      id: r.id,
      label: r.label,
      backend: r.backend,
      error: r.error,
      sizes: r.sizes.map((s) => ({
        longEdge: s.longEdge,
        width: s.width,
        height: s.height,
        error: s.error,
        keypointsA: s.sample ? inFrame(s.sample.a, s, frames.a) : [],
        keypointsB: s.sample ? inFrame(s.sample.b, s, frames.b) : [],
        matches: s.sample
          ? Array.from({ length: s.sample.pairs.length / 2 }, (_, i) => [
              s.sample!.pairs[2 * i]!,
              s.sample!.pairs[2 * i + 1]!,
            ])
          : [],
      })),
    })),
  })}\n`;
}

/** One prepared file: its name and its bytes. */
export interface NamedBlob {
  readonly name: string;
  readonly blob: Blob;
}

/**
 * Every prepared file plus the page log, and the report when there is
 * one, as one uncompressed zip: a single download instead of one per
 * file and a log copied out by hand. Each entry holds exactly the bytes
 * offered on its own.
 *
 * @throws ZipPackagingError (from the framework writer) on a duplicate or
 *   unsafe name, or when writing fails.
 */
export function allFilesZip(
  files: readonly NamedBlob[],
  texts: { readonly log: string; readonly report: string },
): Promise<Blob> {
  return packFilesAsZip([
    ...files.map((f) => ({ path: f.name, data: f.blob })),
    { path: FRAME_FILES.log, data: texts.log },
    ...(texts.report === ""
      ? []
      : [{ path: FRAME_FILES.report, data: texts.report }]),
  ]);
}
