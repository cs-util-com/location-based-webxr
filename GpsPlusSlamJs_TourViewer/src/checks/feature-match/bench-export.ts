/**
 * Saving the benchmark's captured camera frames to the device: the file
 * names, a check that a PNG carries image chunks only (no EXIF, text or
 * time), the JSON that travels with the frames, and one zip of them all.
 *
 * @see bench-export.ts.md
 */
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { greyStats, toFramePoint, type Frame } from "./bench-image";
import type { DeviceInfo } from "./bench-report";
import type { MethodResult, Points } from "./bench-run";

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

/** A captured frame and the camera size it was taken from. */
export interface SavedFrame {
  readonly name: "A" | "B";
  readonly frame: Frame;
  readonly source: { readonly width: number; readonly height: number };
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
): string {
  return `${JSON.stringify({
    format: "feature-match-matches/1",
    coordinates:
      "pixels of the saved frames, pixel centres at integers, x right, y down",
    frames: {
      A: {
        file: FRAME_FILES.A,
        width: frames.a.width,
        height: frames.a.height,
      },
      B: {
        file: FRAME_FILES.B,
        width: frames.b.width,
        height: frames.b.height,
      },
    },
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

/**
 * The JSON saved with the frames: a fixed list of fields (sizes, grey
 * values, the device), no time and no place.
 */
export function framesInfo(
  frames: readonly SavedFrame[],
  device: DeviceInfo,
  captureMaxLongEdge: number,
): string {
  return `${JSON.stringify(
    {
      format: "feature-match-frames/1",
      captureMaxLongEdge,
      frames: frames.map((f) => {
        const g = greyStats(f.frame);
        return {
          name: f.name,
          file: FRAME_FILES[f.name],
          width: f.frame.width,
          height: f.frame.height,
          sourceWidth: f.source.width,
          sourceHeight: f.source.height,
          greyMean: round2(g.mean),
          greySd: round2(g.sd),
        };
      }),
      device,
    },
    null,
    2,
  )}\n`;
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
