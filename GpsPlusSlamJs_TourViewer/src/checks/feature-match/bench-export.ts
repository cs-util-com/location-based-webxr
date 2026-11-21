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

/** The photo pairs of the test protocol, in the order they are taken. */
export const PAIRS = [
  { key: "1a", label: "light: control (same light)" },
  { key: "1b", label: "light: dimmed" },
  { key: "1c", label: "light: dark, not black" },
  { key: "2a", label: "rotation: control (both upright)" },
  { key: "2b", label: "rotation: 90 deg" },
  { key: "2c", label: "rotation: 180 deg" },
  { key: "2d", label: "rotation: tilted 30-45 deg" },
  { key: "3a", label: "distance: control (both 1.5 m)" },
  { key: "3b", label: "distance: 1.5 m to 3 m" },
  { key: "3c", label: "distance: 1 m to 3 m" },
  { key: "4a", label: "side step, flat: control" },
  { key: "4b", label: "side step, flat: 1 m" },
  { key: "4c", label: "side step, deep: control" },
  { key: "4d", label: "side step, deep: 1 m" },
  { key: "x", label: "other" },
] as const;

/**
 * The selector's "none": a manual run that uses the Options. Not part of
 * the protocol, so nextPair never moves into or out of it.
 */
export const NO_PAIR = { key: "none", label: "manual run" } as const;

/** A key of PAIRS, or NO_PAIR's. */
export type PairKey = (typeof PAIRS)[number]["key"] | typeof NO_PAIR.key;

/** Spots the light pairs are repeated at. */
const SPOTS = 3;

/** Which pair a capture belongs to; fixed when photo A is taken. */
export interface PairTag {
  readonly pair: string;
  readonly pairLabel: string;
  /** 1 to SPOTS. */
  readonly spot: number;
  /** Running number of the pair in this page session, from 1. */
  readonly sequence: number;
}

/**
 * @throws Error on an unknown key, a spot that is not an integer 1-3 or a
 *   sequence that is not an integer of at least 1.
 */
export function pairTag(key: string, spot: number, sequence: number): PairTag {
  const p = [...PAIRS, NO_PAIR].find((q) => q.key === key);
  if (!p) {
    throw new Error(`unknown pair ${key}`);
  }
  if (!Number.isInteger(spot) || spot < 1 || spot > SPOTS) {
    throw new Error(`spot must be 1 to ${String(SPOTS)}, got ${String(spot)}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`sequence must be 1 or more, got ${String(sequence)}`);
  }
  return { pair: p.key, pairLabel: p.label, spot, sequence };
}

/** The spot field's value; anything but 1, 2 or 3 reads as 1. */
export function parseSpot(text: string): number {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1 && n <= SPOTS && text.trim() !== ""
    ? n
    : 1;
}

/**
 * The pair after `key` at `spot`: the next in PAIRS. The light pairs run
 * through every spot first (1c at spot 1 or 2 goes on to 1a at the next
 * spot), the pairs after them start at spot 1, and "other" stays.
 */
export function nextPair(
  key: string,
  spot: number,
): { key: string; spot: number } {
  if (key === "1c" && spot < SPOTS) {
    return { key: "1a", spot: spot + 1 };
  }
  const i = PAIRS.findIndex((p) => p.key === key);
  if (i < 0 || i === PAIRS.length - 1) {
    return { key, spot };
  }
  return { key: PAIRS[i + 1]!.key, spot: key === "1c" ? 1 : spot };
}

/** The downloaded names of one pair's files. */
export type PairFileNames = Readonly<
  Record<"all" | "A" | "B" | "info" | "matches", string>
>;

/**
 * The names one pair's files are offered under, e.g.
 * `feature-match-03-1b-s2-light-dimmed.zip`: running number (two digits at
 * least), key, spot and the label in lower-case ASCII. Entries inside the
 * zip keep the fixed FRAME_FILES names.
 */
export function pairFileNames(tag: PairTag): PairFileNames {
  const slug = tag.pairLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const stem = `feature-match-${String(tag.sequence).padStart(2, "0")}-${tag.pair}-s${String(tag.spot)}-${slug}`;
  return {
    all: `${stem}.zip`,
    A: `${stem}-frame-a.png`,
    B: `${stem}-frame-b.png`,
    info: `${stem}-frames.json`,
    matches: `${stem}-matches.json`,
  };
}

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
 * The JSON saved with the frames: a fixed list of fields (the pair, sizes,
 * grey values, the device), no time and no place.
 */
export function framesInfo(
  frames: readonly SavedFrame[],
  device: DeviceInfo,
  captureMaxLongEdge: number,
  tag: PairTag,
): string {
  return `${JSON.stringify(
    {
      format: "feature-match-frames/1",
      pair: tag.pair,
      pairLabel: tag.pairLabel,
      spot: tag.spot,
      sequence: tag.sequence,
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
