import { describe, expect, it } from "vitest";

import { cropPly, readPly } from "./ply-crop.js";

const PROPS = ["x", "y", "z", "f_dc_0", "opacity", "scale_0"];

/** A binary little-endian PLY of float vertices, as Splat.js writes one. */
function ply(rows: readonly number[][], props = PROPS): ArrayBuffer {
  const header =
    "ply\nformat binary_little_endian 1.0\n" +
    `element vertex ${String(rows.length)}\n` +
    props.map((p) => `property float ${p}`).join("\n") +
    "\nend_header\n";
  const head = new TextEncoder().encode(header);
  const out = new Uint8Array(head.length + rows.length * props.length * 4);
  out.set(head);
  const dv = new DataView(out.buffer);
  rows.forEach((r, i) =>
    r.forEach((v, k) =>
      dv.setFloat32(head.length + (i * props.length + k) * 4, v, true),
    ),
  );
  return out.buffer;
}

const logit = (a: number): number => Math.log(a / (1 - a));

describe("readPly", () => {
  // Why: the crop and the acceptance read positions and opacity straight
  // from the trainer's file; a wrong offset reads scales as positions.
  it("reads every vertex's position and opacity", () => {
    const view = readPly(
      ply([
        [1, 2, 3, 0.1, logit(0.25), 9],
        [4, 5, 6, 0.2, logit(0.75), 9],
      ]),
    );
    expect(view.count).toBe(2);
    expect(view.positions.map((p) => p.map((v) => Math.round(v)))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(view.opacities[0]).toBeCloseTo(0.25);
    expect(view.opacities[1]).toBeCloseTo(0.75);
  });

  // Why: anything but the float binary layout Splat.js writes would be
  // read as garbage; it must be refused in words instead.
  it("refuses files it cannot read", () => {
    const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer;
    expect(() => readPly(enc("not a ply"))).toThrow(/not a splat file/);
    expect(() =>
      readPly(
        enc(
          "ply\nformat ascii 1.0\nelement vertex 0\nproperty float x\nend_header\n",
        ),
      ),
    ).toThrow(/binary/);
    expect(() =>
      readPly(
        enc(
          "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty uchar x\nproperty float y\nproperty float z\nproperty float opacity\nend_header\n",
        ),
      ),
    ).toThrow(/float/);
    expect(() => readPly(ply([[1, 2, 3]], ["x", "y", "f_dc_0"]))).toThrow(/z/);
    // Fewer bytes than the header promises.
    expect(() => readPly(ply([[1, 2, 3, 0, 0, 0]]).slice(0, -4))).toThrow(
      /short/,
    );
  });
});

describe("cropPly", () => {
  // Why: the crop must keep exactly the chosen vertices, whole and in
  // order, and say how many there are, or a viewer reads past the end.
  it("keeps the chosen vertices and rewrites the count", () => {
    const src = ply([
      [1, 0, 0, 0, 0, 1],
      [2, 0, 0, 0, 0, 2],
      [3, 0, 0, 0, 0, 3],
    ]);
    const out = cropPly(src, [true, false, true]);
    const view = readPly(out);
    expect(view.count).toBe(2);
    expect(view.positions.map((p) => p[0])).toEqual([1, 3]);
    const dv = new DataView(out);
    // The scale of the second kept vertex survives unchanged.
    expect(dv.getFloat32(view.headerBytes + (6 + 5) * 4, true)).toBe(3);
    expect(out.byteLength).toBe(view.headerBytes + 2 * 6 * 4);
  });

  // Why: a keep list of the wrong length is a caller bug, never a crop
  // that silently drops the tail.
  it("refuses a keep list of the wrong length", () => {
    expect(() => cropPly(ply([[1, 0, 0, 0, 0, 1]]), [])).toThrow(RangeError);
  });

  // Why: a count the reader accepts but the rewrite does not find (written
  // as 1e0) left the old count in the header over fewer vertices: a file
  // a viewer reads past its end. The crop refuses instead.
  it("refuses a header whose vertex count it cannot rewrite", () => {
    const src = ply([
      [1, 0, 0, 0, 0, 1],
      [2, 0, 0, 0, 0, 2],
    ]);
    const text = new TextDecoder().decode(src);
    const odd = new TextEncoder().encode(
      text.replace("element vertex 2\n", "element vertex 2e0\n"),
    );
    expect(readPly(odd.buffer).count).toBe(2);
    expect(() => cropPly(odd.buffer, [true, false])).toThrow(/vertex count/);
  });

  // Why: the run reads the file once for its positions and crops it with
  // that reading, rather than parsing it twice.
  it("crops with a reading it is given", () => {
    const src = ply([
      [1, 0, 0, 0, 0, 1],
      [2, 0, 0, 0, 0, 2],
    ]);
    const view = readPly(src);
    expect(readPly(cropPly(src, [false, true], view)).positions).toEqual([
      [2, 0, 0],
    ]);
  });
});
