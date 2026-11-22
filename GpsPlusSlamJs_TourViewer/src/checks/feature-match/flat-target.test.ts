import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { makeFrame } from "./bench-image";
import {
  applyHomography,
  CORNERS,
  cornersProblem,
  cropFrame,
  DISTANCES,
  flatFileNames,
  flatInfo,
  guideRect,
  homographyFromCorners,
  LIGHT_BINS,
  lightBin,
  lumaRatio,
  nextCorner,
  POSES,
  poseId,
  rectifiedSize,
  rectify,
  SURFACE_CLASSES,
  toImagePoint,
  type Point,
} from "./flat-target";

describe("lightBin", () => {
  // Why: the bins are the measurement's light axis; a photo at a bound must
  // land in the bin the protocol names (>= 0.85, 0.6-0.85, 0.35-0.6, < 0.35).
  it("puts each bound into the brighter bin", () => {
    expect(lightBin(1)).toBe("b1");
    expect(lightBin(0.85)).toBe("b1");
    expect(lightBin(0.8499)).toBe("b2");
    expect(lightBin(0.6)).toBe("b2");
    expect(lightBin(0.5999)).toBe("b3");
    expect(lightBin(0.35)).toBe("b3");
    expect(lightBin(0.3499)).toBe("b4");
    expect(lightBin(0)).toBe("b4");
  });

  // Why: auto exposure can make a dimmer scene read brighter; a ratio above
  // 1 is a real reading and belongs in the brightest bin, not an error.
  it("puts a ratio above 1 into the brightest bin", () => {
    expect(lightBin(1.7)).toBe("b1");
  });

  it("refuses a ratio that is not a finite non-negative number", () => {
    for (const r of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => lightBin(r)).toThrow(RangeError);
    }
  });

  // Why: a darker photo must never land in a brighter bin than a lighter one.
  it("is monotone in the ratio (property)", () => {
    const order = LIGHT_BINS.map((b) => b.id);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (r1, r2) => {
          const [lo, hi] = r1 <= r2 ? [r1, r2] : [r2, r1];
          expect(order.indexOf(lightBin(lo))).toBeGreaterThanOrEqual(
            order.indexOf(lightBin(hi)),
          );
        },
      ),
    );
  });
});

describe("lumaRatio", () => {
  it("divides the photo's grey mean by the pose's full-light mean", () => {
    expect(lumaRatio(50, 100)).toBeCloseTo(0.5);
  });

  // Why: a black full-light shot gives no reference to compare against;
  // the page must say so instead of tagging every photo of the pose b1.
  it("refuses a full-light mean that is too dark to compare against", () => {
    expect(() => lumaRatio(1, 2)).toThrow(/too dark/);
    expect(() => lumaRatio(-1, 100)).toThrow(RangeError);
    expect(() => lumaRatio(10, 300)).toThrow(RangeError);
  });
});

describe("poses", () => {
  // Why: the protocol is 3 distances x 2 tilts; ids must be unique and
  // name both, because the file names carry them.
  it("are the 6 combinations of 3 distances and 2 tilts", () => {
    expect(DISTANCES).toEqual([40, 20, 12]);
    expect(POSES.map((p) => p.id)).toEqual([
      "w40-t0",
      "w40-t40",
      "w20-t0",
      "w20-t40",
      "w12-t0",
      "w12-t40",
    ]);
    expect(poseId(20, 40)).toBe("w20-t40");
  });

  it("has three surface classes", () => {
    expect(SURFACE_CLASSES.map((c) => c.id)).toEqual(["busy", "text", "low"]);
  });
});

