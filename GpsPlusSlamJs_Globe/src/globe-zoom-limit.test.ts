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

import { orbitDistanceToFit } from "./globe-camera.js";
import {
  GLOBE_ZOOM_OUT,
  globeZoomOutLimitM,
  libraryZoomOutM,
  limitGlobeZoomOut,
} from "./globe-zoom-limit.js";

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

/** A library GlobeControls on a camera of this field of view and aspect. */
function controlsFor(fovYDeg: number, aspect: number) {
  const camera = new THREE.PerspectiveCamera(fovYDeg, aspect);
  return new GlobeControls(new THREE.Scene(), camera);
}

const R = 6_378_137;
/** The lab's fit: the disc filling 90 % of the narrower half. */
const fitM = (fovYDeg: number, aspect: number) =>
  orbitDistanceToFit({
    fovYRad: (fovYDeg * Math.PI) / 180,
    aspect,
    margin: 0.1,
    radius: R,
  });
const PORTRAIT = 390 / 844;
const LANDSCAPE = 16 / 9;

describe("libraryZoomOutM", () => {
  // Why: the limit must never fall below the library's own (review
  // 2026-10-01-2124 Major 1), so the formula is replicated at the lab's
  // fovY rather than read from the camera mid-flight (whose fov the
  // fly-in varies); this pins it to the library's own method.
  it("equals the library's own limit for that camera", () => {
    for (const [fov, aspect] of [
      [50, PORTRAIT],
      [50, LANDSCAPE],
      [20, PORTRAIT],
      [80, 1],
    ] as const) {
      const controls = controlsFor(fov, aspect);
      const own = (
        controls as unknown as WithLimit
      )._getMaxPerspectiveDistance();
      expect(libraryZoomOutM({ radiusM: R, fovYDeg: fov, aspect })).toBeCloseTo(
        own,
        3,
      );
      controls.dispose();
    }
  });
});

describe("globeZoomOutLimitM", () => {
  // Why (review 2026-10-01-2124 Major 1): a fixed 50,000 km cut the
  // library's own portrait limit (about 59,200 km on 390x844 at fovY 50)
  // and left the fly-in only 1.5x the fit; at fovY 20 the fit itself
  // exceeds 50,000 km. The limit is the largest of the decided distance,
  // the library's and twice the fit.
  it("is never below the library's limit or twice the fit; landscape keeps 50,000 km", () => {
    const at = (fov: number, aspect: number) =>
      globeZoomOutLimitM({
        maxM: 50_000_000,
        radiusM: R,
        fovYDeg: fov,
        aspect,
        fitM: fitM(fov, aspect),
      });
    expect(GLOBE_ZOOM_OUT.fitFactor).toBe(2);
    // Portrait 390x844 at 50 degrees: fit 33,502 km, library 59,201 km.
    expect(fitM(50, PORTRAIT) / 1000).toBeCloseTo(33_502, 0);
    expect(
      libraryZoomOutM({ radiusM: R, fovYDeg: 50, aspect: PORTRAIT }) / 1000,
    ).toBeCloseTo(59_201, 0);
    expect(at(50, PORTRAIT)).toBeCloseTo(2 * fitM(50, PORTRAIT), 3);
    // Portrait at 20 degrees: the fit alone is past 50,000 km.
    expect(fitM(20, PORTRAIT)).toBeGreaterThan(50_000_000);
    expect(at(20, PORTRAIT)).toBeGreaterThanOrEqual(2 * fitM(20, PORTRAIT));
    // 16:9 at 50 degrees: the decided 50,000 km stands.
    expect(at(50, LANDSCAPE)).toBe(50_000_000);
    for (const [fov, aspect] of [
      [50, PORTRAIT],
      [20, PORTRAIT],
      [50, LANDSCAPE],
      [80, 0.5],
    ] as const) {
      const limit = at(fov, aspect);
      expect(limit).toBeGreaterThanOrEqual(
        libraryZoomOutM({ radiusM: R, fovYDeg: fov, aspect }),
      );
      expect(limit).toBeGreaterThanOrEqual(2 * fitM(fov, aspect));
      expect(limit).toBeGreaterThanOrEqual(50_000_000);
    }
  });

  it("refuses inputs that are not positive and finite", () => {
    const ok = {
      maxM: 50_000_000,
      radiusM: R,
      fovYDeg: 50,
      aspect: 1,
      fitM: 20_000_000,
    };
    for (const bad of [
      { ...ok, maxM: 0 },
      { ...ok, radiusM: Number.NaN },
      { ...ok, fovYDeg: 180 },
      { ...ok, aspect: -1 },
      { ...ok, fitM: Infinity },
    ]) {
      expect(() => globeZoomOutLimitM(bad)).toThrow(RangeError);
    }
  });
});

describe("limitGlobeZoomOut", () => {
  // Why: the limit follows the screen (a rotation, a resize) and the lab's
  // fovY, so the instance asks for it on every call rather than holding a
  // number set once.
  it("makes the instance's limit whatever the getter says at each call", () => {
    const controls = controlsFor(50, 1);
    let limit = 50_000_000;
    limitGlobeZoomOut(controls, () => limit);
    const limited = controls as unknown as WithLimit;
    expect(limited._getMaxPerspectiveDistance()).toBe(50_000_000);
    limit = 67_000_000;
    expect(limited._getMaxPerspectiveDistance()).toBe(67_000_000);
    // The prototype is untouched: other instances keep the library's.
    expect(proto._getMaxPerspectiveDistance).not.toBe(
      limited._getMaxPerspectiveDistance,
    );
    controls.dispose();
  });

  it("falls back to the library's own limit when the getter's value is not usable", () => {
    const controls = controlsFor(50, 1);
    const own = (controls as unknown as WithLimit)._getMaxPerspectiveDistance();
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      limitGlobeZoomOut(controls, () => bad);
      expect(
        (controls as unknown as WithLimit)._getMaxPerspectiveDistance(),
      ).toBe(own);
    }
    expect(() =>
      limitGlobeZoomOut(controls, 5 as unknown as () => number),
    ).toThrow(TypeError);
    controls.dispose();
  });
});
