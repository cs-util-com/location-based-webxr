/**
 * Tests for the map-zoom → 3D-camera-distance conversion (H2, Q6).
 *
 * Why these tests matter: the map's +/- buttons now drive the 3D view, and the
 * conversion is the only part with arithmetic in it. Two properties carry the
 * whole feature — that the two views agree about how much ground is on screen,
 * and that the clamp holds. The clamp is not decoration: Leaflet has no
 * `minZoom` here, so zooming fully out asks for a ~36 km camera, which is past
 * the 2400 m far plane and renders an empty grey screen.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  cameraDistanceForZoom,
  MAX_CAMERA_DISTANCE_M,
  MIN_CAMERA_DISTANCE_M,
} from "./map-zoom-to-camera";

const BASE = {
  latDeg: 50.94,
  paneWidthPx: 800,
  aspect: 16 / 9,
  vfovDeg: 55,
};

describe("cameraDistanceForZoom", () => {
  it("halves the distance when the map zooms in one step", () => {
    // THE PROPERTY THE FEATURE IS FOR. A zoom level doubles the scale, so the
    // ground width halves, so the camera must come to half the distance for the
    // two views to show the same extent. Asserted as a RATIO rather than two
    // absolute numbers, because the ratio is what "the views agree" means and
    // it survives any later change to the FOV or the pane width.
    const far = cameraDistanceForZoom({ ...BASE, zoom: 16 });
    const near = cameraDistanceForZoom({ ...BASE, zoom: 17 });
    expect(near / far).toBeCloseTo(0.5, 6);
  });

  it("puts a typical city zoom at a plausible camera distance", () => {
    // A SANITY ANCHOR against a sign error or a factor of two, which the ratio
    // test above cannot catch — both halves would be wrong together.
    // z17 over an 800 px pane at 50.94°N covers roughly 600 m of ground.
    const d = cameraDistanceForZoom({ ...BASE, zoom: 17 });
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(900);
  });

  it("clamps the fully-zoomed-out case instead of asking for 36 km", () => {
    // The reported hazard: Leaflet has no minZoom here, so z10 asks for a
    // camera far past the 2400 m far plane and the user gets a grey screen.
    const d = cameraDistanceForZoom({ ...BASE, zoom: 10 });
    expect(d).toBe(MAX_CAMERA_DISTANCE_M);
    // And the clamp must actually sit inside the far plane, not merely exist.
    expect(MAX_CAMERA_DISTANCE_M).toBeLessThan(2400);
  });

  it("clamps the fully-zoomed-in case rather than putting the camera inside a wall", () => {
    expect(cameraDistanceForZoom({ ...BASE, zoom: 24 })).toBe(
      MIN_CAMERA_DISTANCE_M,
    );
  });

  it("widens the camera when the pane is wider, at the same zoom", () => {
    // The pane width is in the formula for a reason: the same zoom on a phone
    // and on a desktop shows different amounts of ground, and the 3D view has
    // to follow the ground extent, not the zoom number.
    const narrow = cameraDistanceForZoom({
      ...BASE,
      zoom: 17,
      paneWidthPx: 400,
    });
    const wide = cameraDistanceForZoom({
      ...BASE,
      zoom: 17,
      paneWidthPx: 1200,
    });
    expect(wide).toBeGreaterThan(narrow);
  });

  it("needs less distance for a wider aspect at the same ground width", () => {
    // A wider viewport sees more horizontally at a given distance, so covering
    // the same ground takes a CLOSER camera. Getting this backwards is the
    // easiest sign error available here.
    const square = cameraDistanceForZoom({ ...BASE, zoom: 17, aspect: 1 });
    const wide = cameraDistanceForZoom({ ...BASE, zoom: 17, aspect: 2 });
    expect(wide).toBeLessThan(square);
  });

  it("never returns a non-finite or out-of-range distance, for any input", () => {
    // Leaflet's zoom is a number from a library, the pane width comes from
    // layout, and a container that is display:none reports 0. Any of those can
    // reach here, and a NaN would put the camera at an undefined position with
    // no error anywhere.
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -50, max: 50, noNaN: true }),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
        ),
        fc.oneof(
          fc.double({ min: 0, max: 5000, noNaN: true }),
          fc.constant(Number.NaN),
        ),
        fc.oneof(
          fc.double({ min: 0, max: 10, noNaN: true }),
          fc.constant(Number.NaN),
        ),
        fc.double({ min: -89.9, max: 89.9, noNaN: true }),
        (zoom, paneWidthPx, aspect, latDeg) => {
          const d = cameraDistanceForZoom({
            ...BASE,
            zoom,
            paneWidthPx,
            aspect,
            latDeg,
          });
          expect(Number.isFinite(d)).toBe(true);
          expect(d).toBeGreaterThanOrEqual(MIN_CAMERA_DISTANCE_M);
          expect(d).toBeLessThanOrEqual(MAX_CAMERA_DISTANCE_M);
        },
      ),
    );
  });

  it("is monotone: zooming in never moves the camera further away", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 8, max: 22, noNaN: true }),
        fc.double({ min: 0, max: 4, noNaN: true }),
        (zoom, step) => {
          const out = cameraDistanceForZoom({ ...BASE, zoom });
          const inn = cameraDistanceForZoom({ ...BASE, zoom: zoom + step });
          expect(inn).toBeLessThanOrEqual(out + 1e-9);
        },
      ),
    );
  });
});