describe("corners", () => {
  it("asks for the corners in reading order around the surface", () => {
    expect(CORNERS).toEqual([
      "top-left",
      "top-right",
      "bottom-right",
      "bottom-left",
    ]);
    expect(nextCorner([])).toBe("top-left");
    expect(nextCorner([{ x: 0, y: 0 }])).toBe("top-right");
    expect(
      nextCorner([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
    ).toBeNull();
  });

  // Why: taps in the wrong order or almost on a line give a rectified
  // image that is mirrored or degenerate; the page must ask for a redo.
  it("names a problem for taps out of order or too close together", () => {
    const ok: Point[] = [
      { x: 10, y: 10 },
      { x: 200, y: 20 },
      { x: 190, y: 150 },
      { x: 20, y: 140 },
    ];
    expect(cornersProblem(ok, 320, 240)).toBeNull();
    const swapped = [ok[1]!, ok[0]!, ok[2]!, ok[3]!];
    expect(cornersProblem(swapped, 320, 240)).toMatch(/order/);
    const tiny: Point[] = [
      { x: 10, y: 10 },
      { x: 12, y: 10 },
      { x: 12, y: 12 },
      { x: 10, y: 12 },
    ];
    expect(cornersProblem(tiny, 320, 240)).toMatch(/small/);
    expect(cornersProblem(ok.slice(0, 3), 320, 240)).toMatch(/4/);
  });
});

describe("homographyFromCorners", () => {
  // Why: the rectified reference is only right if the homography maps
  // each tapped corner exactly onto its rectangle corner.
  it("maps four convex points onto the rectangle (property)", () => {
    const coord = fc.double({ min: 0, max: 60, noNaN: true });
    fc.assert(
      fc.property(
        coord,
        coord,
        coord,
        coord,
        coord,
        coord,
        coord,
        coord,
        (a, b, c, d, e, f, g, h) => {
          const src: Point[] = [
            { x: 20 + a, y: 20 + b },
            { x: 300 - c, y: 20 + d },
            { x: 300 - e, y: 220 - f },
            { x: 20 + g, y: 220 - h },
          ];
          const dst: Point[] = [
            { x: 0, y: 0 },
            { x: 99, y: 0 },
            { x: 99, y: 59 },
            { x: 0, y: 59 },
          ];
          const m = homographyFromCorners(src, dst);
          src.forEach((p, i) => {
            const q = applyHomography(m, p.x, p.y);
            expect(q.x).toBeCloseTo(dst[i]!.x, 6);
            expect(q.y).toBeCloseTo(dst[i]!.y, 6);
          });
        },
      ),
    );
  });

  it("refuses three points on a line", () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(() => homographyFromCorners(line, line)).toThrow(/degenerate/);
  });
});

describe("rectifiedSize", () => {
  // Why: the rectified size keeps the longer of each pair of opposite
  // edges, so a tilted reference is not shrunk; it never exceeds the cap.
  it("takes the longer opposite edges, capped on the long side", () => {
    const c: Point[] = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 280, y: 200 },
      { x: 20, y: 200 },
    ];
    expect(rectifiedSize(c, 1024)).toEqual({ width: 300, height: 201 });
    expect(rectifiedSize(c, 150)).toEqual({ width: 150, height: 100 });
  });
});

describe("rectify", () => {
  // Why: a fronto-parallel rectangle in the photo must come back as the
  // same pixels; a check of the warp's direction and pixel centres.
  it("cuts out an axis-aligned rectangle unchanged", () => {
    const w = 8;
    const h = 6;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = i;
      rgba[i * 4 + 3] = 255;
    }
    const frame = makeFrame(w, h, rgba);
    const corners: Point[] = [
      { x: 2, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 4 },
      { x: 2, y: 4 },
    ];
    const out = rectify(frame, corners, { width: 4, height: 4 });
    expect(out.width).toBe(4);
    const reds = Array.from({ length: 16 }, (_, i) => out.rgba[i * 4]);
    expect(reds).toEqual([
      10, 11, 12, 13, 18, 19, 20, 21, 26, 27, 28, 29, 34, 35, 36, 37,
    ]);
  });
});

