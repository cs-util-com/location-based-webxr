/**
 * Saving the benchmark's captured camera frames to the device: the file
 * names, a check that a PNG carries image chunks only (no EXIF, text or
 * time), and the JSON that travels with the frames.
 *
 * @see bench-export.ts.md
 */
import { greyStats, type Frame } from "./bench-image";
import type { DeviceInfo } from "./bench-report";

/** The names the saved files get. */
export const FRAME_FILES = {
  A: "feature-match-frame-a.png",
  B: "feature-match-frame-b.png",
  info: "feature-match-frames.json",
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
 * colour space, data and end. Anything else (`eXIf`, `tEXt`, `iTXt`,
 * `zTXt`, `tIME`, an unknown chunk) is refused.
 */
const IMAGE_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "tRNS",
  "sRGB",
  "gAMA",
  "cHRM",
  "iCCP",
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
