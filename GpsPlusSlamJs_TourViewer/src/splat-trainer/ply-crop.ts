/**
 * Reads and crops the splat files Splat.js writes: binary little-endian
 * PLY with one `vertex` element of float properties (`x`, `y`, `z`,
 * `opacity` as a logit, and the rest passed through untouched). The crop
 * keeps a chosen subset of vertices and rewrites the vertex count.
 *
 * @see ply-crop.ts.md
 */

import type { Vector3 } from "gps-plus-slam-app-framework/core";

/** What a splat file holds, as the crop and the checks read it. */
export interface PlyView {
  readonly count: number;
  /** Bytes per vertex. */
  readonly stride: number;
  /** Length of the header, including its last newline. */
  readonly headerBytes: number;
  /** The header text, for rewriting the count. */
  readonly header: string;
  readonly positions: readonly Vector3[];
  /** Each vertex's opacity, 0 to 1 (the file stores its logit). */
  readonly opacities: readonly number[];
}

const END = "end_header\n";
/** A header longer than this is not one Splat.js wrote. */
const MAX_HEADER_BYTES = 64 * 1024;

/**
 * The splat file's vertices. Throws an Error that names the problem for a
 * file that is not a binary little-endian PLY of float vertex properties
 * with `x`, `y`, `z` and `opacity`, or that is shorter than its header
 * says.
 */
export function readPly(bytes: ArrayBuffer): PlyView {
  const head = new TextDecoder().decode(
    new Uint8Array(bytes, 0, Math.min(bytes.byteLength, MAX_HEADER_BYTES)),
  );
  const end = head.indexOf(END);
  if (!head.startsWith("ply\n") || end < 0) {
    throw new Error("This is not a splat file (no PLY header).");
  }
  const header = head.slice(0, end + END.length);
  const lines = header.split("\n");
  if (!lines.includes("format binary_little_endian 1.0")) {
    throw new Error("The splat file is not binary little-endian.");
  }
  let count = -1;
  const props: string[] = [];
  for (const line of lines) {
    const w = line.split(" ");
    if (w[0] === "element") {
      if (w[1] !== "vertex" || count >= 0) {
        throw new Error("The splat file holds more than its vertices.");
      }
      count = Number(w[2]);
    } else if (w[0] === "property") {
      if (w[1] !== "float" || w.length !== 3) {
        throw new Error(
          `The splat file has a property that is not a float (${line}).`,
        );
      }
      props.push(w[2] ?? "");
    }
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("The splat file has no vertex count.");
  }
  const at = (name: string): number => {
    const i = props.indexOf(name);
    if (i < 0) throw new Error(`The splat file has no ${name}.`);
    return i * 4;
  };
  const [ox, oy, oz, oa] = [at("x"), at("y"), at("z"), at("opacity")];
  const stride = props.length * 4;
  // The header is ASCII, so its characters are its bytes.
  const headerBytes = header.length;
  if (bytes.byteLength < headerBytes + count * stride) {
    throw new Error("The splat file is shorter than its header says.");
  }
  const dv = new DataView(bytes, headerBytes);
  const positions: Vector3[] = [];
  const opacities: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    positions.push([
      dv.getFloat32(o + ox, true),
      dv.getFloat32(o + oy, true),
      dv.getFloat32(o + oz, true),
    ]);
    opacities.push(1 / (1 + Math.exp(-dv.getFloat32(o + oa, true))));
  }
  return { count, stride, headerBytes, header, positions, opacities };
}

/**
 * A new splat file with the vertices whose `keep` entry is true, in their
 * order, every property passed through. Throws a RangeError when `keep`
 * does not have one entry per vertex.
 */
export function cropPly(
  bytes: ArrayBuffer,
  keep: readonly boolean[],
): ArrayBuffer {
  const view = readPly(bytes);
  if (keep.length !== view.count) {
    throw new RangeError(
      `keep has ${String(keep.length)} entries for ${String(view.count)} vertices`,
    );
  }
  const kept = keep.filter(Boolean).length;
  const header = new TextEncoder().encode(
    view.header.replace(
      /^element vertex \d+$/m,
      `element vertex ${String(kept)}`,
    ),
  );
  const out = new Uint8Array(header.length + kept * view.stride);
  out.set(header);
  const src = new Uint8Array(bytes, view.headerBytes, view.count * view.stride);
  let w = header.length;
  keep.forEach((k, i) => {
    if (!k) return;
    out.set(src.subarray(i * view.stride, (i + 1) * view.stride), w);
    w += view.stride;
  });
  return out.buffer;
}
