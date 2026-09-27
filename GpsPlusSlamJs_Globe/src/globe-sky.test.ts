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

  it("sizes the disc as the real sun by default, and takes the lab's size and glow", () => {
    const sky = createGlobeSky();
    expect(GLOBE_SKY.sunDiameterDeg).toBeCloseTo(0.533, 3);
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
    const count = (m: number) =>
      generateStarField({
        seed: GLOBE_STARS.seed,
        magLimit: 7.5,
      }).magnitudes.filter((x) => x <= m).length;
    expect(GLOBE_SKY.starMagLimit).toBe(6.5);
    expect(sky.visibleStars()).toBe(count(6.5));
    expect(sky.visibleStars()).toBeGreaterThan(2000);
    const look = { gain: 1, milkyWay: 0, pixelRatio: 2, visible: true };
    sky.setStarLook({ ...look, magLimit: 5.5 });
    expect(sky.visibleStars()).toBe(count(5.5));
    expect(sky.starUniforms.uMagLimit.value).toBe(5.5);
    expect(sky.starUniforms.uPixelRatio.value).toBe(2);
    expect(sky.uniforms.uMilkyWay.value).toBe(0);
    sky.setStarLook({ ...look, magLimit: 6.5, visible: false });
    expect(sky.stars.visible).toBe(false);
    for (const bad of [
      { ...look, magLimit: 9 },
      { ...look, magLimit: 6.5, gain: -1 },
      { ...look, magLimit: 6.5, milkyWay: Number.NaN },
      { ...look, magLimit: 6.5, pixelRatio: 0 },
    ]) {
      expect(() => sky.setStarLook(bad)).toThrow(RangeError);
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
        expect(sky.stars.quaternion.angleTo(q)).toBeLessThan(1e-9);
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
      { numRuns: 20 },
    );
  });
});
