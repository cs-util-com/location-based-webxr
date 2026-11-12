/**
 * Tests for the 3D apps' ambient occlusion, without a GPU: three's REAL
 * `GTAOPass` runs against a recording renderer.
 *
 * Why this file matters: the AO is multiplied onto a frame that is already
 * finished, so every way it can go wrong is silent. An object the AO's
 * normal/depth pass should not see (the sky, a transparent overlay) puts
 * geometry into the AO's depth that the frame never had. An object it hides
 * and then makes visible again (three's own restore does exactly that for
 * lines and points) changes the next frame. A shadow map re-rendered inside
 * the pass doubles its cost. A denoise noise taken from `Math.random` makes
 * every page load look slightly different. And a switch that is off must
 * cost nothing at all: no pass, no draw, no allocation.
 *
 * @see ambient-occlusion.ts.md
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AO_DENOISE,
  AO_NOISE_SEED,
  AO_PARAMS,
  aoBlendFactor,
  aoNoiseRandom,
  aoNoiseTexture,
  createAmbientOcclusion,
  hiddenFromAoNormals,
} from './ambient-occlusion.js';

/** The 3D apps' kinds of object, each named for the assertion messages. */
function appLikeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const named = <T extends THREE.Object3D>(object: T, name: string): T => {
    object.name = name;
    scene.add(object);
    return object;
  };
  // The physical sky: drawn at the far plane by its own shader, no depth write.
  named(
    new THREE.Mesh(
      box,
      new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false })
    ),
    'sky'
  );
  // A transparent overlay (the heat grid, the route): no depth write.
  named(
    new THREE.Mesh(
      box,
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
    ),
    'overlay'
  );
  named(new THREE.Mesh(box, new THREE.MeshStandardMaterial()), 'building');
  named(new THREE.Mesh(box, new THREE.MeshStandardMaterial()), 'ground');
  named(
    new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial(), 4),
    'furniture'
  );
  named(new THREE.Sprite(new THREE.SpriteMaterial()), 'label');
  named(new THREE.Line(box, new THREE.LineBasicMaterial()), 'line');
  named(new THREE.Points(box, new THREE.PointsMaterial()), 'points');
  // Hidden by the app before the AO runs: must STAY hidden afterwards.
  const hiddenLine = named(
    new THREE.Line(box, new THREE.LineBasicMaterial()),
    'hidden-line'
  );
  hiddenLine.visible = false;
  const hiddenMesh = named(
    new THREE.Mesh(box, new THREE.MeshStandardMaterial()),
    'hidden-mesh'
  );
  hiddenMesh.visible = false;
  return scene;
}

interface Draw {
  target: THREE.WebGLRenderTarget | null;
  override: THREE.Material | null;
  material: THREE.Material | null;
  visible: string[];
  shadowAutoUpdate: boolean;
  shadowNeedsUpdate: boolean;
}

/** A renderer that records, per draw, the target and what was visible. */
function recordingRenderer(size = { x: 400, y: 300 }) {
  let target: THREE.WebGLRenderTarget | null = null;
  const draws: Draw[] = [];
  const fake = {
    draws,
    size,
    autoClear: true,
    shadowMap: { autoUpdate: true, needsUpdate: true },
    getClearColor: (c: THREE.Color) => c.set(0x000000),
    getClearAlpha: () => 1,
    setClearColor() {},
    setClearAlpha() {},
    clear() {},
    getRenderTarget: () => target,
    setRenderTarget(t: THREE.WebGLRenderTarget | null) {
      target = t;
    },
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(fake.size.x, fake.size.y),
    render(scene: THREE.Object3D) {
      const visible: string[] = [];
      scene.traverseVisible((o) => {
        if (o.name) visible.push(o.name);
      });
      const isScene = (scene as THREE.Scene).isScene === true;
      draws.push({
        target,
        override: isScene ? (scene as THREE.Scene).overrideMaterial : null,
        material: isScene
          ? null
          : ((scene as THREE.Mesh).material as THREE.Material),
        visible,
        shadowAutoUpdate: fake.shadowMap.autoUpdate,
        shadowNeedsUpdate: fake.shadowMap.needsUpdate,
      });
    },
  };
  return fake;
}

