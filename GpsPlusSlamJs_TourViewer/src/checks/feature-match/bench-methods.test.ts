import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  backendsFrom,
  buildMethods,
  parseRuns,
  precisionsFrom,
  runSettings,
  selectionGaps,
  type Backend,
} from "./bench-methods";
import type { LoadDeps } from "./bench-net";
import type { XFeatPrecision } from "./method-xfeat";

const deps: LoadDeps = {
  importModule: () => Promise.reject(new Error("unused")),
  fetch: () => Promise.reject(new Error("unused")),
  now: () => 0,
  resources: () => [],
};

// Why this test matters: the list decides what a run measures; a backend
// choice applied to SIFT, or a precision applied to ALIKED, would run a
// method twice under two names that mean the same thing.
describe("buildMethods", () => {
  it("expands backends and precisions only where they apply", () => {
    const ids = buildMethods(
      {
        sift: true,
        xfeat: true,
        aliked: true,
        backends: ["webgpu", "wasm"],
        precisions: ["fp16", "fp32"],
      },
      deps,
    ).map((m) => m.id);
    expect(ids).toEqual([
      "sift",
      "xfeat-webgpu-fp16",
      "xfeat-webgpu-fp32",
      "xfeat-wasm-fp16",
      "xfeat-wasm-fp32",
      "aliked-lightglue-webgpu",
      "aliked-lightglue-wasm",
    ]);
  });

  it("adds SIFT + LightGlue per backend, last (its model is the largest download)", () => {
    const ids = buildMethods(
      {
        sift: false,
        xfeat: true,
        aliked: false,
        siftLightGlue: true,
        backends: ["webgpu", "wasm"],
        precisions: ["fp16"],
      },
      deps,
    ).map((m) => m.id);
    expect(ids).toEqual([
      "xfeat-webgpu-fp16",
      "xfeat-wasm-fp16",
      "sift-lightglue-webgpu",
      "sift-lightglue-wasm",
    ]);
  });

  // Why: the worker queue builds its methods with buildMethods too; the
  // context must reach the methods whose notes name a thread.
  it("passes the run context on to SIFT (main thread by default)", async () => {
    const sel = {
      sift: true,
      xfeat: false,
      aliked: false,
      backends: [] as Backend[],
      precisions: [] as XFeatPrecision[],
    };
    const withSift: LoadDeps = {
      ...deps,
      importModule: () =>
        Promise.resolve({
          detectSift: () => ({ n: 0, x: [], y: [], desc: new Uint8Array() }),
        }),
    };
    const backend = async (context?: "main thread" | "worker") =>
      (await buildMethods(sel, withSift, context)[0]!.init()).backend;
    expect(await backend()).toBe("js (main thread)");
    expect(await backend("worker")).toBe("js (worker)");
  });

  it("gives nothing when nothing is chosen", () => {
    expect(
      buildMethods(
        {
          sift: false,
          xfeat: false,
          aliked: false,
          backends: ["wasm"],
          precisions: ["fp16"],
        },
        deps,
      ),
    ).toEqual([]);
  });
});

