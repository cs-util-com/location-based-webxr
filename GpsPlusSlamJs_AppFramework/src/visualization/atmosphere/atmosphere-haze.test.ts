/**
 * Tests for the atmosphere haze patch.
 *
 * Why this file matters: the haze is injected into three.js's OWN material
 * programs via onBeforeCompile, which fails in three silent ways (plan review
 * findings 1 and 2):
 *
 * - a patch that no longer finds its anchor in a newer three simply does not
 *   apply, and the scene loses its haze without an error;
 * - a patch that replaces a material's existing onBeforeCompile, or leaves
 *   the program cache key unchanged, makes materials with DIFFERENT inner
 *   patches share one compiled program (a building drawn with the ground's
 *   displacement shader);
 * - OsmDemo's AR mode reparents the same material instances into another
 *   WebGL context, where the desktop sky's LUT texture does not exist.
 *
 * The shaders here are three's real ShaderLib sources, not fixtures.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  AtmosphereHaze,
  HazeAnchorError,
  hazeBoundaryFade,
  hazeExtinctionPerMetre,
  hazeTransmittance,
} from './atmosphere-haze.js';
import type { AtmosphereUniforms } from './atmosphere-luts.js';
import { mediumAt, mieExtinctionForVisibility } from './atmosphere-model.js';

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

/** Run a material's onBeforeCompile on three's real library shader. */
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

function haze() {
  const h = new AtmosphereHaze({ visibilityKm: 45 });
  h.sync({ sharedUniforms: sharedUniforms(), visibilityKm: 45 });
  return h;
}

describe('pure haze terms (the GLSL mirrors these)', () => {
  // The boundary fade has to COMPLETE at the fog's far distance, which is the
  // camera's far plane in OsmDemo: that is what makes the clip invisible.
  it('boundary fade is 0 at fog near, exactly 1 at fog far, and monotone', () => {
    expect(hazeBoundaryFade(100, 100, 400)).toBe(0);
    expect(hazeBoundaryFade(400, 100, 400)).toBe(1);
    expect(hazeBoundaryFade(900, 100, 400)).toBe(1);
    let previous = 0;
    for (let d = 100; d <= 400; d += 10) {
      const f = hazeBoundaryFade(d, 100, 400);
      expect(f).toBeGreaterThanOrEqual(previous);
      previous = f;
    }
  });

  // Physical extinction is the sea-level (observer-altitude) medium, per metre.
  it('extinction per metre is the medium at the observer, /1000', () => {
    const perKm = mediumAt(0.2, mieExtinctionForVisibility(45)).extinction;
    const perM = hazeExtinctionPerMetre(45, 0.2);
    for (let c = 0; c < 3; c++)
      expect(perM[c]).toBeCloseTo(perKm[c]! / 1000, 15);
  });

  // Hazier air hides distant geometry faster; blue goes first.
  it('transmittance falls with distance, faster in haze, blue first', () => {
    const clear = hazeTransmittance(5000, hazeExtinctionPerMetre(80, 0.2));
    const hazy = hazeTransmittance(5000, hazeExtinctionPerMetre(12, 0.2));
    expect(hazy[1]).toBeLessThan(clear[1]);
    expect(clear[2]).toBeLessThan(clear[0]);
  });
});

