/**
 * The AR sun marker (plan 2026-09-24-0100, M2, §3.3 and §8.2).
 *
 * WHY THESE TESTS MATTER. The marker is a measuring instrument drawn over
 * the real sun, so what matters is geometry, not looks: rings at their TRUE
 * angular radius (the reader compares distances by eye), heading ticks at
 * azimuth a + N on the sun's almucantar (M1 review finding 6), a shader that
 * uses the rotation-only view (anything else lags or shows parallax), and a
 * material that neither depth-tests against the city nor gets tone-mapped
 * into a different colour. Without a GPU these are checked through the JS
 * twin of the shader (`markerVertexDirection`) and structurally; the pixel
 * test with a real GPU path is the OsmDemo milestone's (§8.3).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  azElOfNue,
  markerVertexDirection,
  sightingErrorDeg,
  sunDirectionNue,
} from './sun-check-geometry.js';
import { SUN_MARKER, createSunMarker } from './sun-marker.js';

const DEG = Math.PI / 180;
const SUN = { az: 250, el: 12 };

/** Every vertex's direction through the JS twin, with its offsets. */
function vertices(marker = createSunMarker()) {
  const offsets = marker.object.geometry.getAttribute('sunOffset');
  const out: {
    dAz: number;
    u: number;
    v: number;
    sepDeg: number;
    az: number;
    el: number;
  }[] = [];
  const sun = sunDirectionNue(SUN.az * DEG, SUN.el * DEG);
  for (let i = 0; i < offsets.count; i++) {
    const [dAz, u, v] = [offsets.getX(i), offsets.getY(i), offsets.getZ(i)];
    const d = markerVertexDirection(SUN.az, SUN.el, dAz, u, v);
    const { azimuthDeg, elevationDeg } = azElOfNue(d);
    out.push({
      dAz,
      u,
      v,
      sepDeg: sightingErrorDeg(d, sun).separationDeg,
      az: azimuthDeg,
      el: elevationDeg,
    });
  }
  return out;
}

describe('the marker geometry', () => {
  // Rings are read as angular distances, so each must sit at its true radius
  // (within half a line width), not at a gnomonic approximation of it.
  it('draws the disc and the rings at their true angular radius', () => {
    const vs = vertices().filter((p) => p.dAz === 0);
    for (const r of SUN_MARKER.ringsDeg) {
      const near = vs.filter(
        (p) => Math.abs(p.sepDeg - r) <= SUN_MARKER.outlineWidthDeg / 2 + 1e-9
      );
      expect(near.length, `ring ${r}°`).toBeGreaterThanOrEqual(
        2 * SUN_MARKER.ringSegments
      );
    }
  });

  // The heading ticks: on the almucantar at Δazimuth = N (true heading
  // degrees), centred on the sun's elevation.
  it('puts every heading tick on the almucantar at azimuth a + N', () => {
    const ticks = vertices().filter((p) => p.dAz !== 0);
    const offsets = [...new Set(ticks.map((p) => p.dAz))].sort((a, b) => a - b);
    expect(offsets).toEqual(
      [...SUN_MARKER.headingTicksDeg].sort((a, b) => a - b)
    );
    for (const n of SUN_MARKER.headingTicksDeg) {
      const tick = ticks.filter((p) => p.dAz === n);
      const meanEl = tick.reduce((s, p) => s + p.el, 0) / tick.length;
      // 1e-4, not tighter: a vertex offset sideways by half a line width
      // (0.125°) sits lower by the second-order (w/2)²·tan(e)/2 ≈ 3e-5°.
      expect(Math.abs(meanEl - SUN.el)).toBeLessThan(1e-4);
      const meanAz = tick.reduce((s, p) => s + p.az, 0) / tick.length;
      expect(meanAz).toBeCloseTo(SUN.az + n, 3);
    }
  });

  // The outline is drawn first so the magenta line sits on a dark edge that
  // keeps it visible on a white, blown-out sky (plan §3.3).
  it('draws the dark outline before the colour, as triangles in pairs', () => {
    const marker = createSunMarker();
    const colours = marker.object.geometry.getAttribute('markerColor');
    const count = colours.count;
    expect(count % 6).toBe(0);
    const first = new THREE.Color(
      colours.getX(0),
      colours.getY(0),
      colours.getZ(0)
    );
    const last = new THREE.Color(
      colours.getX(count - 1),
      colours.getY(count - 1),
      colours.getZ(count - 1)
    );
    expect(first.getHex()).toBe(
      new THREE.Color(SUN_MARKER.outlineColour).getHex()
    );
    expect(last.getHex()).toBe(new THREE.Color(SUN_MARKER.colour).getHex());
    // The geometry carries a position attribute (three needs one to draw);
    // the direction lives in `sunOffset`.
    expect(marker.object.geometry.getAttribute('position').count).toBe(count);
  });
});

describe('the marker material', () => {
  // Rotation-only view, like the sky: no lag, no parallax, correct per XR
  // view. A shader that used modelMatrix or the full viewMatrix would place
  // the sun at a finite distance (plan §3.2).
  it('uses the rotation-only view and no model matrix', () => {
    const material = createSunMarker().object.material as THREE.ShaderMaterial;
    expect(material.vertexShader).toContain('mat3(viewMatrix)');
    expect(material.vertexShader).not.toContain('modelMatrix');
    expect(material.vertexShader).not.toContain('modelViewMatrix');
  });

  it('draws over everything, untouched by depth, fog or tone mapping', () => {
    const marker = createSunMarker();
    const material = marker.object.material as THREE.ShaderMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.toneMapped).toBe(false);
    expect(material.fog).toBe(false);
    expect(marker.object.frustumCulled).toBe(false);
    expect(marker.object.renderOrder).toBeGreaterThanOrEqual(1e6);
  });
});

describe('the marker handle', () => {
  it('points the shader at the sun and hides and shows', () => {
    const marker = createSunMarker();
    marker.setSun(123.5, 7.25);
    const u = (marker.object.material as THREE.ShaderMaterial).uniforms;
    expect(u.sunAzimuthDeg!.value).toBe(123.5);
    expect(u.sunElevationDeg!.value).toBe(7.25);
    marker.setVisible(false);
    expect(marker.object.visible).toBe(false);
    marker.setVisible(true);
    expect(marker.object.visible).toBe(true);
  });

  it('rejects a non-finite or out-of-range sun', () => {
    const marker = createSunMarker();
    expect(() => marker.setSun(Number.NaN, 5)).toThrow(RangeError);
    expect(() => marker.setSun(10, 91)).toThrow(RangeError);
  });

  it('disposes its geometry and material and leaves its parent', () => {
    const marker = createSunMarker();
    const parent = new THREE.Scene();
    parent.add(marker.object);
    let disposed = 0;
    marker.object.geometry.addEventListener('dispose', () => disposed++);
    (marker.object.material as THREE.Material).addEventListener(
      'dispose',
      () => disposed++
    );
    marker.dispose();
    expect(disposed).toBe(2);
    expect(parent.children).not.toContain(marker.object);
  });
});