const camera = (): THREE.PerspectiveCamera => {
  const c = new THREE.PerspectiveCamera(55, 4 / 3, 0.5, 2400);
  c.updateProjectionMatrix();
  return c;
};

type Fake = ReturnType<typeof recordingRenderer>;
const asRenderer = (fake: Fake): THREE.WebGLRenderer =>
  fake as unknown as THREE.WebGLRenderer;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hiddenFromAoNormals', () => {
  // The rule decides what the AO's depth contains. Everything that writes
  // depth in the frame must be there (or its creases vanish); everything
  // that does not must be absent (or it occludes what is behind it).
  it('leaves out sprites, lines and points', () => {
    expect(hiddenFromAoNormals(new THREE.Sprite())).toBe(true);
    expect(hiddenFromAoNormals(new THREE.Line())).toBe(true);
    expect(hiddenFromAoNormals(new THREE.LineSegments())).toBe(true);
    expect(hiddenFromAoNormals(new THREE.Points())).toBe(true);
  });

  it('keeps an opaque, depth-writing mesh and never hides a group', () => {
    expect(
      hiddenFromAoNormals(
        new THREE.Mesh(undefined, new THREE.MeshStandardMaterial())
      )
    ).toBe(false);
    expect(hiddenFromAoNormals(new THREE.Group())).toBe(false);
    expect(hiddenFromAoNormals(new THREE.Object3D())).toBe(false);
  });

  it('leaves out a mesh none of whose materials would write depth', () => {
    const noDepth = new THREE.MeshBasicMaterial({ depthWrite: false });
    const transparent = new THREE.MeshBasicMaterial({ transparent: true });
    const invisible = new THREE.MeshBasicMaterial({ visible: false });
    expect(hiddenFromAoNormals(new THREE.Mesh(undefined, noDepth))).toBe(true);
    // A transparent mesh that does write depth is still left out: its pixels
    // get the AO of what is behind it.
    expect(hiddenFromAoNormals(new THREE.Mesh(undefined, transparent))).toBe(
      true
    );
    expect(hiddenFromAoNormals(new THREE.Mesh(undefined, invisible))).toBe(
      true
    );
    expect(
      hiddenFromAoNormals(
        new THREE.Mesh(undefined, [noDepth, new THREE.MeshStandardMaterial()])
      )
    ).toBe(false);
  });
});

