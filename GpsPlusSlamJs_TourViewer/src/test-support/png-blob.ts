/**
 * A header-only PNG of a given size, for tests that bring a picture into
 * a tour: the editor reads a file's kind and size from its header, so this
 * is enough to be taken as an image. Two sizes give two different files
 * (and two different content hashes).
 */
import { crc32 } from "../characters/png-text.js";

const be = (v: number): number[] => [
  v >>> 24,
  (v >>> 16) & 255,
  (v >>> 8) & 255,
  v & 255,
];

function chunk(type: string, data: readonly number[]): number[] {
  const body = Uint8Array.from([
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
  ]);
  return [...be(data.length), ...body, ...be(crc32(body))];
}

export function pngBlob(width: number, height: number): Blob {
  const bytes = [
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", [...be(width), ...be(height), 8, 6, 0, 0, 0]),
    ...chunk("IEND", []),
  ];
  return new Blob([Uint8Array.from(bytes)], { type: "image/png" });
}
