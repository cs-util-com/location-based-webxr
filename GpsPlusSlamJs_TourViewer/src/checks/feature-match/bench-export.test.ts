import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";

import {
  FRAME_FILES,
  PAIRS,
  allFilesZip,
  assertPlainPng,
  LIGHT_CONTROL_TOLERANCE,
  LIGHT_DARKER_RATIO,
  lightCheck,
  LIGHT_FLOOR_A,
  LIGHT_FLOOR_B,
  matchesInfo,
  pngChunkTypes,
  sessionToken,
} from "./bench-export";
import { toFramePoint } from "./bench-image";
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

  // Why this test matters: another browser's encoder may add chunks that
  // describe the pixels (density, significant bits, background, colour
  // coding) and carry no device, time or place; refusing them would make
  // Save fail on that browser for no privacy gain.
  it.each(["pHYs", "sBIT", "bKGD", "cICP", "cLLI", "mDCV"])(
    "accepts a PNG with a %s chunk",
    (type) => {
      const chunks: [string, number[]][] = [
        PLAIN[0]!,
        [type, [1, 2]],
        ...PLAIN.slice(1),
      ];
      expect(() => assertPlainPng(png(...chunks), "frame A")).not.toThrow();
    },
  );

  it("refuses a PNG without an end chunk", () => {
    expect(() => assertPlainPng(png(...PLAIN.slice(0, 3)), "frame B")).toThrow(
      "frame B: PNG has no IEND",
    );
  });
});