describe('AtmosphereHaze.apply', () => {
  // Every material family the demos use has the three anchors.
  it.each(['standard', 'physical', 'basic', 'lambert', 'phong'] as const)(
    'patches three’s real %s shader',
    (lib) => {
      const material = new THREE.MeshStandardMaterial();
      haze().apply(material);
      const shader = compile(material, lib);
      expect(shader.vertexShader).toContain(
        'vAtmViewPosition = mvPosition.xyz;'
      );
      expect(shader.fragmentShader).toContain('atmHazeMode');
      // Haze in LINEAR light, before tone mapping; the stock fog stays for mode 0.
      const hazeAt = shader.fragmentShader.indexOf('atmHazeKeep');
      const toneAt = shader.fragmentShader.indexOf(
        '#include <tonemapping_fragment>'
      );
      expect(hazeAt).toBeGreaterThan(0);
      expect(hazeAt).toBeLessThan(toneAt);
      expect(shader.fragmentShader).toContain('#include <fog_fragment>');
    }
  );

  // One update must reach every patched material: the haze's uniforms are
  // SHARED objects across materials, never per-material copies.
  it('attaches the haze uniform objects themselves', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    const shader = compile(material, 'standard');
    expect(shader.uniforms.atmHazeMode).toBe(h.uniforms.atmHazeMode);
    expect(shader.uniforms.atmSunDirection).toBe(h.uniforms.atmSunDirection);
  });

  // An existing patch (OsmDemo's ground displacement, cell emissive) must
  // still run, before the haze.
  it('chains an existing onBeforeCompile', () => {
    const material = new THREE.MeshStandardMaterial();
    const previous = vi.fn();
    material.onBeforeCompile = previous;
    haze().apply(material);
    compile(material, 'standard');
    expect(previous).toHaveBeenCalledTimes(1);
  });

  // Two materials whose OTHER patches differ must never share a program.
  // three's default key is onBeforeCompile.toString(), which would be the
  // same haze wrapper for both.
  it('keeps program cache keys distinct for different prior patches', () => {
    const h = haze();
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    a.onBeforeCompile = (s) => void (s.vertexShader += '// ground');
    b.onBeforeCompile = (s) => void (s.vertexShader += '// cell');
    h.apply(a);
    h.apply(b);
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).toContain('atmosphere-haze');
  });

  // Applying twice (a scene traversed twice) must not double-inject.
  it('is idempotent', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    const once = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    h.apply(material);
    expect(material.onBeforeCompile).toBe(once);
    expect(material.customProgramCacheKey()).toBe(key);
  });

  // A newer three that renames a chunk must fail HERE, by name, not render
  // a haze-less scene silently.
  it('throws a named error when an anchor is missing', () => {
    const material = new THREE.MeshStandardMaterial();
    haze().apply(material);
    const shader = {
      vertexShader: 'void main() {}',
      fragmentShader: 'void main() {}',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    expect(() =>
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    ).toThrow(HazeAnchorError);
  });

  it('applies to every fog-capable material in a subtree, once each', () => {
    const h = haze();
    const group = new THREE.Group();
    const shared = new THREE.MeshStandardMaterial();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
    group.add(
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    );
    const noFog = new THREE.MeshBasicMaterial({ fog: false });
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), noFog));
    expect(h.applyToObject(group)).toBe(2);
  });
});

describe('AtmosphereHaze modes and sync', () => {
  // AR renders the SAME material instances in another WebGL context, where
  // the desktop sky's LUT texture is meaningless. Fog mode swaps in a neutral
  // 1×1 texture and selects the stock fog; atmosphere mode restores the LUT.
  it('fog mode selects the stock fog and binds a neutral texture', () => {
    const shared = sharedUniforms();
    const h = new AtmosphereHaze({ visibilityKm: 45 });
    h.sync({ sharedUniforms: shared, visibilityKm: 45 });
    expect(h.uniforms.atmHazeMode.value).toBe(1);
    expect(h.uniforms.atmHazeSkyView.value).toBe(shared.atmSkyViewLut.value);
    h.setMode('fog');
    expect(h.uniforms.atmHazeMode.value).toBe(0);
    expect(h.uniforms.atmHazeSkyView.value).not.toBe(
      shared.atmSkyViewLut.value
    );
    h.setMode('atmosphere');
    expect(h.uniforms.atmHazeSkyView.value).toBe(shared.atmSkyViewLut.value);
  });

  // Before any atmosphere exists the haze must not sample an undefined
  // texture: it starts in fog mode with the neutral texture bound.
  it('starts in fog mode until the first sync', () => {
    const h = new AtmosphereHaze({ visibilityKm: 45 });
    expect(h.uniforms.atmHazeMode.value).toBe(0);
    expect(h.uniforms.atmHazeSkyView.value).toBeInstanceOf(THREE.DataTexture);
  });

  // THE LIFETIME RULE: patched materials hold the HAZE's uniform objects, so
  // replacing the atmosphere (the look-dev page's baseline switch, an app
  // rebuilding its sky) needs only a sync, never a re-patch.
  it('follows a replaced atmosphere through sync', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    const shader = compile(material, 'standard');
    const next = sharedUniforms();
    next.atmSunDirection.value.set(1, 0, 0);
    next.atmRadianceToScene.value = 0.5;
    h.sync({ sharedUniforms: next, visibilityKm: 45 });
    expect((shader.uniforms.atmSunDirection!.value as THREE.Vector3).x).toBe(1);
    expect(shader.uniforms.atmRadianceToScene.value).toBe(0.5);
    expect(shader.uniforms.atmHazeSkyView.value).toBe(next.atmSkyViewLut.value);
  });

  // Visibility drives the extinction; a density scale is the demos' knob.
  it('updates extinction from visibility and density scale', () => {
    const h = haze();
    const before = h.uniforms.atmHazeExtinction.value.y;
    h.sync({ sharedUniforms: sharedUniforms(), visibilityKm: 12 });
    expect(h.uniforms.atmHazeExtinction.value.y).toBeGreaterThan(before);
    const hazy = h.uniforms.atmHazeExtinction.value.y;
    h.setDensityScale(2);
    expect(h.uniforms.atmHazeExtinction.value.y).toBeCloseTo(2 * hazy, 12);
    expect(() => h.setDensityScale(-1)).toThrow(RangeError);
  });
});

