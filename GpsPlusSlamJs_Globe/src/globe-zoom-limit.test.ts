/**
 * The controls' zoom-out limit (round-5 plan 2026-10-01-0945 §3.1,
 * DEC-GL5-1).
 *
 * Why this test matters: 3d-tiles-renderer 0.5.3 has no public setting for
 * how far its GlobeControls zoom out; the limit is the private method
 * `_getMaxPerspectiveDistance` (2 x the larger of R / tan(fov / 2) per
 * axis: about 27,400 km at 50 degrees on 16:9), used by the zoom and the
 * flight. The lab overrides it on the instance, so a library bump that
 * renames or stops calling it must fail HERE, loudly, rather than leave
 * the globe silently capped at half the decided distance.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { GlobeControls } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { limitGlobeZoomOut } from "./globe-zoom-limit.js";

/** The private method, as the library has it (not in its typings). */
type WithLimit = { _getMaxPerspectiveDistance: () => number };
const proto = GlobeControls.prototype as unknown as WithLimit;

describe("the library's private zoom-out limit (a guard)", () => {
  it("is still a method of GlobeControls, called by the zoom and the flight", () => {
    expect(typeof proto._getMaxPerspectiveDistance).toBe("function");
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "node_modules",
        "3d-tiles-renderer",
        "src",
        "three",
        "renderer",
        "controls",
        "GlobeControls.js",
      ),
      "utf8",
    );
    const calls = source.match(/this\._getMaxPerspectiveDistance\(\)/g) ?? [];
    expect(calls.length).toBe(2);
  });
});

describe("limitGlobeZoomOut", () => {
  it("makes the instance's limit the given distance from the centre", () => {
    const controls = new GlobeControls(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
    );
    limitGlobeZoomOut(controls, 50_000_000);
    const limited = controls as unknown as WithLimit;
    expect(limited._getMaxPerspectiveDistance()).toBe(50_000_000);
    // The prototype is untouched: other instances keep the library's.
    expect(proto._getMaxPerspectiveDistance).not.toBe(
      limited._getMaxPerspectiveDistance,
    );
    controls.dispose();
  });

  it("refuses a distance that is not positive and finite", () => {
    const controls = new GlobeControls(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
    );
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      expect(() => limitGlobeZoomOut(controls, bad)).toThrow(RangeError);
    }
    controls.dispose();
  });
});
