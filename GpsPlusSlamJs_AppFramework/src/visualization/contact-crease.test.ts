/**
 * Contact crease: unit tests (city shadows and contact crease plan
 * 2026-09-26-0549, M2).
 *
 * Why this test matters: the crease is one more `onBeforeCompile` patch on
 * materials the haze patches too, and three fails such patches silently: a
 * missing anchor leaves an unpatched material, two patches that declare the
 * same varying stop the material from drawing (a compile error three only
 * logs), and a shared program cache key makes materials with different
 * patches share one program. These tests pin, on three's real ShaderLib
 * sources: the CPU twin of the factor, where the patch lands (indirect light
 * only, after three's own AO), instancing, the chain with an earlier hook
 * and with the haze applied after it, the cache key, idempotence, and that
 * changing k or r never recompiles. The GPU compile and the pixels are the
 * look-dev page's smoke test.
 */

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  CONTACT_CREASE,
  ContactCrease,
  contactCreaseFactor,
} from './contact-crease.js';

function compile(material: THREE.Material, lib: keyof typeof THREE.ShaderLib) {
  const source = THREE.ShaderLib[lib];
  const shader = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(source.uniforms),
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

const count = (text: string, needle: string): number =>
  text.split(needle).length - 1;

describe('contactCreaseFactor (the GLSL mirrors it)', () => {
  it('is 1 - k at the base, 1 - k/e one radius up, and nearly 1 far up', () => {
    expect(contactCreaseFactor(0, 0.3, 3)).toBeCloseTo(0.7, 12);
    expect(contactCreaseFactor(3, 0.3, 3)).toBeCloseTo(1 - 0.3 / Math.E, 12);
    expect(contactCreaseFactor(60, 0.3, 3)).toBeGreaterThan(1 - 1e-8);
  });

  // Below the base (a roof overhang, a basement face) must not darken more
  // than the base itself.
  it('treats a point below the base as the base', () => {
    expect(contactCreaseFactor(-5, 0.3, 3)).toBe(
      contactCreaseFactor(0, 0.3, 3)
    );
  });

  it('refuses a strength outside [0, 1], a non-positive radius, a NaN height', () => {
    expect(() => contactCreaseFactor(0, -0.1, 3)).toThrow(RangeError);
    expect(() => contactCreaseFactor(0, 1.1, 3)).toThrow(RangeError);
    expect(() => contactCreaseFactor(0, 0.3, 0)).toThrow(RangeError);
    expect(() => contactCreaseFactor(Number.NaN, 0.3, 3)).toThrow(RangeError);
  });
});

describe('ContactCrease', () => {
  it('starts at the documented defaults and holds them in uniforms', () => {
    const crease = new ContactCrease();
    expect(crease.uniforms.creaseStrength.value).toBe(CONTACT_CREASE.strength);
    expect(crease.uniforms.creaseRadius.value).toBe(CONTACT_CREASE.radiusM);
    expect(crease.uniforms.creaseBase.value).toBe(0);
    expect(CONTACT_CREASE).toEqual({ strength: 0.3, radiusM: 3 });
  });

  // The crease darkens AMBIENT light only: it stands for the sky that the
  // ground and the wall hide from each other, not for the sun.
  it("multiplies indirect light after three's own AO, for a standard material", () => {
    const crease = new ContactCrease();
    const material = new THREE.MeshStandardMaterial();
    crease.apply(material);
    const shader = compile(material, 'standard');
    const fragment = shader.fragmentShader;
    const ao = fragment.indexOf('#include <aomap_fragment>');
    const block = fragment.indexOf('reflectedLight.indirectDiffuse *= crease');
    expect(ao).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(ao);
    expect(fragment).toContain('reflectedLight.indirectSpecular *= crease');
    // The sun's own light (directDiffuse) must stay untouched.
    expect(fragment).not.toContain('reflectedLight.directDiffuse *= crease');
    expect(fragment).not.toContain('reflectedLight.directSpecular *= crease');
    expect(fragment).toContain('uniform float creaseStrength;');
    expect(shader.vertexShader).toContain('vCreaseWorldY =');
  });

  it('patches a Lambert material too (the look-dev box)', () => {
    const crease = new ContactCrease();
    const material = new THREE.MeshLambertMaterial();
    crease.apply(material);
    const shader = compile(material, 'lambert');
    expect(shader.fragmentShader).toContain(
      'reflectedLight.indirectDiffuse *= crease'
    );
  });

  // The dense city is two InstancedMeshes: the height must be the
  // INSTANCE's world height, or every building would crease at its own
  // local origin.
  it('uses the instance and batching matrices for the world height', () => {
    const crease = new ContactCrease();
    const material = new THREE.MeshStandardMaterial();
    crease.apply(material);
    const vertex = compile(material, 'standard').vertexShader;
    expect(vertex).toMatch(
      /#ifdef USE_INSTANCING\s+creasePos = instanceMatrix \* creasePos;/
    );
    expect(vertex).toMatch(
      /#ifdef USE_BATCHING\s+creasePos = batchingMatrix \* creasePos;/
    );
    expect(vertex).toContain('vCreaseWorldY = ( modelMatrix * creasePos ).y;');
  });

  it('binds its own uniform objects, so a slider change reaches every material', () => {
    const crease = new ContactCrease();
    const material = new THREE.MeshStandardMaterial();
    crease.apply(material);
    const shader = compile(material, 'standard');
    expect(shader.uniforms.creaseStrength).toBe(crease.uniforms.creaseStrength);
    expect(shader.uniforms.creaseRadius).toBe(crease.uniforms.creaseRadius);
    expect(shader.uniforms.creaseBase).toBe(crease.uniforms.creaseBase);
  });

  it('changes strength, radius and base without a recompile', () => {
    const crease = new ContactCrease();
    const material = new THREE.MeshStandardMaterial();
    crease.apply(material);
    const version = material.version;
    crease.setStrength(0.5);
    crease.setRadius(6);
    crease.setBaseHeight(2);
    expect(material.version).toBe(version);
    expect(crease.uniforms.creaseStrength.value).toBe(0.5);
    expect(crease.uniforms.creaseRadius.value).toBe(6);
    expect(crease.uniforms.creaseBase.value).toBe(2);
    expect(() => crease.setStrength(2)).toThrow(RangeError);
    expect(() => crease.setRadius(0)).toThrow(RangeError);
    expect(() => crease.setBaseHeight(Number.POSITIVE_INFINITY)).toThrow(
      RangeError
    );
  });

  it('chains an earlier onBeforeCompile and keeps its identity in the cache key', () => {
    const crease = new ContactCrease();
    const earlier = vi.fn((shader: { fragmentShader: string }) => {
      shader.fragmentShader += '\n// earlier patch';
    });
    const a = new THREE.MeshStandardMaterial();
    a.onBeforeCompile = earlier;
    const b = new THREE.MeshStandardMaterial();
    b.onBeforeCompile = () => {};
    crease.apply(a);
    crease.apply(b);
    const shader = compile(a, 'standard');
    expect(earlier).toHaveBeenCalledTimes(1);
    expect(shader.fragmentShader).toContain('// earlier patch');
    expect(a.customProgramCacheKey()).toContain('contact-crease');
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  });

  it('applies once: a second apply changes nothing', () => {
    const crease = new ContactCrease();
    const material = new THREE.MeshStandardMaterial();
    crease.apply(material);
    const hook = material.onBeforeCompile;
    crease.apply(material);
    expect(material.onBeforeCompile).toBe(hook);
    const fragment = compile(material, 'standard').fragmentShader;
    expect(count(fragment, 'uniform float creaseStrength;')).toBe(1);
  });

  // The look-dev page applies the haze LAST, which chains the crease's hook;
  // both patches must land, each declaring its names once.
  it('survives the haze chained after it', async () => {
    const { AtmosphereHaze } = await import('./atmosphere/atmosphere-haze.js');
    const crease = new ContactCrease();
    const haze = new AtmosphereHaze({ visibilityKm: 45 });
    const material = new THREE.MeshStandardMaterial();
    crease.apply(material);
    haze.apply(material);
    const shader = compile(material, 'standard');
    expect(count(shader.fragmentShader, 'uniform float creaseStrength;')).toBe(
      1
    );
    expect(count(shader.vertexShader, 'varying float vCreaseWorldY;')).toBe(1);
    // The crease still counts as applied under the haze's hook, and a
    // second apply must not re-wrap it on top of the haze (the haze must
    // stay last): the look-dev page's first run counted 0 creased buildings.
    const hazeHook = material.onBeforeCompile;
    expect(crease.holds(material)).toBe(true);
    crease.apply(material);
    expect(material.onBeforeCompile).toBe(hazeHook);
    expect(shader.fragmentShader).toContain(
      'reflectedLight.indirectDiffuse *= crease'
    );
    expect(material.customProgramCacheKey()).toMatch(
      /contact-crease\|atmosphere-haze$/
    );
  });

  it('patches the materials under a root, skipping shader materials', () => {
    const crease = new ContactCrease();
    const root = new THREE.Group();
    const a = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial()
    );
    const b = new THREE.Mesh(new THREE.BoxGeometry(), [
      new THREE.MeshLambertMaterial(),
      new THREE.MeshStandardMaterial(),
    ]);
    const shaderMesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.ShaderMaterial()
    );
    // A sprite's shader has no <aomap_fragment>: patching it would throw at
    // compile time (the look-dev families part holds one).
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    root.add(a, b, shaderMesh, sprite);
    expect(crease.applyToObject(root)).toBe(3);
    expect(crease.applyToObject(root)).toBe(0);
    expect(crease.holds(a.material)).toBe(true);
    expect(crease.holds(shaderMesh.material)).toBe(false);
    expect(crease.holds(sprite.material)).toBe(false);
  });

  it('throws, rather than leaving an unpatched material, when an anchor is gone', () => {
    const crease = new ContactCrease();
    const material = new THREE.MeshStandardMaterial();
    crease.apply(material);
    const shader = {
      vertexShader: '#include <common>\nvoid main() {}',
      fragmentShader: '#include <common>\nvoid main() {}',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    expect(() =>
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    ).toThrow(/contact crease/);
  });
});