// Why these tests matter: a method ticked with none of its backends (or,
// for XFeat, none of its model files) used to drop out of the run without
// a word while SIFT still ran; the page must name the gap instead.
describe("selectionGaps", () => {
  const all = {
    sift: true,
    xfeat: true,
    aliked: true,
    backends: ["webgpu", "wasm"] as Backend[],
    precisions: ["fp16", "fp32"] as XFeatPrecision[],
  };

  it("names a ticked method that has no backend or model file", () => {
    expect(selectionGaps(all)).toEqual([]);
    expect(selectionGaps({ ...all, backends: [] })).toEqual([
      "XFeat is ticked but no backend is",
      "ALIKED + LightGlue is ticked but no backend is",
    ]);
    expect(selectionGaps({ ...all, precisions: [] })).toEqual([
      "XFeat is ticked but no model file is",
    ]);
    expect(
      selectionGaps({ ...all, xfeat: false, aliked: false, backends: [] }),
    ).toEqual([]);
  });

  it("is empty exactly when every ticked method runs at least once (property)", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.subarray<Backend>(["webgpu", "wasm"]),
        fc.subarray<XFeatPrecision>(["fp16", "fp32"]),
        (sift, xfeat, aliked, siftLightGlue, backends, precisions) => {
          const s = {
            sift,
            xfeat,
            aliked,
            siftLightGlue,
            backends,
            precisions,
          };
          const ids = buildMethods(s, deps).map((m) => m.id);
          const runs = (prefix: string) =>
            ids.some((id) => id.startsWith(prefix));
          const everyTickedRuns =
            (!sift || ids.includes("sift")) &&
            (!xfeat || runs("xfeat")) &&
            (!aliked || runs("aliked")) &&
            (!siftLightGlue || runs("sift-lightglue"));
          expect(selectionGaps(s).length === 0).toBe(everyTickedRuns);
        },
      ),
    );
  });
});

// Why these tests matter: the form's strings decide what runs; an unknown
// value must fail loudly, and a typo in the runs field must fall back to
// the default rather than run zero or a thousand times.
describe("form values", () => {
  it("keeps the ticked boxes in a fixed order and refuses unknown values", () => {
    expect(backendsFrom(["wasm", "webgpu"])).toEqual(["webgpu", "wasm"]);
    expect(backendsFrom(["wasm"])).toEqual(["wasm"]);
    expect(backendsFrom([])).toEqual([]);
    expect(() => backendsFrom(["webnn"])).toThrow(RangeError);
    expect(precisionsFrom(["fp32", "fp16"])).toEqual(["fp16", "fp32"]);
    expect(() => precisionsFrom(["int8"])).toThrow(RangeError);
  });

  it("keeps runs between 1 and 50", () => {
    expect(parseRuns("7")).toBe(7);
    for (const bad of ["0", "51", "2.5", "", "x"]) {
      expect(parseRuns(bad)).toBe(5);
    }
  });
});

// Why these tests matter: the photo tests must not depend on the tester
// setting Options (a first zip ran 5 runs after a warm-up on both backends
// with both XFeat files); a picked pair sets the run itself, and the log
// line must say what was used, including the WASM fallback.
describe("runSettings", () => {
  const options = {
    backends: ["webgpu", "wasm"] as Backend[],
    precisions: ["fp16", "fp32"] as XFeatPrecision[],
    runs: 5,
  };

  it("sets one run, no warm-up, WebGPU and one XFeat file for a picked pair", () => {
    expect(runSettings({ ...options, pair: "1b" }, true)).toEqual({
      photoTest: true,
      backends: ["webgpu"],
      precisions: ["fp16"],
      runs: 1,
      warmup: false,
      line: "runs: 1, no warm-up, backends webgpu, XFeat files fp16 (photo test 1b)",
    });
  });

  it("falls back to WASM where WebGPU is missing, and says so", () => {
    const s = runSettings({ ...options, pair: "4d" }, false);
    expect(s.backends).toEqual(["wasm"]);
    expect(s.line).toBe(
      "runs: 1, no warm-up, backends wasm (no WebGPU on this device), XFeat files fp16 (photo test 4d)",
    );
  });

  it("uses the Options for a manual run or no pair", () => {
    for (const pair of ["none", null]) {
      expect(runSettings({ ...options, pair }, true)).toEqual({
        photoTest: false,
        ...options,
        warmup: true,
        line: "runs: 5 after 1 warm-up, backends webgpu+wasm, XFeat files fp16+fp32 (Options)",
      });
    }
    expect(
      runSettings({ backends: [], precisions: [], runs: 1, pair: null }, true)
        .line,
    ).toBe(
      "runs: 1 after 1 warm-up, backends none, XFeat files none (Options)",
    );
  });
});