describe('AtmosphereHaze (M2 review fixes)', () => {
  // Every fog-capable family applyToObject can reach must have the anchors
  // (review finding 6): OsmDemo's labels and lines meet the haze in M3.
  it.each(['points', 'sprite', 'dashed', 'toon', 'matcap'] as const)(
    'patches three’s real %s shader',
    (lib) => {
      const material = new THREE.MeshStandardMaterial();
      haze().apply(material);
      const shader = compile(material, lib);
      expect(shader.vertexShader).toContain(
        'vAtmViewPosition = mvPosition.xyz;'
      );
      expect(shader.fragmentShader).toContain('atmHazeKeep');
    }
  );

  // ORDER, not just "was called": the previous patch runs first, so it sees
  // three's shader, and the haze sees the previous patch's output.
  it('runs the previous onBeforeCompile BEFORE the haze', () => {
    const material = new THREE.MeshStandardMaterial();
    let sawHaze = true;
    material.onBeforeCompile = (shader) => {
      sawHaze = shader.fragmentShader.includes('atmHazeMode');
    };
    haze().apply(material);
    compile(material, 'standard');
    expect(sawHaze).toBe(false);
  });

  // A material belongs to ONE haze: a second instance applying to it would
  // otherwise be skipped silently, leaving the material bound to the first
  // (possibly disposed) haze's uniforms (review finding 7).
  it('refuses a material that another haze already owns', () => {
    const material = new THREE.MeshStandardMaterial();
    haze().apply(material);
    expect(() => haze().apply(material)).toThrow(/another AtmosphereHaze/);
  });

  // The Mie term depends on altitude (scale height 1.2 km); the haze must use
  // the atmosphere's observer, not its own default (review finding 8).
  it('takes the observer altitude from the synced atmosphere', () => {
    const low = new AtmosphereHaze({ visibilityKm: 20 });
    const high = new AtmosphereHaze({ visibilityKm: 20 });
    const shared = sharedUniforms();
    low.sync({ sharedUniforms: shared, visibilityKm: 20 });
    shared.atmObserverRadius.value = 6360 + 1.5;
    high.sync({ sharedUniforms: shared, visibilityKm: 20 });
    expect(high.uniforms.atmHazeExtinction.value.y).toBeLessThan(
      low.uniforms.atmHazeExtinction.value.y
    );
  });

  it('rejects a non-finite or negative observer altitude', () => {
    expect(
      () =>
        new AtmosphereHaze({ visibilityKm: 20, observerAltitudeKm: Number.NaN })
    ).toThrow(RangeError);
    expect(
      () => new AtmosphereHaze({ visibilityKm: 20, observerAltitudeKm: -1 })
    ).toThrow(RangeError);
  });

  // toneMapped:false materials sit in display-referred values; fading them
  // toward a scene-linear sky would overshoot (review finding 12).
  it('leaves toneMapped:false materials alone', () => {
    const h = haze();
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      )
    );
    expect(h.applyToObject(group)).toBe(0);
  });
});

