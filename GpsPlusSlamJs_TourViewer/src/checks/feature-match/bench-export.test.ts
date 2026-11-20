import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  FRAME_FILES,
  assertPlainPng,
  framesInfo,
  matchesInfo,
  pngChunkTypes,
} from "./bench-export";
import { makeFrame, toFramePoint } from "./bench-image";
import type { DeviceInfo } from "./bench-report";
import type { MethodResult, SizeResult } from "./bench-run";
import { summarize } from "./bench-stats";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** A PNG made of the given chunks (CRCs zero: the walk does not check them). */
function png(...chunks: [string, number[]][]): Uint8Array {
  const out: number[] = [...SIGNATURE];
  for (const [type, data] of chunks) {
    const n = data.length;
    out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    out.push(...Array.from(type, (c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0);
  }
  return new Uint8Array(out);
}

const PLAIN: [string, number[]][] = [
  ["IHDR", new Array<number>(13).fill(0)],
  ["sRGB", [0]],
  ["IDAT", [1, 2, 3]],
  ["IDAT", [4]],
  ["IEND", []],
];

// Why these tests matter: the saved frames are handed over in a chat, so
// they must carry pixels and nothing else: no EXIF block (where a camera
// app puts a location), no text and no time chunk. The page checks every
// file it offers with this walk and refuses one that carries more.
describe("pngChunkTypes", () => {
  it("lists the chunk types in order", () => {
    expect(pngChunkTypes(png(...PLAIN))).toEqual([
      "IHDR",
      "sRGB",
      "IDAT",
      "IDAT",
      "IEND",
    ]);
  });

  it("refuses bytes that are not a PNG", () => {
    expect(() => pngChunkTypes(new Uint8Array([1, 2, 3]))).toThrow("not a PNG");
  });

  it("refuses a chunk that runs past the end", () => {
    const bytes = png(...PLAIN).slice(0, 40);
    expect(() => pngChunkTypes(bytes)).toThrow("truncated");
  });
});

describe("assertPlainPng", () => {
  it("accepts a PNG of image chunks only", () => {
    expect(() => assertPlainPng(png(...PLAIN), "frame A")).not.toThrow();
  });

  it.each(["eXIf", "tEXt", "iTXt", "zTXt", "tIME", "abCd"])(
    "refuses a PNG with a %s chunk",
    (type) => {
      const chunks: [string, number[]][] = [
        PLAIN[0]!,
        [type, [1, 2]],
        ...PLAIN.slice(1),
      ];
      expect(() => assertPlainPng(png(...chunks), "frame A")).toThrow(
        `frame A: PNG carries a ${type} chunk`,
      );
    },
  );

  it("refuses a PNG without an end chunk", () => {
    expect(() => assertPlainPng(png(...PLAIN.slice(0, 3)), "frame B")).toThrow(
      "frame B: PNG has no IEND",
    );
  });
});

const DEVICE: DeviceInfo = {
  userAgent: "UA",
  model: "Phone",
  platformVersion: "17",
  hardwareConcurrency: 8,
  deviceMemoryGb: 8,
  crossOriginIsolated: false,
  jspi: true,
  screen: "412x915 @2.6",
  webgpu: "qualcomm adreno",
};

// Why these tests matter: the JSON travels with the frames, so its fields
// are a fixed list: sizes, brightness and the device, and no time, place
// or anything else a later change might add by accident.
describe("framesInfo", () => {
  const a = makeFrame(
    2,
    1,
    new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
  );
  const b = makeFrame(1, 1, new Uint8ClampedArray([10, 10, 10, 255]));
  const info = JSON.parse(
    framesInfo(
      [
        { name: "A", frame: a, source: { width: 4, height: 2 } },
        { name: "B", frame: b, source: { width: 4, height: 2 } },
      ],
      DEVICE,
      1280,
    ),
  ) as Record<string, unknown>;

  it("holds exactly the listed fields", () => {
    expect(Object.keys(info).sort()).toEqual(
      ["captureMaxLongEdge", "device", "format", "frames"].sort(),
    );
    expect(info.format).toBe("feature-match-frames/1");
    expect(info.captureMaxLongEdge).toBe(1280);
    expect(info.device).toEqual(DEVICE);
  });

  it("describes each frame by file, size, camera size and grey values", () => {
    expect(info.frames).toEqual([
      {
        name: "A",
        file: FRAME_FILES.A,
        width: 2,
        height: 1,
        sourceWidth: 4,
        sourceHeight: 2,
        greyMean: 127.5,
        greySd: 127.5,
      },
      {
        name: "B",
        file: FRAME_FILES.B,
        width: 1,
        height: 1,
        sourceWidth: 4,
        sourceHeight: 2,
        greyMean: 10,
        greySd: 0,
      },
    ]);
  });

  it("names no time or place anywhere", () => {
    const text = framesInfo(
      [{ name: "A", frame: a, source: { width: 2, height: 1 } }],
      DEVICE,
      1280,
    );
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (v !== null && typeof v === "object") {
        for (const [k, w] of Object.entries(v)) {
          keys.push(k);
          walk(w);
        }
      }
    };
    walk(JSON.parse(text));
    expect(keys.length).toBeGreaterThan(5);
    expect(
      keys.filter((k) =>
        /time|date|^lat|latitude|^lon|^lng|longitude|gps|location|exif|geo/i.test(
          k,
        ),
      ),
    ).toEqual([]);
  });
});

const size = (over: Partial<SizeResult>): SizeResult => ({
  longEdge: 4,
  width: 4,
  height: 2,
  extract: summarize([1]),
  match: summarize([1]),
  keypoints: 2,
  descriptorBytes: 0,
  matches: 1,
  correct: null,
  sample: {
    a: { x: new Float32Array([0, 3]), y: new Float32Array([0, 1]) },
    b: { x: new Float32Array([1.5]), y: new Float32Array([0.5]) },
    pairs: new Int32Array([1, 0]),
  },
  error: null,
  ...over,
});

const method = (
  sizes: SizeResult[],
  error: string | null = null,
): MethodResult => ({
  id: "m",
  label: "M",
  backend: "webgpu",
  downloads: [],
  initMs: 1,
  notes: [],
  sizes,
  error,
});

interface SavedSize {
  readonly keypointsA: number[][];
  readonly [k: string]: unknown;
}
interface SavedMatches {
  readonly methods: {
    readonly id: string;
    readonly label: string;
    readonly backend: string;
    readonly error: string | null;
    readonly sizes: SavedSize[];
  }[];
  readonly [k: string]: unknown;
}

// Why these tests matter: the keypoints and matches are saved so they can
// be checked offline against the saved frames; a coordinate left in the
// pixels of a smaller size makes that check measure nothing. The file also
// must carry no device, time or place: it travels with the frames.
describe("matchesInfo", () => {
  const frames = { a: { width: 8, height: 4 }, b: { width: 8, height: 4 } };
  const read = (results: MethodResult[], f = frames): SavedMatches =>
    JSON.parse(matchesInfo(results, f)) as SavedMatches;

  it("holds the fixed fields and no device, time or place", () => {
    const info = read([method([size({})])]);
    expect(Object.keys(info).sort()).toEqual(
      ["coordinates", "format", "frames", "methods"].sort(),
    );
    expect(info.format).toBe("feature-match-matches/1");
    expect(info.frames).toEqual({
      A: { file: FRAME_FILES.A, width: 8, height: 4 },
      B: { file: FRAME_FILES.B, width: 8, height: 4 },
    });
  });

  it("maps keypoints from the size computed to the saved frame's pixels", () => {
    const m = read([method([size({})])]).methods[0]!;
    expect([m.id, m.label, m.backend, m.error]).toEqual([
      "m",
      "M",
      "webgpu",
      null,
    ]);
    expect(m.sizes[0]).toEqual({
      longEdge: 4,
      width: 4,
      height: 2,
      error: null,
      // Size 4x2 to frame 8x4: (v + 0.5) * 2 - 0.5.
      keypointsA: [
        [0.5, 0.5],
        [6.5, 2.5],
      ],
      keypointsB: [[3.5, 1.5]],
      matches: [[1, 0]],
    });
  });

  it("keeps a failed size and a failed method with their errors and no points", () => {
    const info = read([
      method([size({ error: "out of memory", sample: null })]),
      method([], "init: HTTP 404"),
    ]);
    expect(info.methods[0]!.sizes[0]).toMatchObject({
      error: "out of memory",
      keypointsA: [],
      keypointsB: [],
      matches: [],
    });
    expect(info.methods[1]).toMatchObject({
      error: "init: HTTP 404",
      sizes: [],
    });
  });

  it("maps any point like the resize does, to 0.005 px, inside the frame", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (w, h, fw, fh, u, v) => {
          const x = Math.fround(u * (w - 1));
          const y = Math.fround(v * (h - 1));
          const s = size({
            width: w,
            height: h,
            sample: {
              a: { x: new Float32Array([x]), y: new Float32Array([y]) },
              b: { x: new Float32Array(0), y: new Float32Array(0) },
              pairs: new Int32Array(0),
            },
          });
          const fr = { width: fw, height: fh };
          const [mx, my] = read([method([s])], { a: fr, b: fr }).methods[0]!
            .sizes[0]!.keypointsA[0]!;
          expect(Math.abs(mx! - toFramePoint(x, w, fw))).toBeLessThan(0.0051);
          expect(Math.abs(my! - toFramePoint(y, h, fh))).toBeLessThan(0.0051);
          expect(mx!).toBeGreaterThanOrEqual(-0.5);
          expect(mx!).toBeLessThanOrEqual(fw - 0.5);
        },
      ),
    );
  });
});
