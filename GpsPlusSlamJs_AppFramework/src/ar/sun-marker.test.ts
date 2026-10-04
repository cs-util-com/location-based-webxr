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

describe('the marker layout', () => {
  // M2 review finding 2: the elevation ticks at ±1° and ±2° sat ON the
  // rings and vanished under their outlines. A tick's coloured line must
  // stay clear of every ring's outline band: at least half a line width plus
  // half an outline width away from the ring's radius.
  it('keeps the elevation ticks off the rings', () => {
    const clearance =
      (SUN_MARKER.lineWidthDeg + SUN_MARKER.outlineWidthDeg) / 2;
    for (const v of SUN_MARKER.elevationTicksDeg) {
      for (const r of SUN_MARKER.ringsDeg) {
        expect(Math.abs(Math.abs(v) - r)).toBeGreaterThan(clearance);
      }
    }
  });
});

describe('the reticle', () => {
  // The Mark measures the ray through NDC (0, 0) (principalRayCamera's
  // default), so the reticle must be drawn there, fixed on the screen, in
  // clip space (M2 review finding 3).
  it('sits at NDC (0, 0) in clip space, symmetric, over everything', () => {
    const { reticle } = createSunMarker();
    const material = reticle.material as THREE.ShaderMaterial;
    expect(material.vertexShader).not.toContain('viewMatrix');
    expect(material.vertexShader).toContain('gl_Position = vec4(position.x');
    const p = reticle.geometry.getAttribute('position');
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < p.count; i++) {
      sx += p.getX(i);
      sy += p.getY(i);
      // Nothing inside the gap: the real sun at the centre stays visible.
      expect(
        Math.max(Math.abs(p.getX(i)), Math.abs(p.getY(i)))
      ).toBeGreaterThanOrEqual(SUN_MARKER.reticleGapNdc - 1e-9);
    }
    expect(Math.abs(sx / p.count)).toBeLessThan(1e-9);
    expect(Math.abs(sy / p.count)).toBeLessThan(1e-9);
    expect(reticle.frustumCulled).toBe(false);
    expect(reticle.renderOrder).toBeGreaterThan(SUN_MARKER.renderOrder);
    expect(material.depthTest).toBe(false);
    expect(material.toneMapped).toBe(false);
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
    // Neither plane may clip a direction in front of the camera (M2 review
    // finding 12: near 0.5 clipped anything beyond 60° off-axis).
    expect(material.vertexShader).toContain('gl_Position.z = 0.0');
  });

  // M2 review finding 2: transparent + DoubleSide draws in two passes, back
  // faces first, so the outline/colour order of the buffer was not the draw
  // order. Both meshes draw in one pass.
  it('draws in one pass, so the draw order is the buffer order', () => {
    const marker = createSunMarker();
    expect((marker.object.material as THREE.Material).forceSinglePass).toBe(
      true
    );
    expect((marker.reticle.material as THREE.Material).forceSinglePass).toBe(
      true
    );
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
    expect(marker.reticle.visible).toBe(false);
    marker.setVisible(true);
    expect(marker.object.visible).toBe(true);
    expect(marker.reticle.visible).toBe(true);
  });

  it('rejects a non-finite or out-of-range sun', () => {
    const marker = createSunMarker();
    expect(() => marker.setSun(Number.NaN, 5)).toThrow(RangeError);
    expect(() => marker.setSun(10, 91)).toThrow(RangeError);
  });

  it('disposes both meshes and leaves their parent', () => {
    const marker = createSunMarker();
    const parent = new THREE.Scene();
    parent.add(marker.object, marker.reticle);
    let disposed = 0;
    for (const mesh of [marker.object, marker.reticle]) {
      mesh.geometry.addEventListener('dispose', () => disposed++);
      (mesh.material as THREE.Material).addEventListener(
        'dispose',
        () => disposed++
      );
    }
    marker.dispose();
    expect(disposed).toBe(4);
    expect(parent.children).toEqual([]);
  });
});