describe('AtmosphereHaze self-heals a replaced onBeforeCompile (M3)', () => {
  // Any installer that ASSIGNS onBeforeCompile after the haze silently drops
  // it, and with the haze's own cache key still in place three would even
  // reuse the OLD program. OsmDemo's installers all run before the haze today
  // (M3 review, finding 2 corrected an earlier claim that a terrain change
  // re-installs one), so this is a guard for the next installer, not a
  // current path. A re-apply (the demo re-applies before each render) must
  // notice the replacement, patch again, and chain the new hook first.
  it('re-patches a material whose hook was replaced, chaining the new one first', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `// installer\n${shader.vertexShader}`;
    };
    h.apply(material);
    const shader = compile(material, 'standard');
    expect(shader.vertexShader.startsWith('// installer')).toBe(true);
    expect(shader.fragmentShader).toContain('atmHazeKeep');
  });

  it('gives the re-patched material a key that names the new hook', () => {
    const h = haze();
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    h.apply(a);
    h.apply(b);
    b.onBeforeCompile = (s) => void (s.vertexShader += '// ground');
    h.apply(b);
    expect(b.customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
    expect(b.customProgramCacheKey()).toContain('// ground');
    expect(b.customProgramCacheKey().match(/atmosphere-haze/g)).toHaveLength(1);
  });

  it('is still a no-op for an unchanged material, and applyToObject counts heals', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    expect(h.applyToObject(mesh)).toBe(1);
    const wrapper = material.onBeforeCompile;
    const version = material.version;
    expect(h.applyToObject(mesh)).toBe(0);
    expect(material.onBeforeCompile).toBe(wrapper);
    expect(material.version).toBe(version);
    material.onBeforeCompile = () => {};
    expect(h.applyToObject(mesh)).toBe(1);
    expect(material.onBeforeCompile).not.toBe(wrapper);
  });

  // A key someone set AFTER the haze (not the haze's own) is theirs, and is
  // kept as the prefix.
  it('keeps a custom key set after the haze', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    material.onBeforeCompile = () => {};
    material.customProgramCacheKey = () => 'mine';
    h.apply(material);
    expect(material.customProgramCacheKey()).toBe('mine|atmosphere-haze');
  });
});

describe('AtmosphereHaze.mode (M3)', () => {
  // The REQUESTED mode, so an AR session can restore exactly what it found
  // (applyArEnvironment switches to 'fog' and back).
  it('reports the requested mode, even before a sync supplies a LUT', () => {
    const h = haze();
    expect(h.mode).toBe('atmosphere');
    h.setMode('fog');
    expect(h.mode).toBe('fog');
  });
});

describe('AtmosphereHaze with a CHAINING installer after it (M3 review, finding 2)', () => {
  // The installer style the repo prescribes ("chain, never assign", as
  // ground-slope-shader.ts does): capture the current hook, call it, then
  // patch. Run after the haze, the new hook already CONTAINS the haze; the
  // heal wrapped it again, and the shader declared the haze's varyings and
  // uniforms twice, a compile error three only logs (the material silently
  // stops drawing).
  it('patches exactly once when the replaced hook already runs the haze', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    h.applyToObject(mesh);
    const hazeHook = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      hazeHook(shader, renderer);
      shader.vertexShader += '\n// installer';
    };
    h.applyToObject(mesh);
    const shader = compile(material, 'standard');
    expect(
      shader.vertexShader.match(/varying vec3 vAtmViewPosition;/g)
    ).toHaveLength(1);
    expect(
      shader.fragmentShader.match(/uniform float atmHazeMode;/g)
    ).toHaveLength(1);
    expect(shader.vertexShader).toContain('// installer');
  });
});

