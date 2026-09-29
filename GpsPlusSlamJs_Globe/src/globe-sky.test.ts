/**
 * Why this test matters: the sky (the sun's disc and glow, and later the
 * stars) is drawn in its OWN pass behind the Earth, and three settings make
 * or break that silently:
 * - the sky camera shares ONLY the view's rotation and field of view: with
 *   the view's position the sun would sit at a finite place in space, and
 *   with the view's clip planes (the globe camera's near plane is tens of
 *   kilometres, its far plane follows the horizon) the sky would be clipped
 *   away;
 * - the sky neither tests nor writes depth, so it can never hide the Earth
 *   and the Earth, drawn after it, always covers it;
 * - the sun's direction is a unit vector, the same one that lights the
 *   Earth, and the disc's angular size is the real sun's unless the lab
 *   says otherwise;
 * - the stars and the Milky Way turn with the celestial rotation the
 *   caller gives, and the magnitude limit decides how many are drawn.
 * Pixels are the lab smoke's job; this pins the wiring under Node.
 */

import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { GLOBE_SKY, createGlobeSky } from "./globe-sky.js";
import {
  GALACTIC_CENTRE,
  GALACTIC_NORTH_POLE,
  GLOBE_STARS,
  generateStarField,
  packStarField,
} from "./globe-stars.js";

const DEG = Math.PI / 180;

