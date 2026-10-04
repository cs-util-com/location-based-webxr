/**
 * Tests for the cloud shadow patch (round-3 plan 2026-09-27-0532, stream D;
 * DEC-FB3-7).
 *
 * Why this file matters: the patch is injected into three.js's OWN lit
 * programs, where every failure is silent: a lost anchor leaves the scene
 * without cloud shadows, a replaced hook drops the water's or the catalog's
 * own patch, an unchanged program key makes different materials share one
 * program, and a second copy of the text (with the haze chained in either
 * order) is a compile error three only logs. The shaders here are three's
 * real ShaderLib sources, not fixtures; the look-dev smoke compiles and
 * draws them.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { AtmosphereHaze } from './atmosphere-haze.js';
import type { AtmosphereUniforms } from './atmosphere-luts.js';
import { CloudShadow, CloudShadowAnchorError } from './cloud-shadow.js';

function compileWith(
  material: THREE.Material,
  lib: keyof typeof THREE.ShaderLib
) {
  const source = THREE.ShaderLib[lib];
  const shader = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(source.uniforms),
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

function atmosphereSource() {
  return {
    cloudUniforms: {
      atmCloudTexture: { value: new THREE.Texture() },
      atmCloudThreshold: { value: 0.61 },
      atmCloudOffset: { value: new THREE.Vector2(0.2, 0.3) },
    },
  };
}

function sharedUniforms(): AtmosphereUniforms {
  return {
    atmMieExtinction: { value: 0.03 },
    atmTransmittanceLut: { value: new THREE.Texture() },
    atmMultiScatteringLut: { value: new THREE.Texture() },
    atmSkyViewLut: { value: new THREE.Texture() },
    atmSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    atmSunCosZenith: { value: 1 },
    atmObserverRadius: { value: 6360.2 },
    atmRadianceToScene: { value: 0.002 },
  };
}

describe('CloudShadow.apply', () => {
  // Every lit family has three's light loop and its anchor.
  it.each([
    ['standard', () => new THREE.MeshStandardMaterial()],
    ['physical', () => new THREE.MeshPhysicalMaterial()],
    ['lambert', () => new THREE.MeshLambertMaterial()],
    ['phong', () => new THREE.MeshPhongMaterial()],
    ['toon', () => new THREE.MeshToonMaterial()],
  ] as const)('patches three’s real %s shader', (lib, make) => {
    const material = make();
    new CloudShadow().apply(material);
    const shader = compileWith(material, lib);
    const f = shader.fragmentShader;
    // Wrapped after every declaration (Lambert, Phong and Toon declare
    // vViewPosition after the light declarations: the first cut, placed
    // right after them, failed to compile there on the GPU), then renamed,
    // so three's own light loop (untouched, still an include) calls it.
    const pars = f.indexOf('#include <lights_pars_begin>');
    const viewPosition = f.lastIndexOf('varying vec3 vViewPosition;');
    const main = f.indexOf('void main() {');
    const wrapper = f.indexOf('void atmShadowCloudLightInfo(');
    const define = f.indexOf(
      '#define getDirectionalLightInfo atmShadowCloudLightInfo'
    );
    expect(pars).toBeGreaterThan(0);
    expect(wrapper).toBeGreaterThan(pars);
    expect(define).toBeGreaterThan(wrapper);
    // The material's own vViewPosition, where the chunk is still an include,
    // must come first: its pars include precedes main.
    const litPars = f.search(
      /#include <lights_(lambert|phong|toon|physical)_pars_fragment>/
    );
    expect(Math.max(viewPosition, litPars)).toBeLessThan(wrapper);
    expect(main).toBeGreaterThan(define);
    expect(f.indexOf('#include <lights_fragment_begin>')).toBeGreaterThan(
      define
    );
    // The wrapper calls three's function by its real name, before the rename.
    const body = f.slice(wrapper, define);
    expect(body).toContain('getDirectionalLightInfo(directionalLight, light);');
    // Each light along its OWN direction, from the fragment's world point.
    expect(body).toContain('(vec4(light.direction, 0.0) * viewMatrix).xyz');
    expect(body).toContain(
      'cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz'
    );
    expect(shader.uniforms.atmShadowCloudOffset).toBeDefined();
  });

  // three's program cache key: materials with different inner patches must
  // not share a program, and the patch must be named in the key.
  it('chains the previous hook and keeps its identity in the program key', () => {
    const calls: string[] = [];
    const a = new THREE.MeshStandardMaterial();
    a.onBeforeCompile = () => calls.push('a');
    a.customProgramCacheKey = () => 'inner-a';
    const b = new THREE.MeshStandardMaterial();
    b.onBeforeCompile = () => calls.push('b');
    const shadow = new CloudShadow();
    shadow.apply(a);
    shadow.apply(b);
    compileWith(a, 'standard');
    compileWith(b, 'standard');
    expect(calls).toEqual(['a', 'b']);
    expect(a.customProgramCacheKey()).toBe('inner-a|cloud-shadow');
    expect(b.customProgramCacheKey()).toContain('calls.push');
    expect(b.customProgramCacheKey()).toMatch(/\|cloud-shadow$/);
  });

  // The haze chains on top by design (it is applied last), and it wraps this
  // hook, so the ownership check must not compare hooks (lessons-learned,
  // the contact crease): a re-apply after the haze is a no-op. In either
  // order each patch's text appears exactly once.
  it.each(['shadow first', 'haze first'] as const)(
    'composes with the haze (%s), each text once',
    (order) => {
      const material = new THREE.MeshStandardMaterial();
      const shadow = new CloudShadow();
      const haze = new AtmosphereHaze({ visibilityKm: 45 });
      haze.sync({ sharedUniforms: sharedUniforms(), visibilityKm: 45 });
      if (order === 'shadow first') {
        shadow.apply(material);
        haze.apply(material);
      } else {
        haze.apply(material);
        shadow.apply(material);
        haze.apply(material); // the haze heals itself back on top
      }
      shadow.apply(material); // no-op: already patched
      const f = compileWith(material, 'standard').fragmentShader;
      expect(count(f, 'uniform float atmShadowCloudOn;')).toBe(1);
      expect(count(f, 'uniform float atmHazeMode;')).toBe(1);
      expect(count(f, '#define ATM_CLOUD_COLUMN_GLSL')).toBe(1);
      expect(material.customProgramCacheKey()).toContain('cloud-shadow');
      expect(material.customProgramCacheKey()).toContain('atmosphere-haze');
    }
  );

  it('refuses a material without a light loop, and one another CloudShadow owns', () => {
    expect(() =>
      new CloudShadow().apply(new THREE.MeshBasicMaterial())
    ).toThrow(TypeError);
    const material = new THREE.MeshStandardMaterial();
    new CloudShadow().apply(material);
    expect(() => new CloudShadow().apply(material)).toThrow(/another/);
  });

  // A three upgrade that renames the anchor must fail loudly, not leave a
  // scene quietly without cloud shadows.
  it('throws CloudShadowAnchorError when three’s anchor is gone', () => {
    const material = new THREE.MeshStandardMaterial();
    new CloudShadow().apply(material);
    const shader = {
      vertexShader: '',
      fragmentShader: 'void main() {}',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    expect(() =>
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    ).toThrow(CloudShadowAnchorError);
  });
});

describe('CloudShadow.applyToObject', () => {
  it('patches the lit materials under a root once, and leaves the others', () => {
    const root = new THREE.Group();
    const lit = new THREE.MeshStandardMaterial();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), lit));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), lit));
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    );
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), [
        new THREE.MeshLambertMaterial(),
        new THREE.ShaderMaterial(),
      ])
    );
    const shadow = new CloudShadow();
    expect(shadow.applyToObject(root)).toBe(2);
    expect(shadow.applyToObject(root)).toBe(0);
  });
});

describe('CloudShadow uniforms', () => {
  // The drift moves the atmosphere's offset in place: sharing the object
  // makes the shadows drift with the sky without a per-frame call. The
  // cover is a number and is copied at each sync.
  it('shares the texture and the drift offset, copies the threshold', () => {
    const source = atmosphereSource();
    const shadow = new CloudShadow();
    expect(shadow.uniforms.atmShadowCloudThreshold.value).toBe(2);
    shadow.sync(source);
    expect(shadow.uniforms.atmShadowCloudTexture.value).toBe(
      source.cloudUniforms.atmCloudTexture.value
    );
    expect(shadow.uniforms.atmShadowCloudOffset.value).toBe(
      source.cloudUniforms.atmCloudOffset.value
    );
    source.cloudUniforms.atmCloudOffset.value.x = 0.9;
    expect(shadow.uniforms.atmShadowCloudOffset.value.x).toBe(0.9);
    expect(shadow.uniforms.atmShadowCloudThreshold.value).toBe(0.61);
    source.cloudUniforms.atmCloudThreshold.value = 0.4;
    expect(shadow.uniforms.atmShadowCloudThreshold.value).toBe(0.61);
  });

  // WHY (owner bug report 2026-09-28): a cloud's shadow on the ground must
  // not depend on where the camera is. The r758 review fix weighted the
  // column by how much of the cloud the sky DRAWS from the camera, so with
  // a low sun (the crossing ~22 km out, past the far fade) every ground
  // shadow vanished, and came back when the camera moved toward the sun.
  // The ground shadow is the column itself, the same from every viewpoint.
  it('shades by the column alone, with no camera-dependent weight', () => {
    const material = new THREE.MeshStandardMaterial();
    new CloudShadow().apply(material);
    const f = compileWith(material, 'standard').fragmentShader;
    const body = f.slice(
      f.indexOf('void atmShadowCloudLightInfo('),
      f.indexOf('#define getDirectionalLightInfo atmShadowCloudLightInfo')
    );
    expect(body).not.toContain('atmColumnDrawn');
    expect(body).not.toContain('fromCamera');
    expect(body).toContain(
      'light.color *= exp(-atmColumnOpticalDepth(noise, atmShadowCloudThreshold, world.y, toLight.y));'
    );
  });

  // Patched materials read the SAME uniform objects: one switch reaches all.
  it('switches every patched material with one uniform', () => {
    const shadow = new CloudShadow();
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshLambertMaterial();
    shadow.apply(a);
    shadow.apply(b);
    const ua = compileWith(a, 'standard').uniforms;
    const ub = compileWith(b, 'lambert').uniforms;
    expect(ua.atmShadowCloudOn).toBe(ub.atmShadowCloudOn);
    shadow.setEnabled(false);
    expect(ua.atmShadowCloudOn!.value).toBe(0);
    expect(shadow.enabled).toBe(false);
  });
});