describe('AtmosphereHaze.setVeil (a haze colour of its own)', () => {
  // WHY: an app may want its distance to fade toward a colour it chooses
  // rather than toward the sky in the view direction (OsmDemo's light dialog
  // tunes a bright veil while the sky stays as it is). Off by default, so
  // every existing haze renders exactly as before: the shader mixes with a
  // weight of 0, which returns the sky colour unchanged.
  it('is off by default, and a set veil is a scene-linear colour with weight 1', () => {
    const h = haze();
    expect(h.uniforms.atmHazeVeilOn.value).toBe(0);
    expect(h.veil).toBeNull();
    h.setVeil([0.5, 0.6, 0.7]);
    expect(h.uniforms.atmHazeVeilOn.value).toBe(1);
    expect(h.uniforms.atmHazeVeil.value.toArray()).toEqual([0.5, 0.6, 0.7]);
    expect(h.veil).toEqual([0.5, 0.6, 0.7]);
    h.setVeil(null);
    expect(h.uniforms.atmHazeVeilOn.value).toBe(0);
    expect(h.veil).toBeNull();
  });

  // WHY: a sync copies the atmosphere's state; the veil is the app's, so a
  // sun move or an exposure change must not drop it.
  it('survives a sync, and reaches patched materials through shared uniforms', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    const shader = compile(material, 'standard');
    h.setVeil([0.2, 0.3, 0.4]);
    h.sync({ sharedUniforms: sharedUniforms(), visibilityKm: 20 });
    expect(shader.uniforms.atmHazeVeilOn.value).toBe(1);
    expect(shader.uniforms.atmHazeVeil).toBe(h.uniforms.atmHazeVeil);
  });

  // WHY: the veil replaces the sky's in-scatter colour, so it must enter
  // AFTER the sky-view lookup and before the blend that uses it; in the
  // stock-fog branch (AR) it has no part at all.
  it('mixes into the in-scatter colour after the sky lookup, only in atmosphere mode', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    const f = compile(material, 'standard').fragmentShader;
    const lookupAt = f.indexOf('vec3 atmHazeSky = texture2D(');
    const veilAt = f.indexOf(
      'atmHazeSky = mix(atmHazeSky * atmHazeSkyBalance, atmHazeVeil, atmHazeVeilOn);'
    );
    const blendAt = f.indexOf(
      'gl_FragColor.rgb = gl_FragColor.rgb * atmHazeKeep'
    );
    expect(lookupAt).toBeGreaterThan(0);
    expect(veilAt).toBeGreaterThan(lookupAt);
    expect(blendAt).toBeGreaterThan(veilAt);
    expect(f.indexOf('if (atmHazeMode > 0.5)')).toBeLessThan(veilAt);
  });

  it('refuses a colour that is not three finite values of at least 0, changing nothing', () => {
    const h = haze();
    h.setVeil([0.1, 0.1, 0.1]);
    for (const bad of [
      [Number.NaN, 0, 0],
      [0, -0.01, 0],
      [0, 0, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(() => h.setVeil(bad)).toThrow(RangeError);
    }
    expect(h.veil).toEqual([0.1, 0.1, 0.1]);
  });
});

describe('AtmosphereHaze.setRim (the edge of a world that ends)', () => {
  // WHY: a ground that stops (a tile of a few km) shows its edge against the
  // void unless the haze has fully covered it there. The rim makes the
  // boundary fade complete by a distance from the ground's centre, whatever
  // the draw distance. Off by default, so every existing haze is unchanged.
  it('is off by default, and a set rim is its centre and its two radii', () => {
    const h = haze();
    expect(h.uniforms.atmHazeRimOn.value).toBe(0);
    expect(h.rim).toBeNull();
    h.setRim({ x: 10, z: -20 }, 1800, 2400);
    expect(h.uniforms.atmHazeRimOn.value).toBe(1);
    expect(h.uniforms.atmHazeRim.value.toArray()).toEqual([
      10, -20, 1800, 2400,
    ]);
    expect(h.rim).toEqual({
      centre: { x: 10, z: -20 },
      innerM: 1800,
      outerM: 2400,
    });
    h.setRim(null);
    expect(h.uniforms.atmHazeRimOn.value).toBe(0);
    expect(h.rim).toBeNull();
  });

  // WHY: the rim only raises the boundary fade, so it can never make a near
  // thing clearer than the draw distance's own fade would; and it measures
  // in the world (the ground's frame), not from the camera.
  it('raises the boundary fade by the world distance from the centre, in atmosphere mode only', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    const f = compile(material, 'standard').fragmentShader;
    const boundaryAt = f.indexOf('float atmBoundary');
    const rimAt = f.indexOf(
      'atmBoundary = max(atmBoundary, smoothstep(atmHazeRim.z, atmHazeRim.w,'
    );
    const keepAt = f.indexOf('vec3 atmHazeKeep');
    expect(boundaryAt).toBeGreaterThan(0);
    expect(rimAt).toBeGreaterThan(boundaryAt);
    expect(keepAt).toBeGreaterThan(rimAt);
    expect(f).toContain(
      'cameraPosition + (vec4(vAtmViewPosition, 0.0) * viewMatrix).xyz'
    );
    expect(f.indexOf('if (atmHazeMode > 0.5)')).toBeLessThan(rimAt);
  });

  // WHY: GLSL ES leaves smoothstep undefined when its edges do not rise,
  // and a NaN from it is not masked by a weight of 0 (0 * NaN is NaN, and
  // max() with a NaN may return it). So with no rim set the term is not
  // evaluated at all, and the uniform's edges rise even before any setRim,
  // for every consumer of the haze.
  it('never evaluates the rim term while the rim is off, and its default edges rise', () => {
    const h = haze();
    const [, , inner, outer] = h.uniforms.atmHazeRim.value.toArray();
    expect(outer).toBeGreaterThan(inner);
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    const f = compile(material, 'standard').fragmentShader;
    const guardAt = f.indexOf('if (atmHazeRimOn > 0.5) {');
    const rimAt = f.indexOf('smoothstep(atmHazeRim.z, atmHazeRim.w,');
    expect(guardAt).toBeGreaterThan(0);
    expect(rimAt).toBeGreaterThan(guardAt);
    expect(f).not.toContain('atmHazeRimOn * smoothstep');
  });

  it('refuses radii that do not rise or a centre that is not finite, changing nothing', () => {
    const h = haze();
    h.setRim({ x: 0, z: 0 }, 100, 200);
    expect(() => h.setRim({ x: 0, z: 0 }, 200, 200)).toThrow(RangeError);
    expect(() => h.setRim({ x: 0, z: 0 }, -1, 200)).toThrow(RangeError);
    expect(() => h.setRim({ x: Number.NaN, z: 0 }, 100, 200)).toThrow(
      RangeError
    );
    expect(() =>
      h.setRim({ x: 0, z: 0 }, 100, Number.POSITIVE_INFINITY)
    ).toThrow(RangeError);
    expect(h.rim).toEqual({ centre: { x: 0, z: 0 }, innerM: 100, outerM: 200 });
  });
});

