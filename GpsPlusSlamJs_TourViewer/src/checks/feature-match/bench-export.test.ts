import { describe, expect, it } from "vitest";

import {
  FRAME_FILES,
  assertPlainPng,
  framesInfo,
  pngChunkTypes,
} from "./bench-export";
import { makeFrame } from "./bench-image";
import type { DeviceInfo } from "./bench-report";

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
