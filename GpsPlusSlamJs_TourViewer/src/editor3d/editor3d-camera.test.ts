/**
 * Why these tests matter: the 3D view opens tilted at the editor's start
 * view (148 m east, 210 m up and 177 m south of the
 * tour's centre), and that start must sit above the morph band, or the
 * first view a creator sees is the flat top-down one. The tilt the morph
 * reads is the orbit's angle from straight down in degrees; and the clip
 * planes must follow the camera's clearance over the drawn ground, or
 * the ground is clipped away close up and the far tiles vanish when high.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  EDITOR_CAMERA,
  EDITOR_CLIP,
  editorClipPlanes,
  startCameraPosition,
  tiltDegOf,
} from "./editor3d-camera.js";
import { MORPH_BAND, morphStanding } from "./editor3d-visibility.js";

/** A sphere standing in for the ellipsoid: what the clip rule reads. */
const R = 6_371_000;
const SPHERE = {
  radius: new THREE.Vector3(R, R, R),
  getPositionElevation: (p: THREE.Vector3) => p.length() - R,
} as unknown as Parameters<typeof editorClipPlanes>[0]["ellipsoid"];

describe("the editor's camera", () => {
  // Why: the editor's start view and orbit limits.
  it("starts at the editor's start view, within its limits", () => {
    expect(EDITOR_CAMERA).toMatchObject({
      fovDeg: 50,
      minDistanceM: 2.5,
      maxDistanceM: 1100,
      maxPolarAngle: 1.48,
    });
    const target = new THREE.Vector3(5, 515, -3);
    const start = startCameraPosition(target, new THREE.Vector3());
    expect(start.toArray()).toEqual([153, 725, 174]);
    const distance = start.distanceTo(target);
    expect(distance).toBeGreaterThan(EDITOR_CAMERA.minDistanceM);
    expect(distance).toBeLessThan(EDITOR_CAMERA.maxDistanceM);
  });

  // Why: the start view must be the tilted 3D one, above the morph band,
  // with a margin: the start tilt is about 47.7 degrees, the band ends at
  // 42.
  it("starts above the morph band, upright", () => {
    const offset = new THREE.Vector3(...EDITOR_CAMERA.startOffset);
    const polar = Math.acos(offset.y / offset.length());
    const tilt = tiltDegOf(polar);
    expect(tilt).toBeCloseTo(47.7, 1);
    expect(tilt).toBeGreaterThan(MORPH_BAND.toDeg);
    expect(polar).toBeLessThan(EDITOR_CAMERA.maxPolarAngle);
    expect(morphStanding(tilt)).toBe(1);
  });

  it("reads the orbit's angle from straight down in degrees", () => {
    expect(tiltDegOf(0)).toBe(0);
    expect(tiltDegOf(Math.PI / 4)).toBeCloseTo(45, 9);
    expect(() => tiltDegOf(Number.NaN)).toThrow(RangeError);
  });
});

describe("editorClipPlanes", () => {
  const up = (h: number) => new THREE.Vector3(0, 0, R + h);

  // Why: close to the ground the near plane must shrink with the
  // clearance (a camera 3 m over a station must still see an item a metre
  // in front of it: the globe's 1 m floor clipped it), and the far plane
  // reaches past the fog to where the view ends, no farther (beyond it
  // the relief would load tiles nobody sees).
  it("follows the clearance over the drawn ground", () => {
    const low = editorClipPlanes({
      ellipsoid: SPHERE,
      cameraEcef: up(518),
      samples: [{ distanceM: 0, groundM: 515 }],
    });
    const high = editorClipPlanes({
      ellipsoid: SPHERE,
      cameraEcef: up(1500),
      samples: [{ distanceM: 0, groundM: 515 }],
    });
    // 0.3 of the 3 m clearance.
    expect(low.near).toBeCloseTo(0.9, 6);
    expect(high.near).toBeCloseTo(0.3 * 985, 6);
    const touching = editorClipPlanes({
      ellipsoid: SPHERE,
      cameraEcef: up(515.1),
      samples: [{ distanceM: 0, groundM: 515 }],
    });
    expect(touching.near).toBe(EDITOR_CLIP.minNearM);
    expect(EDITOR_CLIP.minNearM).toBeLessThan(EDITOR_CAMERA.minDistanceM);
    for (const planes of [low, high, touching]) {
      expect(planes.far).toBe(EDITOR_CLIP.farM);
    }
    expect(EDITOR_CLIP.farM).toBeGreaterThan(EDITOR_CLIP.fogEndM);
  });

  // Why: before the ground under the camera has loaded there is no
  // sample; the planes fall back to the height over the ellipsoid.
  it("falls back to the height over the ellipsoid with no ground loaded", () => {
    const none = editorClipPlanes({
      ellipsoid: SPHERE,
      cameraEcef: up(800),
      samples: [{ distanceM: 0, groundM: null }],
    });
    expect(none.near).toBeGreaterThan(0);
    expect(Number.isFinite(none.far)).toBe(true);
  });
});
