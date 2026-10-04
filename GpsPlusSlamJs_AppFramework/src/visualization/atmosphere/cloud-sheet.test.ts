/**
 * Tests for the fly-through cloud sheet's CPU half.
 *
 * Why this file matters: the sheet's look is judged by eye on the look-dev
 * page, but its failure modes are geometry: a far edge that shows (the fade
 * must end inside the square), a hard line where the camera crosses (the
 * near fade), a draw order that lets sprites cut holes, and a mesh that
 * stays behind when the camera moves. All of those are testable here.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  CLOUD_SHEET,
  cloudSheetFade,
  cloudSheetRenderOrder,
  CLOUD_SHEET_FRAGMENT_GLSL,
  cloudSheetRingRadii,
  cloudTopRadiance,
  createCloudSheet,
} from './cloud-sheet.js';
import { CLOUD_LAYER, cloudLitRadiance } from './cloud-layer.js';
import { ATMOSPHERE_CLOUD_GLSL } from './atmosphere-glsl.js';
import { glslFloat } from '../../utils/glsl-float.js';

describe('CLOUD_SHEET', () => {
  // The far fade must reach zero INSIDE the square, or its edge is drawn.
  it('ends the far fade inside the square and the near fade before it', () => {
    const s = CLOUD_SHEET;
    expect(s.nearFadeStartM).toBeLessThan(s.nearFadeEndM);
    expect(s.nearFadeEndM).toBeLessThan(s.farFadeStartM);
    expect(s.farFadeStartM).toBeLessThan(s.farFadeEndM);
    expect(s.farFadeEndM).toBeLessThan(s.radiusM);
  });

  // The look-dev scene's tallest content (ridges to 520 m) must stay below
  // the sheet: the depth test's occlusion rests on it (plan §2).
  it('sits well above the look-dev scene', () => {
    expect(CLOUD_SHEET.altitudeM).toBeGreaterThan(2 * 520);
  });
});

describe('cloudSheetFade', () => {
  it('is 0 at the camera, 1 in the middle distance, 0 beyond the far end', () => {
    expect(cloudSheetFade(0, 0)).toBe(0);
    expect(cloudSheetFade(CLOUD_SHEET.nearFadeStartM, 0)).toBe(0);
    expect(cloudSheetFade(5000, 4000)).toBe(1);
    expect(
      cloudSheetFade(CLOUD_SHEET.farFadeEndM + 10, CLOUD_SHEET.farFadeEndM)
    ).toBe(0);
  });

  // WHY (review finding 1): the dome's fade by view ELEVATION is 0 for every
  // downward ray, which would blank the sheet from above. The sheet's fade is
  // by distance, so a sheet under the camera is visible.
  it('keeps the sheet visible from above, for rays that point down', () => {
    const cameraY = 3200;
    const below = CLOUD_SHEET.altitudeM - cameraY; // negative: the sheet is below
    for (const horizontal of [0, 500, 2000, 8000]) {
      const distance = Math.hypot(horizontal, below);
      expect(cloudSheetFade(distance, horizontal)).toBeGreaterThan(0.5);
    }
  });

  // Property over camera heights 0-4 km and every direction: the factor is a
  // valid opacity, 0 near the camera and 0 beyond the far end.
  it('stays in [0, 1], and is 0 near the camera and beyond the far end', () => {
    const violations: Array<[number, number]> = [];
    for (let cameraY = 0; cameraY <= 4000; cameraY += 250) {
      const dy = CLOUD_SHEET.altitudeM - cameraY;
      for (let horizontal = 0; horizontal <= 30_000; horizontal += 97) {
        const distance = Math.hypot(horizontal, dy);
        const fade = cloudSheetFade(distance, horizontal);
        expect(fade).toBeGreaterThanOrEqual(0);
        expect(fade).toBeLessThanOrEqual(1);
        const mustBeZero =
          horizontal >= CLOUD_SHEET.farFadeEndM ||
          distance <= CLOUD_SHEET.nearFadeStartM;
        if (mustBeZero && fade !== 0) violations.push([cameraY, horizontal]);
      }
    }
    expect(violations).toEqual([]);
  });

  it('is monotone: rising through the near fade, falling through the far one', () => {
    let last = -1;
    for (let d = 0; d <= CLOUD_SHEET.nearFadeEndM; d += 5) {
      const f = cloudSheetFade(d, 0);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    last = 2;
    for (
      let h = CLOUD_SHEET.farFadeStartM;
      h <= CLOUD_SHEET.radiusM;
      h += 100
    ) {
      const f = cloudSheetFade(h + 1000, h);
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
  });

  it.each([
    [Number.NaN, 0],
    [-1, 0],
    [10, -1],
    [10, 20],
  ])('rejects distances %s, %s', (distance, horizontal) => {
    expect(() => cloudSheetFade(distance, horizontal)).toThrow(RangeError);
  });
});

describe('cloudSheetRingRadii', () => {
  // WHY: a uniform grid of 1.5 km triangles broke the near fade with the eye
  // 0.5 m above the sheet (the look-dev crossing test measured one world
  // position for the whole lower half). Rings grow geometrically from 2 m,
  // so the triangle under the eye is metres wide, never kilometres.
  it('grows geometrically from a few metres to the sheet radius', () => {
    const radii = cloudSheetRingRadii();
    expect(radii[0]).toBe(0);
    expect(radii[1]).toBe(CLOUD_SHEET.innerRadiusM);
    expect(radii.at(-1)).toBe(CLOUD_SHEET.radiusM);
    for (let k = 2; k < radii.length; k++) {
      expect(radii[k]! / radii[k - 1]!).toBeLessThanOrEqual(
        CLOUD_SHEET.ringRatio + 1e-9
      );
      expect(radii[k]!).toBeGreaterThan(radii[k - 1]!);
    }
    expect(radii.length).toBeLessThan(60);
  });
});

describe('cloudSheetRenderOrder', () => {
  it('draws the sheet first from below and last from above', () => {
    expect(cloudSheetRenderOrder(55)).toBe(-1);
    expect(cloudSheetRenderOrder(CLOUD_SHEET.altitudeM)).toBe(-1);
    expect(cloudSheetRenderOrder(3200)).toBe(1);
  });
});

describe('createCloudSheet', () => {
  const sheetAndCamera = (x: number, y: number, z: number) => {
    const sheet = createCloudSheet({});
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(x, y, z);
    camera.updateMatrixWorld();
    sheet.onBeforeRender(
      {} as THREE.WebGLRenderer,
      new THREE.Scene(),
      camera,
      sheet.geometry,
      sheet.material as THREE.Material,
      null as unknown as THREE.Group
    );
    return sheet;
  };

  // The sheet is re-centred in onBeforeRender, which three calls before the
  // model-view matrix: the camera is never near the square's edge.
  it('re-centres on the camera in x/z, at its own altitude', () => {
    const sheet = sheetAndCamera(1234, 55, -987);
    expect(sheet.matrixWorld.elements[12]).toBe(1234);
    expect(sheet.matrixWorld.elements[13]).toBe(CLOUD_SHEET.altitudeM);
    expect(sheet.matrixWorld.elements[14]).toBe(-987);
    expect(sheet.frustumCulled).toBe(false);
  });

  it('sets its draw order by the camera side', () => {
    expect(sheetAndCamera(0, 55, 0).renderOrder).toBe(-1);
    expect(sheetAndCamera(0, 3200, 0).renderOrder).toBe(1);
  });

  it('is a transparent, double-sided plane that never writes depth', () => {
    const sheet = createCloudSheet({});
    const material = sheet.material as THREE.ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
    sheet.geometry.computeBoundingBox();
    const box = sheet.geometry.boundingBox!;
    // Flat, up to the rotation's rounding (~3e-12 m on a 48 km plane).
    expect(box.max.y - box.min.y).toBeLessThan(1e-6);
    expect(box.max.x).toBeCloseTo(CLOUD_SHEET.radiusM, 6);
  });

  // One pattern, one cover, one light: the sheet carries the dome's chunk.
  it('includes the cloud chunk the sky dome uses', () => {
    expect(CLOUD_SHEET_FRAGMENT_GLSL).toContain(ATMOSPHERE_CLOUD_GLSL);
  });

  // The GPU cannot drift from the tested fades: the constants are injected.
  it('injects the fade constants into its shader', () => {
    for (const value of [
      CLOUD_SHEET.nearFadeStartM,
      CLOUD_SHEET.nearFadeEndM,
      CLOUD_SHEET.farFadeStartM,
      CLOUD_SHEET.farFadeEndM,
    ]) {
      expect(CLOUD_SHEET_FRAGMENT_GLSL).toContain(glslFloat(value));
    }
  });
});

describe('cloudTopRadiance', () => {
  // WHY: the dome's model lights only undersides seen from below; from above
  // the deck read as dull grey (the first look-dev probe). A sunlit top
  // reflects the sun diffusely, so with the sun up it is far brighter than
  // the same cloud's side-lit underside, and at night it keeps only the sky.
  it('is a diffuse reflector of the sun plus the sky, brighter than the underside', () => {
    const sunT: [number, number, number] = [1, 1, 1];
    const zenith: [number, number, number] = [0.1, 0.12, 0.2];
    const top = cloudTopRadiance(sunT, Math.sin((58 * Math.PI) / 180), zenith);
    const underside = cloudLitRadiance(sunT, -0.8, 0.9, zenith);
    expect(top[0]).toBeGreaterThan(2 * underside[0]);
    const night = cloudTopRadiance(sunT, -0.1, zenith);
    expect(night[2]).toBeCloseTo(zenith[2] * CLOUD_LAYER.skyAmbient, 12);
  });

  it('is injected into the shader with its albedo', () => {
    expect(CLOUD_SHEET_FRAGMENT_GLSL).toContain(
      `ATM_SHEET_TOP_ALBEDO = ${glslFloat(CLOUD_SHEET.topAlbedo)}`
    );
  });
});