describe('aoNoiseRandom', () => {
  it('is a fixed sequence per seed, in [0, 1)', () => {
    const a = aoNoiseRandom(7);
    const b = aoNoiseRandom(7);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const c = aoNoiseRandom(8);
    expect(c()).not.toBe(seqA[0]);
  });

  it('throws a RangeError for a seed that is not an integer', () => {
    expect(() => aoNoiseRandom(1.5)).toThrow(RangeError);
    expect(() => aoNoiseRandom(Number.NaN)).toThrow(RangeError);
    expect(() => aoNoiseRandom(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('aoNoiseTexture', () => {
  // Why: three builds this noise from Math.random, so the denoised AO
  // differed per page load. The same seed must give the same texture
  // whatever Math.random returns.
  it('is the same on every build whatever Math.random returns', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const first = aoNoiseTexture(AO_NOISE_SEED);
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const second = aoNoiseTexture(AO_NOISE_SEED);
    expect(Array.from(first.image.data as Uint8Array)).toEqual(
      Array.from(second.image.data as Uint8Array)
    );
    expect(Array.from(aoNoiseTexture(2).image.data as Uint8Array)).not.toEqual(
      Array.from(first.image.data as Uint8Array)
    );
  });

  it('is a 64 x 64 repeating RGBA8 texture with spread-out values', () => {
    const t = aoNoiseTexture(AO_NOISE_SEED);
    expect(t.image.width).toBe(64);
    expect(t.image.height).toBe(64);
    expect(t.format).toBe(THREE.RGBAFormat);
    expect(t.type).toBe(THREE.UnsignedByteType);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(t.wrapT).toBe(THREE.RepeatWrapping);
    const data = t.image.data as Uint8Array;
    expect(data.length).toBe(64 * 64 * 4);
    expect(Math.min(...data)).toBeLessThan(40);
    expect(Math.max(...data)).toBeGreaterThan(215);
  });
});

describe('AO_PARAMS and AO_DENOISE', () => {
  it('are frozen metre-scale values with a fade window that opens', () => {
    expect(Object.isFrozen(AO_PARAMS)).toBe(true);
    expect(Object.isFrozen(AO_DENOISE)).toBe(true);
    expect(AO_PARAMS.screenSpaceRadius).toBe(false);
    expect(AO_PARAMS.fadeStartM).toBeLessThan(AO_PARAMS.fadeEndM);
  });
});

describe('createAmbientOcclusion', () => {
  it('when off, draws nothing and builds nothing', () => {
    // Why: `ao=off` and the switched-off toggle must leave the frame exactly
    // as it was drawn, with no pass constructed.
    const fake = recordingRenderer();
    const ao = createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
      enabled: false,
    });
    expect(ao.render()).toBe(false);
    expect(fake.draws).toEqual([]);
    expect(ao.built).toBe(false);
  });

  it('draws the normal/depth pass without the left-out objects', () => {
    const fake = recordingRenderer();
    const ao = createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
    });
    expect(ao.render()).toBe(true);
    const normals = fake.draws.find(
      (d) => d.override instanceof THREE.MeshNormalMaterial
    );
    expect(normals, 'the normal/depth pass ran').toBeDefined();
    expect(normals!.target).not.toBeNull();
    expect(normals!.visible.sort()).toEqual([
      'building',
      'furniture',
      'ground',
    ]);
  });

  it('restores every object to the visibility it had before', () => {
    // Why: three's own restore sets lines and points to visible = true,
    // which would show a line the app had hidden on the next frame.
    const fake = recordingRenderer();
    const scene = appLikeScene();
    const before = new Map<string, boolean>();
    scene.traverse((o) => before.set(o.name, o.visible));
    const ao = createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene,
      camera: camera(),
    });
    ao.render();
    scene.traverse((o) => expect(o.visible, o.name).toBe(before.get(o.name)));
  });

  it('never patches a content material', () => {
    const fake = recordingRenderer();
    const scene = appLikeScene();
    const snapshot = new Map<THREE.Material, number>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof THREE.Material) snapshot.set(m, m.version);
    });
    createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene,
      camera: camera(),
    }).render();
    for (const [m, version] of snapshot) {
      expect(m.version).toBe(version);
      expect(m.onBeforeCompile.toString()).toBe(
        THREE.Material.prototype.onBeforeCompile.toString()
      );
    }
    expect(scene.overrideMaterial).toBeNull();
  });

  it('multiplies onto the target that was current, last, without a clear', () => {
    const fake = recordingRenderer();
    const ao = createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
    });
    let clearedOnBlend = false;
    fake.clear = () => {
      if (fake.getRenderTarget() === null) clearedOnBlend = true;
    };
    ao.render();
    const last = fake.draws.at(-1)!;
    expect(last.target).toBeNull();
    const m = last.material as THREE.ShaderMaterial;
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendSrc).toBe(THREE.DstColorFactor);
    expect(m.blendDst).toBe(THREE.ZeroFactor);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(clearedOnBlend).toBe(false);
    expect(fake.getRenderTarget()).toBeNull();
    expect(fake.autoClear).toBe(true);
  });

  it('keeps the shadow maps out of its own pass and restores their flags', () => {
    // Why: the normal/depth pass is a full renderer.render; with the shadow
    // map flags left on it would re-render every shadow map inside the AO.
    const fake = recordingRenderer();
    fake.shadowMap.autoUpdate = true;
    fake.shadowMap.needsUpdate = true;
    createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
    }).render();
    for (const d of fake.draws) {
      expect(d.shadowAutoUpdate).toBe(false);
      expect(d.shadowNeedsUpdate).toBe(false);
    }
    expect(fake.shadowMap.autoUpdate).toBe(true);
    expect(fake.shadowMap.needsUpdate).toBe(true);
  });

  it('fades with view depth from the camera of the frame and the given window', () => {
    const fake = recordingRenderer();
    const cam = camera();
    const ao = createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: cam,
      params: { fadeStartM: 700, fadeEndM: 1400, intensity: 0.8 },
    });
    cam.far = 4000;
    cam.updateProjectionMatrix();
    ao.render();
    const u = (fake.draws.at(-1)!.material as THREE.ShaderMaterial).uniforms;
    expect(u['fadeStart']!.value).toBe(700);
    expect(u['fadeEnd']!.value).toBe(1400);
    expect(u['intensity']!.value).toBe(0.8);
    expect(u['cameraNear']!.value).toBe(0.5);
    expect(u['cameraFar']!.value).toBe(4000);
    expect(ao.params.radius).toBe(AO_PARAMS.radius);
  });

  it('carries the linear factor into display space with the 1 / 2.2 exponent', () => {
    // Why: the canvas the blend multiplies is already tone-mapped and
    // sRGB-encoded. Without the exponent a crease darkens by the encoded
    // factor (much darker in the mid-tones); a changed exponent changes the
    // look the e2e bounds were measured against.
    const fake = recordingRenderer();
    createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
    }).render();
    const m = fake.draws.at(-1)!.material as THREE.ShaderMaterial;
    expect(m.uniforms['displayExponent']!.value).toBeCloseTo(1 / 2.2, 12);
    expect(m.fragmentShader).toContain(
      'pow(max(factor, 0.0), displayExponent)'
    );
  });

  it('takes a display exponent of 1 for the stronger, linear-strength AO', () => {
    // Why: OsmDemo's `ao=strong` link lets the owner compare the shipped
    // display-space AO with the linear factor multiplied straight onto the
    // encoded canvas (darker creases). The option must reach the blend, and
    // leaving it out must keep the shipped 1 / 2.2 (pinned above).
    const fake = recordingRenderer();
    createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
      displayExponent: 1,
    }).render();
    const m = fake.draws.at(-1)!.material as THREE.ShaderMaterial;
    expect(m.uniforms['displayExponent']!.value).toBe(1);
  });

  it('blends with the same expression aoBlendFactor computes', () => {
    // Why: the property tests pin aoBlendFactor's shape, but the GPU runs the
    // shader. This holds the shader's factor and fade to the TS twin, so a
    // change to one that is not made to the other fails here.
    const fake = recordingRenderer();
    createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
    }).render();
    const shader = (
      fake.draws.at(-1)!.material as THREE.ShaderMaterial
    ).fragmentShader
      .replace(/texture2D\(tAo, vUv\)\.r/g, 'ao')
      .replace(/(\d)\.0\b/g, '$1')
      .replace(/\s+/g, ' ');
    const twin = aoBlendFactor.toString().replace(/\s+/g, ' ');
    const factor = '1 + (ao - 1) * intensity * keep';
    expect(shader).toContain(`factor = ${factor};`);
    expect(twin).toContain(factor);
    expect(shader).toContain(
      'keep = 1 - smoothstep(fadeStart, fadeEnd, viewDepth);'
    );
    // The transpiler may rewrite the imported call, e.g. `(0, x.smoothstep)(`.
    expect(twin).toMatch(
      /keep = 1 - [\w$.(), ]*smoothstep\)?\(fadeStartM, fadeEndM, viewDepthM\)/
    );
  });

  it('sizes its targets from the drawing buffer and the resolution scale', () => {
    const fake = recordingRenderer({ x: 400, y: 300 });
    const ao = createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
      resolutionScale: 0.5,
    });
    ao.render();
    const normals = fake.draws.find((d) => d.override !== null)!;
    expect([normals.target!.width, normals.target!.height]).toEqual([200, 150]);
    fake.size = { x: 1000, y: 501 };
    fake.draws.length = 0;
    ao.render();
    const again = fake.draws.find((d) => d.override !== null)!;
    expect([again.target!.width, again.target!.height]).toEqual([500, 251]);
  });

  it('uses the seeded denoise noise', () => {
    const fake = recordingRenderer();
    const ao = createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
    });
    ao.render();
    const noise = ao.pass!.pdMaterial.uniforms['tNoise']!
      .value as THREE.DataTexture;
    expect(noise).toBe(ao.pass!.pdNoiseTexture);
    expect(Array.from(noise.image.data as Uint8Array)).toEqual(
      Array.from(aoNoiseTexture(AO_NOISE_SEED).image.data as Uint8Array)
    );
  });

  it('is built lazily, kept when switched off, and frees everything on dispose', () => {
    const fake = recordingRenderer();
    const ao = createAmbientOcclusion({
      renderer: asRenderer(fake),
      scene: appLikeScene(),
      camera: camera(),
      enabled: false,
    });
    expect(ao.pass).toBeNull();
    ao.enabled = true;
    ao.render();
    const pass = ao.pass!;
    ao.enabled = false;
    fake.draws.length = 0;
    expect(ao.render()).toBe(false);
    expect(fake.draws).toEqual([]);
    expect(ao.pass).toBe(pass);

    const freed = [
      vi.spyOn(pass, 'dispose'),
      vi.spyOn(pass.gtaoMaterial, 'dispose'),
      vi.spyOn(pass.pdNoiseTexture, 'dispose'),
      // three's own dispose leaves its unused blend material behind too.
      vi.spyOn(pass.blendMaterial, 'dispose'),
    ];
    const blend = vi.fn();
    ao.enabled = true;
    ao.render();
    (fake.draws.at(-1)!.material as THREE.Material).addEventListener(
      'dispose',
      blend
    );
    ao.dispose();
    for (const spy of freed) expect(spy).toHaveBeenCalled();
    expect(blend).toHaveBeenCalled();
    expect(ao.pass).toBeNull();
    fake.draws.length = 0;
    expect(ao.render()).toBe(false);
    expect(fake.draws).toEqual([]);
  });

  it('rejects options outside their range', () => {
    const base = {
      renderer: asRenderer(recordingRenderer()),
      scene: appLikeScene(),
      camera: camera(),
    };
    expect(() =>
      createAmbientOcclusion({ ...base, resolutionScale: 0 })
    ).toThrow(RangeError);
    expect(() =>
      createAmbientOcclusion({ ...base, resolutionScale: 1.5 })
    ).toThrow(RangeError);
    for (const displayExponent of [0, -1, Number.NaN, Infinity]) {
      expect(() =>
        createAmbientOcclusion({ ...base, displayExponent })
      ).toThrow(RangeError);
    }
    expect(() => createAmbientOcclusion({ ...base, noiseSeed: 1.5 })).toThrow(
      RangeError
    );
    expect(() =>
      createAmbientOcclusion({
        ...base,
        params: { fadeStartM: 700, fadeEndM: 700 },
      })
    ).toThrow(RangeError);
    expect(() =>
      createAmbientOcclusion({ ...base, params: { intensity: -0.1 } })
    ).toThrow(RangeError);
    expect(() =>
      createAmbientOcclusion({ ...base, params: { radius: Number.NaN } })
    ).toThrow(RangeError);
  });
});