// Why these tests matter: a light pair whose photo B is as bright as its
// photo A (the light was dimmed before A instead of between A and B)
// measures nothing about light, and was only seen in the saved numbers
// after the evening. The check flags it at photo B, and the control pair
// the other way round: its light must not change.
describe("lightCheck", () => {
  it("names the thresholds", () => {
    expect(LIGHT_DARKER_RATIO).toBe(0.8);
    expect(LIGHT_CONTROL_TOLERANCE).toBe(0.2);
    expect(LIGHT_FLOOR_A).toBe(10);
    expect(LIGHT_FLOOR_B).toBe(3);
  });

  it.each([
    // [pair, mean A, mean B, result]
    ["1b", 100, 70, "ok"],
    ["1b", 100, 80, "ok"],
    ["1b", 100, 90, "not-darker"],
    ["1c", 100, 70, "ok"],
    ["1c", 100, 80, "ok"],
    ["1c", 100, 90, "not-darker"],
    ["1b", 41.2, 41.2, "not-darker"],
    ["1c", 23.2, 23.3, "not-darker"],
    ["1b", 100, 130, "not-darker"],
    // The tester's real, correctly dimmed pairs: B at 0.68 and 0.45 of A.
    ["1b", 107, 72.8, "ok"],
    ["1c", 107, 48.2, "ok"],
    // A black photo A measures no dimming; a black photo B nothing at all.
    ["1b", 0, 0, "too-dark-a"],
    ["1b", 9.9, 5, "too-dark-a"],
    ["1b", 10, 5, "ok"],
    ["1c", 9, 2, "too-dark-a"],
    ["1c", 50, 2.9, "too-dark-b"],
    ["1c", 50, 3, "ok"],
    // Both dimmed pairs refuse a black photo B: dimmed or dark, a black
    // frame has nothing to match.
    ["1b", 50, 2, "too-dark-b"],
    ["1b", 50, 2.9, "too-dark-b"],
    ["1b", 50, 3, "ok"],
    ["1a", 100, 100, "ok"],
    ["1a", 100, 80, "ok"],
    ["1a", 100, 120, "ok"],
    ["1a", 100, 79, "changed"],
    ["1a", 100, 121, "changed"],
    // Below a mean of 10 the control allows 3 grey levels, not 20 %.
    ["1a", 0, 0, "ok"],
    ["1a", 0, 3, "ok"],
    ["1a", 0, 3.1, "changed"],
    ["1a", 5, 8.5, "changed"],
    ["1a", 9, 11.9, "ok"],
    ["1a", 0, 5, "changed"],
  ])("%s with grey means %d and %d is %s", (pair, a, b, result) => {
    expect(lightCheck(pair, a, b)).toBe(result);
  });

  it("checks the light pairs only", () => {
    for (const p of PAIRS.filter((q) => !q.key.startsWith("1"))) {
      expect(lightCheck(p.key, 100, 10)).toBeNull();
    }
    expect(lightCheck("none", 100, 10)).toBeNull();
  });

  it("refuses grey means that are not numbers from 0 to 255", () => {
    expect(() => lightCheck("1b", NaN, 10)).toThrow(RangeError);
    expect(() => lightCheck("1b", 10, -1)).toThrow(RangeError);
    expect(() => lightCheck("1b", 256, 10)).toThrow(RangeError);
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

  // Why: in the run zip the frames are the shot files, not fixed names,
  // and the PC must know what ran beside the measuring and what was
  // ticked, or it compares timings that do not compare.
  it("names the shot files and says how the pair was measured", () => {
    const info = JSON.parse(
      matchesInfo([method([size({})])], frames, {
        files: { a: "shots/flat-s1/F1-t1.png", b: "shots/flat-s1/F2-t2.png" },
        context: "beside-camera",
        hidden: false,
        settings: "runs: 1, no warm-up, backends wasm",
        methods: { sift: true, aliked: false, siftLightGlue: true },
        sizes: [640, 1024],
      }),
    ) as SavedMatches;
    expect(info.frames).toEqual({
      A: { file: "shots/flat-s1/F1-t1.png", width: 8, height: 4 },
      B: { file: "shots/flat-s1/F2-t2.png", width: 8, height: 4 },
    });
    expect(info.measured).toEqual({
      context: "beside-camera",
      hidden: false,
      settings: "runs: 1, no warm-up, backends wasm",
      methods: { sift: true, aliked: false, siftLightGlue: true },
      sizes: [640, 1024],
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

  // Why this test matters: B is resized to A's computed size, so B's
  // points must be mapped back with B's own frame size; with both frames
  // the same size a mix-up of the two would pass unseen.
  it("maps B's keypoints with B's own frame size", () => {
    const m = read([method([size({})])], {
      a: { width: 8, height: 4 },
      b: { width: 16, height: 8 },
    }).methods[0]!;
    expect(m.sizes[0]).toMatchObject({
      keypointsA: [
        [0.5, 0.5],
        [6.5, 2.5],
      ],
      // Size 4x2 to frame 16x8: (v + 0.5) * 4 - 0.5.
      keypointsB: [[7.5, 3.5]],
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

/** Every entry of a zip, by name, as text. */
async function zipTexts(blob: Blob): Promise<Map<string, string>> {
  const reader = new ZipReader(new BlobReader(blob));
  const out = new Map<string, string>();
  for (const e of await reader.getEntries()) {
    if (!e.directory) {
      out.set(e.filename, await e.getData(new TextWriter()));
    }
  }
  await reader.close();
  return out;
}

describe("allFilesZip", () => {
  const files = [
    { name: FRAME_FILES.A, blob: new Blob(["png a"]) },
    { name: FRAME_FILES.B, blob: new Blob(["png b"]) },
    { name: FRAME_FILES.info, blob: new Blob(["{}"]) },
    { name: FRAME_FILES.matches, blob: new Blob(["[]"]) },
  ];

  // Why this test matters: the tester wants one download holding
  // everything a run left behind, so no file and no log line has to be
  // copied out by hand. Each entry must be the very bytes offered alone.
  it("holds every offered file, the log and the report, byte for byte", async () => {
    const zip = await allFilesZip(files, {
      log: "[0.1s] ready\n",
      report: "report text\n",
    });
    expect(zip.type).toBe("application/zip");
    const texts = await zipTexts(zip);
    expect([...texts.keys()].sort()).toEqual(
      [
        FRAME_FILES.A,
        FRAME_FILES.B,
        FRAME_FILES.info,
        FRAME_FILES.matches,
        FRAME_FILES.log,
        FRAME_FILES.report,
      ].sort(),
    );
    expect(texts.get(FRAME_FILES.A)).toBe("png a");
    expect(texts.get(FRAME_FILES.matches)).toBe("[]");
    expect(texts.get(FRAME_FILES.log)).toBe("[0.1s] ready\n");
    expect(texts.get(FRAME_FILES.report)).toBe("report text\n");
  });

  // Why this test matters: a run that measured nothing has no report; an
  // empty report file would read as a report that lost its content.
  it("leaves the report out when there is none", async () => {
    const texts = await zipTexts(
      await allFilesZip(files, { log: "x", report: "" }),
    );
    expect(texts.has(FRAME_FILES.report)).toBe(false);
    expect(texts.get(FRAME_FILES.log)).toBe("x");
  });

  // Why this test matters: the zip sits beside the files it holds, so its
  // own name must not clash with any of theirs.
  it("is named apart from every file it holds", () => {
    const names = Object.values(FRAME_FILES);
    expect(new Set(names).size).toBe(names.length);
    expect(FRAME_FILES.all.endsWith(".zip")).toBe(true);
  });
});

// Why these tests matter: the photos of one evening are taken pair after
// pair with no written list of the order, so the saved files themselves
// must say which pair they hold, and two pairs must never share a name
// (a browser would then rename one and the pair would be lost).
describe("pairs", () => {
  it("lists the protocol's pairs in order, keys unique", () => {
    expect(PAIRS.map((p) => p.key)).toEqual([
      "1a",
      "1b",
      "1c",
      "2a",
      "t0",
      "t90",
      "t180",
      "2d",
      "3b",
      "3c",
      "4b",
      "4c",
      "4d",
      "x",
    ]);
    expect(PAIRS[1]).toEqual({ key: "1b", label: "light: dimmed" });
    expect(PAIRS.at(-1)).toEqual({ key: "x", label: "other" });
  });
});

// Why this test matters: the session token tells two runs apart and names
// the run zip. It is random bytes only, no time and no place.
describe("sessionToken", () => {
  it("is the bytes as hex", () => {
    expect(sessionToken(new Uint8Array([0, 15, 160, 255]))).toBe("000fa0ff");
  });

  it("differs for different bytes", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 4, maxLength: 4 }),
        fc.uint8Array({ minLength: 4, maxLength: 4 }),
        (a, b) => {
          fc.pre(a.some((v, i) => v !== b[i]));
          expect(sessionToken(a)).not.toBe(sessionToken(b));
        },
      ),
    );
  });

  it("refuses fewer than 4 bytes", () => {
    expect(() => sessionToken(new Uint8Array(3))).toThrow(RangeError);
  });
});
