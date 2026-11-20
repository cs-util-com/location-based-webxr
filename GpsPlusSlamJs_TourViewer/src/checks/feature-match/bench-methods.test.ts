import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  backendsFrom,
  buildMethods,
  parseRuns,
  precisionsFrom,
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
        fc.subarray<Backend>(["webgpu", "wasm"]),
        fc.subarray<XFeatPrecision>(["fp16", "fp32"]),
        (sift, xfeat, aliked, backends, precisions) => {
          const s = { sift, xfeat, aliked, backends, precisions };
          const ids = buildMethods(s, deps).map((m) => m.id);
          const runs = (prefix: string) =>
            ids.some((id) => id.startsWith(prefix));
          const everyTickedRuns =
            (!sift || runs("sift")) &&
            (!xfeat || runs("xfeat")) &&
            (!aliked || runs("aliked"));
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
