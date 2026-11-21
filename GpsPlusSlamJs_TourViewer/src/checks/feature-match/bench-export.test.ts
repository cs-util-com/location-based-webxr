import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";

import {
  FRAME_FILES,
  NO_PAIR,
  PAIRS,
  allFilesZip,
  assertPlainPng,
  framesInfo,
  matchesInfo,
  nextPair,
  pairFileNames,
  pairTag,
  parseSpot,
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

const TAG = pairTag("1b", 2, 3);

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
      TAG,
    ),
  ) as Record<string, unknown>;

  it("holds exactly the listed fields", () => {
    expect(Object.keys(info).sort()).toEqual(
      [
        "captureMaxLongEdge",
        "device",
        "format",
        "frames",
        "pair",
        "pairLabel",
        "spot",
        "sequence",
      ].sort(),
    );
    expect(info.format).toBe("feature-match-frames/1");
    expect(info.captureMaxLongEdge).toBe(1280);
    expect(info.device).toEqual(DEVICE);
  });

  // Why this test matters: the photos are scored offline per pair, and
  // nobody writes down the order they were taken in; the JSON inside each
  // zip is what says which pair it holds.
  it("names the pair, its label, the spot and the running number", () => {
    expect([info.pair, info.pairLabel, info.spot, info.sequence]).toEqual([
      "1b",
      "light: dimmed",
      2,
      3,
    ]);
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
      TAG,
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
      "2b",
      "2c",
      "2d",
      "3a",
      "3b",
      "3c",
      "4a",
      "4b",
      "4c",
      "4d",
      "x",
    ]);
    expect(PAIRS[1]).toEqual({ key: "1b", label: "light: dimmed" });
    expect(PAIRS.at(-1)).toEqual({ key: "x", label: "other" });
  });

  it("names every file by running number, pair key, spot and label", () => {
    expect(pairFileNames(pairTag("1b", 2, 3))).toEqual({
      all: "feature-match-03-1b-s2-light-dimmed.zip",
      A: "feature-match-03-1b-s2-light-dimmed-frame-a.png",
      B: "feature-match-03-1b-s2-light-dimmed-frame-b.png",
      info: "feature-match-03-1b-s2-light-dimmed-frames.json",
      matches: "feature-match-03-1b-s2-light-dimmed-matches.json",
    });
    expect(pairFileNames(pairTag("3b", 1, 12)).all).toBe(
      "feature-match-12-3b-s1-distance-1-5-m-to-3-m.zip",
    );
    expect(pairFileNames(pairTag("2d", 1, 140)).all).toBe(
      "feature-match-140-2d-s1-rotation-tilted-30-45-deg.zip",
    );
  });

  it("gives ASCII names without spaces, unique across running numbers", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 9999 }), {
          minLength: 2,
          maxLength: 20,
        }),
        fc.constantFrom(...PAIRS.map((p) => p.key)),
        fc.integer({ min: 1, max: 3 }),
        (sequences, key, spot) => {
          const all = sequences.flatMap((n) =>
            Object.values(pairFileNames(pairTag(key, spot, n))),
          );
          expect(new Set(all).size).toBe(all.length);
          for (const name of all) {
            expect(name).toMatch(/^feature-match-[a-z0-9.-]+$/);
            expect(name).not.toMatch(/--/);
          }
        },
      ),
    );
  });

  // Why this test matters: inside the zip the entries keep their fixed
  // names, so a tool reading any zip finds the same entries; the pair's
  // own download names must never clash with them.
  it("keeps the pair's names apart from the names inside the zip", () => {
    const own = Object.values(pairFileNames(pairTag("1a", 1, 1)));
    for (const inner of Object.values(FRAME_FILES)) {
      expect(own).not.toContain(inner);
    }
  });

  // Why this test matters: "none" is the manual run that uses the Options;
  // its files must still be named, and the selector must not move on from
  // it into the protocol by itself.
  it("tags and names a manual run, and stays on it", () => {
    const tag = pairTag(NO_PAIR.key, 1, 4);
    expect(tag.pairLabel).toBe("manual run");
    expect(pairFileNames(tag).all).toBe(
      "feature-match-04-none-s1-manual-run.zip",
    );
    expect(nextPair(NO_PAIR.key, 1)).toEqual({ key: "none", spot: 1 });
  });

  it("refuses an unknown key, a spot outside 1-3 and a bad running number", () => {
    expect(() => pairTag("9z", 1, 1)).toThrow("unknown pair 9z");
    expect(() => pairTag("1a", 4, 1)).toThrow("spot");
    expect(() => pairTag("1a", 1.5, 1)).toThrow("spot");
    expect(() => pairTag("1a", 1, 0)).toThrow("sequence");
  });

  it("reads the spot field, any bad value as spot 1", () => {
    expect(parseSpot("2")).toBe(2);
    expect(parseSpot("3")).toBe(3);
    for (const bad of ["", "0", "4", "1.5", "x", "-1"]) {
      expect(parseSpot(bad)).toBe(1);
    }
  });

  // Why this test matters: the selector moves on by itself after each
  // save, so the next pair is ready without a tap; the light pairs are
  // repeated at three spots before the rotation pairs start.
  it("moves on to the next pair; light runs through spots 1-3 first", () => {
    expect(nextPair("1a", 1)).toEqual({ key: "1b", spot: 1 });
    expect(nextPair("1c", 1)).toEqual({ key: "1a", spot: 2 });
    expect(nextPair("1c", 2)).toEqual({ key: "1a", spot: 3 });
    expect(nextPair("1c", 3)).toEqual({ key: "2a", spot: 1 });
    expect(nextPair("2d", 1)).toEqual({ key: "3a", spot: 1 });
    expect(nextPair("4d", 1)).toEqual({ key: "x", spot: 1 });
    expect(nextPair("x", 2)).toEqual({ key: "x", spot: 2 });
  });

  it("walks the whole list from 1a spot 1 in 20 steps to other", () => {
    let at = { key: "1a", spot: 1 };
    const seen: string[] = [];
    for (let i = 0; i < 21; i++) {
      seen.push(`${at.key}-s${String(at.spot)}`);
      at = nextPair(at.key, at.spot);
    }
    expect(seen.slice(0, 10)).toEqual([
      "1a-s1",
      "1b-s1",
      "1c-s1",
      "1a-s2",
      "1b-s2",
      "1c-s2",
      "1a-s3",
      "1b-s3",
      "1c-s3",
      "2a-s1",
    ]);
    expect(seen.at(-1)).toBe("x-s1");
    expect(new Set(seen).size).toBe(21);
  });
});
