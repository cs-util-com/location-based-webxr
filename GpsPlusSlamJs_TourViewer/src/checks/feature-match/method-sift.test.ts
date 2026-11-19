import { describe, expect, it } from "vitest";

import { makeFrame } from "./bench-image";
import type { LoadDeps } from "./bench-net";
import {
  SIFT_MAX_FEATURES,
  SIFT_URL,
  siftApi,
  siftFeatures,
  siftMethod,
} from "./method-sift";

function deps(mod: unknown): LoadDeps & { imported: string[] } {
  const imported: string[] = [];
  let t = 0;
  return {
    imported,
    importModule: (url) => {
      imported.push(url);
      t += 25;
      return Promise.resolve(mod);
    },
    fetch: () => Promise.reject(new Error("no fetch in this test")),
    now: () => t,
    resources: () => [
      {
        name: SIFT_URL,
        transferSize: 5000,
        encodedBodySize: 4800,
        startTime: 1,
        responseEnd: 21,
      },
    ],
  };
}

/** Two keypoints whose descriptors differ in the first byte. */
const fakeResult = () => {
  const desc = new Uint8Array(2 * 128);
  desc[0] = 200;
  desc[128] = 10;
  return { n: 2, x: [3, 7], y: [4, 8], desc };
};

// Why these tests matter: sift.js is loaded from a CDN at runtime, so its
// shape is checked at the boundary; a wrong file must become one clear
// error, and a good one must flow through extract and match unchanged.
describe("siftApi / siftFeatures", () => {
  it("refuses a module without detectSift", () => {
    expect(() => siftApi({})).toThrow("sift.js: no detectSift export");
    expect(() => siftApi(null)).toThrow("sift.js: no detectSift export");
  });

  it("refuses a result whose buffers are shorter than n says", () => {
    expect(() =>
      siftFeatures({ n: 3, x: [1], y: [1], desc: new Uint8Array(384) }),
    ).toThrow(/malformed/);
    expect(() =>
      siftFeatures({ n: 1, x: [1], y: [1], desc: new Uint8Array(10) }),
    ).toThrow(/too short/);
  });

  it("turns a result into features with 128 bytes per keypoint", () => {
    const f = siftFeatures(fakeResult());
    expect(f.count).toBe(2);
    expect(f.descriptorBytes).toBe(256);
    expect(Array.from(f.x)).toEqual([3, 7]);
  });
});

describe("siftMethod", () => {
  it("loads the pinned file, extracts with the feature cap and matches", async () => {
    const calls: unknown[][] = [];
    const d = deps({
      detectSift: (...args: unknown[]) => {
        calls.push(args);
        return fakeResult();
      },
    });
    const runner = await siftMethod(d).init();
    expect(d.imported).toEqual([SIFT_URL]);
    expect(runner.initMs).toBe(25);
    expect(runner.downloads).toEqual([
      { label: "sift.js", bytes: 5000, ms: 20, cached: false, files: 1 },
    ]);
    const frame = makeFrame(4, 2, new Uint8ClampedArray(32));
    const a = await runner.extract(frame);
    expect(calls[0]!.slice(1)).toEqual([4, 2, SIFT_MAX_FEATURES]);
    expect(Array.from(await runner.match(a, a))).toEqual([0, 0, 1, 1]);
  });
});