describe("guideRect", () => {
  // Why: the guide frame shows how wide the surface should appear for a
  // distance; its width is the share of the frame width, centred.
  it("is centred with the width share and the reference's aspect", () => {
    expect(guideRect(1000, 800, 40, 2)).toEqual({
      x: 300,
      y: 300,
      width: 400,
      height: 200,
    });
  });

  it("shrinks to fit a tall surface into the frame height", () => {
    const r = guideRect(1000, 500, 40, 0.5);
    expect(r.height).toBeLessThanOrEqual(500);
    expect(r.width).toBeCloseTo(250);
  });
});

describe("toImagePoint", () => {
  // Why: the corner taps arrive in CSS pixels on a letterboxed (contain)
  // picture and must become image pixels; a tap on the bars is outside.
  it("maps a tap on a letterboxed picture to image pixels", () => {
    const box = { left: 0, top: 0, width: 400, height: 400 };
    // A 800x400 image shown at 400x200, bars of 100 above and below.
    expect(toImagePoint(200, 200, box, 800, 400)).toEqual({ x: 400, y: 200 });
    expect(toImagePoint(0, 100, box, 800, 400)).toEqual({ x: 0, y: 0 });
    expect(toImagePoint(200, 50, box, 800, 400)).toBeNull();
  });
});

describe("cropFrame", () => {
  it("cuts the rectangle, clamped to the frame", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).map((_, i) => i);
    const f = makeFrame(4, 4, rgba);
    const c = cropFrame(f, { x: 2, y: 2, width: 10, height: 10 });
    expect([c.width, c.height]).toEqual([2, 2]);
    expect(c.rgba[0]).toBe((2 * 4 + 2) * 4);
  });
});

describe("flatFileNames", () => {
  // Why: every file must say its surface, pose and light bin, so a folder
  // of downloads sorts and reads without the JSON.
  it("names the surface, pose, shot and bin", () => {
    const n = flatFileNames(3, "busy");
    expect(n.zip).toBe("flat-target-s03-busy.zip");
    expect(n.reference).toBe("s03-reference.png");
    expect(n.rectified).toBe("s03-reference-rectified.png");
    expect(n.info).toBe("s03-info.json");
    expect(n.query("w40-t0", 1, "b1")).toBe("s03-w40-t0-q1-b1.png");
    expect(n.query("w12-t40", 4, "b3")).toBe("s03-w12-t40-q4-b3.png");
    expect(n.original("My Photo.JPG")).toBe("s03-original.jpg");
    expect(n.original("noext")).toBe("s03-original.bin");
  });
});

describe("flatInfo", () => {
  // Why: the JSON is what the offline scorer reads; its fields are a fixed
  // list with no time and no place.
  it("carries the surface, taps, size and every shot's tags", () => {
    const text = flatInfo({
      surface: 2,
      cls: "text",
      session: "a1b2c3d4",
      original: { exists: true, file: "s02-original.png" },
      captureMaxLongEdge: 1024,
      reference: {
        file: "s02-reference.png",
        width: 1024,
        height: 768,
        corners: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
          { x: 5, y: 6 },
          { x: 7, y: 8 },
        ],
        rectifiedFile: "s02-reference-rectified.png",
        rectified: { width: 300, height: 200 },
      },
      shots: [
        {
          file: "s02-w40-t0-q1-b1.png",
          pose: "w40-t0",
          shot: 1,
          fullLight: true,
          greyMean: 120.456,
          lumaRatio: 1,
          bin: "b1",
          width: 1024,
          height: 768,
        },
      ],
    });
    const v = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(v)).toEqual([
      "format",
      "surface",
      "class",
      "session",
      "original",
      "captureMaxLongEdge",
      "reference",
      "shots",
    ]);
    expect(v.format).toBe("flat-target/1");
    const shots = v.shots as Record<string, unknown>[];
    expect(shots[0]).toMatchObject({
      pose: "w40-t0",
      distanceWidthPercent: 40,
      tiltDeg: 0,
      bin: "b1",
      greyMean: 120.46,
    });
    // "flat-target" itself holds "lat", so whole words are checked.
    expect(text).not.toMatch(/time|date|latitude|longitude|bgpsb/i);
  });
});