describe('AtmosphereHaze.setSkyBalance (the sky balance reaches the haze)', () => {
  // WHY: the haze fades the distance toward the sky in the view direction.
  // When the visible sky takes a balance (SkyAtmosphere.setSkyBalance) the
  // haze must take the same gain, or the distance fades toward the sky the
  // model drew rather than the one on screen, and a seam shows.
  it('is neutral by default, and a set gain is kept and shown', () => {
    const h = haze();
    expect(h.uniforms.atmHazeSkyBalance.value.toArray()).toEqual([1, 1, 1]);
    expect(h.skyBalance).toBeNull();
    h.setSkyBalance([0.8, 1, 1.2]);
    expect(h.uniforms.atmHazeSkyBalance.value.toArray()).toEqual([0.8, 1, 1.2]);
    expect(h.skyBalance).toEqual([0.8, 1, 1.2]);
    h.setSkyBalance(null);
    expect(h.uniforms.atmHazeSkyBalance.value.toArray()).toEqual([1, 1, 1]);
    expect(h.skyBalance).toBeNull();
  });

  // WHY: a sync copies the atmosphere's state (a sun move, an exposure
  // change); the balance is the app's, so a sync must not drop it, and a
  // patched material must read the haze's own uniform object, or a later
  // setSkyBalance would never reach a material compiled before it.
  it('survives a sync, and reaches patched materials through shared uniforms', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    const shader = compile(material, 'standard');
    h.setSkyBalance([0.8, 1, 1.2]);
    h.sync({ sharedUniforms: sharedUniforms(), visibilityKm: 20 });
    expect(shader.uniforms.atmHazeSkyBalance).toBe(
      h.uniforms.atmHazeSkyBalance
    );
    // The same object, so the typed handle reads what the shader reads.
    expect(h.uniforms.atmHazeSkyBalance.value.toArray()).toEqual([0.8, 1, 1.2]);
  });

  it('applies to the sky lookup, and the veil replaces the balanced sky', () => {
    const h = haze();
    const material = new THREE.MeshStandardMaterial();
    h.apply(material);
    const f = compile(material, 'standard').fragmentShader;
    expect(
      f.indexOf(
        'atmHazeSky = mix(atmHazeSky * atmHazeSkyBalance, atmHazeVeil, atmHazeVeilOn);'
      )
    ).toBeGreaterThan(f.indexOf('vec3 atmHazeSky = texture2D('));
  });

  it('refuses a gain that is not three finite values of at least 0, changing nothing', () => {
    const h = haze();
    h.setSkyBalance([1.1, 1, 0.9]);
    for (const bad of [
      [Number.NaN, 1, 1],
      [1, -0.01, 1],
      [1, 1, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(() => h.setSkyBalance(bad)).toThrow(RangeError);
    }
    expect(h.skyBalance).toEqual([1.1, 1, 0.9]);
  });
});
