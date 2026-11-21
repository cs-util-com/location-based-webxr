/**
 * A picture's type from its first bytes, never from its file name or the
 * MIME type a model claims for it, and whether a `.glb` may carry it as
 * it is. PNG, JPEG, WebP and AVIF are embeddable (core glTF, or the
 * `EXT_texture_webp` / `EXT_texture_avif` extensions three.js reads), with
 * their size read from the header by the framework's one image-header
 * reader. GIF, BMP, TIFF, PSD, DDS, KTX, KTX2, OpenEXR and Radiance HDR
 * are recognised by name only, so the creator can be told which file was
 * left out and why. Pure: no I/O, never throws.
 *
 * @see image-sniff.ts.md
 */

import { imageInfo } from "gps-plus-slam-app-framework/utils/image-header";

export type SniffedImage =
  | {
      readonly type: "png" | "jpeg" | "webp" | "avif";
      readonly mime: string;
      readonly embeddable: true;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly type: string;
      readonly mime: null;
      readonly embeddable: false;
    };

const EMBEDDABLE_MIME: ReadonlyMap<string, string> = new Map([
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
]);

/** Magic numbers of the pictures a tour does not show, by type. */
const OTHER_MAGIC: readonly (readonly [string, readonly number[]])[] = [
  ["gif", [0x47, 0x49, 0x46, 0x38]],
  ["bmp", [0x42, 0x4d]],
  ["tiff", [0x49, 0x49, 0x2a, 0x00]],
  ["tiff", [0x4d, 0x4d, 0x00, 0x2a]],
  ["psd", [0x38, 0x42, 0x50, 0x53]],
  ["dds", [0x44, 0x44, 0x53, 0x20]],
  ["ktx2", [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb]],
  ["ktx", [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb]],
  ["exr", [0x76, 0x2f, 0x31, 0x01]],
  ["hdr", [0x23, 0x3f]],
];

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

/** What the picture `bytes` is, or null when no known picture starts so
 *  (or an embeddable one whose size cannot be read from its header). */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  const info = imageInfo(bytes);
  const mime = info === null ? undefined : EMBEDDABLE_MIME.get(info.type);
  if (info !== null && mime !== undefined) {
    return {
      type: info.type as "png" | "jpeg" | "webp" | "avif",
      mime,
      embeddable: true,
      width: info.width,
      height: info.height,
    };
  }
  const other = OTHER_MAGIC.find(([, magic]) => startsWith(bytes, magic));
  return other === undefined
    ? null
    : { type: other[0], mime: null, embeddable: false };
}
