import { describe, expect, it } from "vitest";

import {
  decodeXFeat,
  denseMap,
  halfToFloat,
  xfeatInput,
  xfeatInputSize,
} from "./xfeat-decode";

// Why these tests matter: the XFeat model gives dense maps only; the
// keypoints, scores and descriptors the benchmark counts and matches are
// made here, host-side. A wrong channel order, layout or cell offset would
// still give "1024 keypoints", just in the wrong places.
describe("xfeatInputSize", () => {
  it("reads NHWC and NCHW single-channel shapes", () => {
    expect(xfeatInputSize([1, 480, 640, 1])).toEqual({
      width: 640,
      height: 480,
    });
    expect(xfeatInputSize([1, 1, 480, 640])).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("refuses a shape that is not one grey image", () => {
    expect(() => xfeatInputSize([1, 3, 480, 640])).toThrow(/input shape/);
  });
});

describe("xfeatInput", () => {
  it("normalizes the frame to zero mean and unit variance, padding with 0", () => {
    const gray = new Float32Array([0, 1, 0, 1]);
    const out = xfeatInput(gray, 2, 2, 3, 2);
    expect(Array.from(out.data)).toEqual([
      expect.closeTo(-1, 4),
      expect.closeTo(1, 4),
      0,
      expect.closeTo(-1, 4),
      expect.closeTo(1, 4),
      0,
    ]);
    expect(out.scale).toBe(1);
  });

  it("shrinks a frame that does not fit, never enlarges one", () => {
    const out = xfeatInput(new Float32Array(8 * 4).fill(0.5), 8, 4, 4, 4);
    expect(out.validWidth).toBe(4);
    expect(out.validHeight).toBe(2);
    expect(out.scale).toBe(0.5);
  });
});

describe("denseMap", () => {
  it("detects NCHW and NHWC by the channel count", () => {
    expect(denseMap(new Float32Array(2 * 3 * 4), [1, 2, 3, 4], 2).layout).toBe(
      "nchw",
    );
    expect(denseMap(new Float32Array(2 * 3 * 4), [1, 3, 4, 2], 2).layout).toBe(
      "nhwc",
    );
  });

  it("refuses a shape without that channel count", () => {
    expect(() => denseMap(new Float32Array(24), [1, 3, 4, 2], 5)).toThrow(
      /channels/,
    );
  });
});

describe("halfToFloat", () => {
  it("decodes IEEE half floats", () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x3555)).toBeCloseTo(0.333, 3);
    expect(halfToFloat(0)).toBe(0);
  });
});

/** One 8x8 cell (a 1x1 map) whose logits peak at position (dx, dy). */
function oneCell(dx: number, dy: number, layout: "nchw" | "nhwc") {
  const logits = new Float32Array(65).fill(-10);
  logits[dy * 8 + dx] = 10;
  const feats = new Float32Array(64);
  feats[5] = 3;
  const rel = new Float32Array([1]);
  const shape = (c: number) =>
    layout === "nchw" ? [1, c, 1, 1] : [1, 1, 1, c];
  return {
    feats: denseMap(feats, shape(64), 64),
    logits: denseMap(logits, shape(65), 65),
    rel: denseMap(rel, shape(1), 1),
  };
}

describe("decodeXFeat", () => {
  it("puts the keypoint at the cell position the logits pick", () => {
    for (const layout of ["nchw", "nhwc"] as const) {
      const { feats, logits, rel } = oneCell(3, 5, layout);
      const out = decodeXFeat(feats, logits, rel, {
        topK: 10,
        threshold: 0.05,
        validWidth: 8,
        validHeight: 8,
      });
      expect(out.count).toBe(1);
      expect(out.x[0]).toBe(3);
      expect(out.y[0]).toBe(5);
      // The descriptor is L2-normalized.
      expect(out.desc[5]).toBeCloseTo(1, 5);
    }
  });

  it("drops keypoints in the padding and keeps at most topK", () => {
    const { feats, logits, rel } = oneCell(6, 1, "nchw");
    expect(
      decodeXFeat(feats, logits, rel, {
        topK: 10,
        threshold: 0.05,
        validWidth: 5,
        validHeight: 8,
      }).count,
    ).toBe(0);
    expect(
      decodeXFeat(feats, logits, rel, {
        topK: 0,
        threshold: 0.05,
        validWidth: 8,
        validHeight: 8,
      }).count,
    ).toBe(0);
  });

  it("keeps the stronger of two peaks closer than the suppression window", () => {
    const logits = new Float32Array(65).fill(-10);
    logits[2 * 8 + 2] = 4;
    logits[2 * 8 + 4] = 5;
    logits[7 * 8 + 7] = 4.5;
    const out = decodeXFeat(
      denseMap(new Float32Array(64).fill(1), [1, 64, 1, 1], 64),
      denseMap(logits, [1, 65, 1, 1], 65),
      denseMap(new Float32Array([1]), [1, 1, 1, 1], 1),
      { topK: 10, threshold: 0.01, validWidth: 8, validHeight: 8 },
    );
    const points = Array.from({ length: out.count }, (_, i) => [
      out.x[i],
      out.y[i],
    ]);
    expect(points).toEqual([
      [4, 2],
      [7, 7],
    ]);
  });
});
