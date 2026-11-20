import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";

import {
  FRAME_FILES,
  allFilesZip,
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