describe("createGlobeSky", () => {
  it("draws a sky that never touches depth, never culls, and faces inwards", () => {
    const sky = createGlobeSky();
    const meshes: THREE.Mesh[] = [];
    sky.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const material = mesh.material as THREE.ShaderMaterial;
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
      expect(material.side).toBe(THREE.BackSide);
      expect(mesh.frustumCulled).toBe(false);
    }
    // The stars: added over the sphere, no depth, never culled.
    const stars = sky.stars.material as THREE.ShaderMaterial;
    expect(stars.depthTest).toBe(false);
    expect(stars.depthWrite).toBe(false);
    expect(stars.blending).toBe(THREE.AdditiveBlending);
    expect(sky.stars.frustumCulled).toBe(false);
    expect(sky.stars.renderOrder).toBeGreaterThan(meshes[0].renderOrder);
    sky.dispose();
  });

  it("follows the view's rotation and field of view, never its position or clip planes", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.double({ min: -1, max: 1, noNaN: true }),
          fc.double({ min: -1, max: 1, noNaN: true }),
          fc.double({ min: -1, max: 1, noNaN: true }),
          fc.double({ min: -1, max: 1, noNaN: true }),
        ),
        fc.double({ min: 20, max: 80, noNaN: true }),
        fc.double({ min: 0.4, max: 2.5, noNaN: true }),
        (q, fov, aspect) => {
          const length = Math.hypot(...q);
          fc.pre(length > 1e-3);
          const view = new THREE.PerspectiveCamera(fov, aspect, 64_000, 4e7);
          view.position.set(2e7, -1e7, 3e6);
          view.quaternion.set(q[0], q[1], q[2], q[3]).normalize();
          view.updateMatrixWorld();
          const sky = createGlobeSky();
          sky.syncCamera(view);
          const cam = sky.camera;
          expect(cam.position.length()).toBe(0);
          expect(cam.quaternion.angleTo(view.quaternion)).toBeLessThan(1e-6);
          expect(cam.fov).toBe(fov);
          expect(cam.aspect).toBe(aspect);
          // The sky sphere (radius GLOBE_SKY.radius) sits between the sky
          // camera's own planes, whatever the view's are.
          expect(cam.near).toBeLessThan(GLOBE_SKY.radius);
          expect(cam.far).toBeGreaterThan(GLOBE_SKY.radius);
          // The projection is the sky camera's own, updated.
          const expected = cam.clone();
          expected.updateProjectionMatrix();
          expect(cam.projectionMatrix.equals(expected.projectionMatrix)).toBe(
            true,
          );
          sky.dispose();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("points the sun along a unit direction, and refuses a zero or non-finite one", () => {
    const sky = createGlobeSky();
    sky.setSun(new THREE.Vector3(0, 3, 4));
    const dir = sky.uniforms.uSunDirection.value;
    expect(dir.length()).toBeCloseTo(1, 12);
    expect(dir.y).toBeCloseTo(0.6, 12);
    expect(dir.z).toBeCloseTo(0.8, 12);
    expect(() => sky.setSun(new THREE.Vector3())).toThrow(RangeError);
    expect(() => sky.setSun(new THREE.Vector3(Number.NaN, 0, 1))).toThrow(
      RangeError,
    );
    sky.dispose();
  });

  // Why: the owner tuned the look by eye on his phone (round-4 plan
  // 2026-09-28-2105 DEC-GL4-1) and asked for exactly these values as the
  // defaults, so a link without them shows what he chose. The real sun's
  // 0.533° stays named beside the look's 1°, which is about twice it.
  it("defaults to the owner's look (DEC-GL4-1): disc 1°, glow 0.95, stars to 7.5 at gain 4, Milky Way 0.03", () => {
    expect(GLOBE_SKY.realSunDiameterDeg).toBeCloseTo(0.533, 3);
    expect(GLOBE_SKY.sunDiameterDeg).toBe(1);
    expect(GLOBE_SKY.glow).toBe(0.95);
    expect(GLOBE_SKY.starMagLimit).toBe(7.5);
    expect(GLOBE_SKY.starGain).toBe(4);
    expect(GLOBE_SKY.milkyWay).toBe(0.03);
    const sky = createGlobeSky();
    expect(sky.uniforms.uGlow.value).toBe(0.95);
    expect(sky.uniforms.uMilkyWay.value).toBe(0.03);
    expect(sky.starUniforms.uMagLimit.value).toBe(7.5);
    expect(sky.starUniforms.uStarGain.value).toBe(4);
    sky.dispose();
  });

  it("sizes the disc from the look by default, and takes the lab's size and glow", () => {
    const sky = createGlobeSky();
    expect(sky.uniforms.uSunRadius.value).toBeCloseTo(
      (GLOBE_SKY.sunDiameterDeg / 2) * DEG,
      12,
    );
    sky.setLook({ sunDiameterDeg: 4, glow: 0 });
    expect(sky.uniforms.uSunRadius.value).toBeCloseTo(2 * DEG, 12);
    expect(sky.uniforms.uGlow.value).toBe(0);
    for (const bad of [
      { sunDiameterDeg: 0, glow: 1 },
      { sunDiameterDeg: Number.NaN, glow: 1 },
      { sunDiameterDeg: 1, glow: -1 },
    ]) {
      expect(() => sky.setLook(bad)).toThrow(RangeError);
    }
    sky.dispose();
  });

  it("the shader measures the angle to the sun without the float cancellation of acos near 1", () => {
    const sky = createGlobeSky();
    const material = (sky.scene.children[0] as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    // acos(dot) cannot resolve a 0.27° disc in 32-bit floats; the chord can.
    expect(material.fragmentShader).toContain("length( d - uSunDirection )");
    expect(material.fragmentShader).not.toContain("acos");
    // The output colour space, like every other material; but NOT tone
    // mapped (stream F review, finding 3): Neutral tone mapping squares
    // values under 0.08, which made the faint stars and the Milky Way
    // vanish. The disc is clamped in the shader instead.
    expect(material.fragmentShader).toContain("#include <colorspace_fragment>");
    expect(material.fragmentShader).toContain("min( sky, vec3( 1.0 ) )");
    expect(material.toneMapped).toBe(false);
    expect((sky.stars.material as THREE.ShaderMaterial).toneMapped).toBe(false);
    sky.dispose();
  });

  it("mottles the Milky Way in galactic coordinates, so the pattern turns with the band", () => {
    const sky = createGlobeSky();
    const fs = (sky.scene.children[0] as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    // Longitude and latitude from the galactic pole and centre only: no
    // world axis (d.x, d.y, d.z) may enter, or the mottle slides along the
    // band as the sky turns (stream F review, finding 7).
    expect(fs.fragmentShader).toContain("cross( uGalPole, uGalCentre )");
    expect(fs.fragmentShader).not.toMatch(/\bd\.[xyz]\b/);
    sky.dispose();
  });
});

describe("the procedural stars in the sky pass", () => {
  it("clips the stars past the magnitude limit in the shader, never a zero point size", () => {
    // gl_PointSize 0 is undefined in WebGL, and ANGLE clamps it to at least
    // one pixel, so the limit hid nothing (stream F review, finding 2). A
    // star past the limit is moved outside the clip volume and blacked out.
    const sky = createGlobeSky();
    const vs = (sky.stars.material as THREE.ShaderMaterial).vertexShader;
    expect(vs).not.toMatch(/\?\s*0\.0\s*:/);
    expect(vs).toContain("aMag > uMagLimit");
    expect(vs).toContain("gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 )");
    expect(vs).toContain("vColor = vec3( 0.0 )");
    sky.dispose();
  });

  it("draws the field to the default limit, and the lab's limit changes the count", () => {
    const sky = createGlobeSky();
    // The packed magnitudes (a byte each), as the sky counts them.
    const packed = packStarField(
      generateStarField({
        seed: GLOBE_STARS.seed,
        magLimit: GLOBE_STARS.maxMagLimit,
      }),
    ).magnitudes;
    const count = (m: number) => packed.filter((x) => x <= m).length;
    expect(sky.visibleStars()).toBe(count(GLOBE_SKY.starMagLimit));
    expect(sky.visibleStars()).toBeGreaterThan(2000);
    const look = { gain: 1, milkyWay: 0, pixelRatio: 2, visible: true };
    sky.setStarLook({ ...look, magLimit: 5.5 });
    expect(sky.visibleStars()).toBe(count(5.5));
    expect(sky.starUniforms.uMagLimit.value).toBe(5.5);
    expect(sky.starUniforms.uPixelRatio.value).toBe(2);
    expect(sky.uniforms.uMilkyWay.value).toBe(0);
    // The owner's new top of the range (round-4 plan DEC-GL4-2).
    sky.setStarLook({ ...look, magLimit: 9 });
    expect(sky.visibleStars()).toBe(count(9));
    sky.setStarLook({ ...look, magLimit: 6.5, visible: false });
    expect(sky.stars.visible).toBe(false);
    for (const bad of [
      { ...look, magLimit: 9.5 },
      { ...look, magLimit: 6.5, gain: -1 },
      { ...look, magLimit: 6.5, milkyWay: Number.NaN },
      { ...look, magLimit: 6.5, pixelRatio: 0 },
    ]) {
      expect(() => sky.setStarLook(bad)).toThrow(RangeError);
    }
    sky.dispose();
  });

  // Why (round-4 plan DEC-GL4-2): generated to magnitude 9 the field holds
  // about 89,000 points, eighteen times the old default's 5,000. Sorted
  // brightest first, the draw range stops at the limit, so the GPU runs
  // the vertex shader only for the stars the limit shows and a lower limit
  // costs less, instead of every frame paying for the whole field.
  it("sorts the stars brightest first and draws only up to the limit", () => {
    const sky = createGlobeSky();
    // The magnitude bytes, brightest first; 6 bytes a star in all.
    const magTint = sky.stars.geometry.getAttribute("aMagTint");
    const oct = sky.stars.geometry.getAttribute("aOct");
    expect(magTint.array).toBeInstanceOf(Uint8Array);
    expect(oct.array).toBeInstanceOf(Int16Array);
    expect(magTint.normalized && oct.normalized).toBe(true);
    for (let i = 1; i < magTint.count; i++) {
      expect(magTint.getX(i)).toBeGreaterThanOrEqual(magTint.getX(i - 1));
    }
    expect(magTint.array.byteLength + oct.array.byteLength).toBe(
      6 * magTint.count,
    );
    // No position attribute: the direction is decoded in the shader, so
    // attribute 0 is bound to it.
    expect(sky.stars.geometry.getAttribute("position")).toBeUndefined();
    expect(
      (sky.stars.material as THREE.ShaderMaterial).index0AttributeName,
    ).toBe("aOct");
    const look = { gain: 1, milkyWay: 0, pixelRatio: 1, visible: true };
    for (const magLimit of [0.5, 3.5, 6.5, 7.5, 9]) {
      sky.setStarLook({ ...look, magLimit });
      expect(sky.stars.geometry.drawRange.start).toBe(0);
      expect(sky.stars.geometry.drawRange.count).toBe(sky.visibleStars());
    }
    sky.dispose();
  });

  it("turns the stars and the Milky Way's pole by the celestial rotation", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), (a) => {
        const sky = createGlobeSky();
        const q = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          -a,
        );
        sky.setCelestialRotation(q);
        // Compared by where the two rotations send two axes, not by
        // `angleTo`: its acos turns one rounding step of the dot product
        // near 1 into ~3e-8 rad, while an axis's displacement grows
        // linearly with the angle, so 1e-9 still means ~1e-9 rad.
        for (const axis of [
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 1, 0),
        ]) {
          const got = axis.clone().applyQuaternion(sky.stars.quaternion);
          expect(got.distanceTo(axis.clone().applyQuaternion(q))).toBeLessThan(
            1e-9,
          );
        }
        const pole = new THREE.Vector3(...GALACTIC_NORTH_POLE).applyQuaternion(
          q,
        );
        expect(sky.uniforms.uGalPole.value.distanceTo(pole)).toBeLessThan(1e-9);
        const centre = new THREE.Vector3(...GALACTIC_CENTRE).applyQuaternion(q);
        expect(sky.uniforms.uGalCentre.value.distanceTo(centre)).toBeLessThan(
          1e-9,
        );
        sky.dispose();
      }),
      // The example is the seed-721839530 counterexample that failed the
      // r757 cascade (2026-09-28): it must stay green on every run.
      { numRuns: 20, examples: [[2.7478541238137337e-5]] },
    );
  });
});
