/**
 * The near clouds' drawing pass: the march of `globe-cloud-march-glsl.ts`
 * into a half-float target allocated once, of which each frame draws the
 * share the distance scale asks for, and their shadow on the ground into a
 * second. It only draws: the mix with the clouds above it, the tent filter
 * and the tone curve are the shell's composite
 * (`globe-cloud-shell-volume-pass.ts`), so there is one composite and the
 * hand-over keeps the opacity.
 *
 * Its geometry: the ellipsoid scaled to the march's sphere, turned by the
 * map's drift, so the camera moving over the Earth and the wind moving the
 * map under it are one motion (`globe-cloud-march-frame.ts`). The march
 * then needs no rotation of its own; the map is read by the ellipsoid's
 * normal, as the shell reads it.
 *
 * @see globe-cloud-march-pass.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import { CLOUD_BAKE_SIZES, type CloudBakes } from "./globe-cloud-bake.js";
import {
  CLOUD_MARCH_RADIUS_KM,
  type CloudWeatherFrame,
  advanceCloudWeatherFrame,
  cloudWeatherFrameAt,
} from "./globe-cloud-march-frame.js";
import {
  CLOUD_MARCH_FRAGMENT,
  CLOUD_MARCH_SHADOW_FRAGMENT,
  CLOUD_MARCH_VERTEX,
} from "./globe-cloud-march-glsl.js";
import {
  CLOUD_COVER_LAW,
  CLOUD_FAR_MARCH,
  CLOUD_LIFE_SPEED,
  CLOUD_MARCH_LAYER,
  cloudHazeReachKm,
  cloudLifeClock,
  cloudTargetSize,
  cloudViewSettings,
} from "./globe-cloud-march-law.js";
import { cloudMarchLight } from "./globe-cloud-march-light.js";
import type { GlobeQuality } from "./globe-quality.js";
import type { GlobeSceneDepth } from "./globe-scene-depth.js";
import type { GlobeSurfaceUniforms } from "./globe-surface-material.js";

/** The height the haze's reach is taken for: the layer's middle (km). */
const MID_KM = 0.5 * (CLOUD_MARCH_LAYER.baseKm + CLOUD_MARCH_LAYER.topKm);
/** The light the haze leaves where the clouds start to fade, and end. */
const HAZE_FADE = 0.1;
const HAZE_END = 0.01;

/** A mipped, repeating tile of bytes. */
function tile2d(data: Uint8Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** A mipped, repeating volume of one channel. */
function tile3d(data: Uint8Array, size: number): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** The start offsets: read per texel, no filter, no mips. */
function blueTile(data: Uint8Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The bakes as textures.
 *
 * @throws RangeError for a tile of the wrong size.
 */
function bakedTextures(bakes: CloudBakes) {
  const s = CLOUD_BAKE_SIZES;
  const sizes: [Uint8Array, number][] = [
    [bakes.shape, s.shape ** 3],
    [bakes.detail, s.detail ** 3],
    [bakes.domes, 4 * s.domes ** 2],
    [bakes.region, 4 * s.region ** 2],
    [bakes.blue, s.blue ** 2],
  ];
  for (const [data, length] of sizes) {
    if (data.length !== length) {
      throw new RangeError(
        `a cloud tile must have ${length} bytes, got ${data.length}`,
      );
    }
  }
  return {
    shape: tile3d(bakes.shape, s.shape),
    detail: tile3d(bakes.detail, s.detail),
    domes: tile2d(bakes.domes, s.domes),
    region: tile2d(bakes.region, s.region),
    blue: blueTile(bakes.blue, s.blue),
  };
}

const cloudTarget = (type: THREE.TextureDataType) =>
  new THREE.WebGLRenderTarget(1, 1, {
    type,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

/** What the pass is told each frame. */
export interface CloudMarchFrame {
  readonly camera: THREE.PerspectiveCamera;
  /** The frame's placement (the tiles group's world matrix). */
  readonly worldFromEcef: THREE.Matrix4;
  /** The sun, a unit vector in ECEF. */
  readonly sunEcef: THREE.Vector3;
  /** The life cycle's clock (s): the map's drift time. */
  readonly timeS: number;
  readonly quality: GlobeQuality["clouds"];
  /** The step-down's share of the law's pixels, (0, 1]. */
  readonly pixelScale: number;
  /** The relief's depth drawn this frame, or null. */
  readonly sceneDepth: Pick<GlobeSceneDepth, "texture" | "camera"> | null;
  /** The ground shadow's strength; 0 draws none. */
  readonly shadow: number;
}

interface GlobeCloudMarchOptions {
  readonly ellipsoid: Pick<Ellipsoid, "radius">;
  /** The globe surface's map and drift (shared, not copied). */
  readonly surfaceUniforms: Pick<
    GlobeSurfaceUniforms,
    "uClouds" | "uCloudLonOffset"
  >;
  /** The speed of the life cycle (default `CLOUD_LIFE_SPEED`). */
  readonly lifeSpeed?: number;
}

type MarchUniforms = ReturnType<typeof marchUniforms>;

/** What the air behind the clouds reads of the march's frame. */
export type CloudAirUniforms = Pick<
  MarchUniforms,
  | "uH"
  | "uFwd"
  | "uRight"
  | "uUp"
  | "uTan"
  | "uSun"
  | "uSunCol"
  | "uSceneDepth"
  | "uSceneInverseProjection"
  | "uSceneDepthOn"
>;

function marchUniforms(map: { value: unknown }) {
  return {
    uH: { value: 0 },
    uFwd: { value: new THREE.Vector3() },
    uRight: { value: new THREE.Vector3() },
    uUp: { value: new THREE.Vector3() },
    uTan: { value: new THREE.Vector2(1, 1) },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uPixAng: { value: 0 },
    uSunCol: { value: new THREE.Vector3() },
    uDetailW: { value: 0 },
    uDnMean: { value: 0.5 },
    uCloudSun: { value: new THREE.Vector3() },
    uAmbTop: { value: new THREE.Vector3() },
    uAmbBot: { value: new THREE.Vector3() },
    uQ0: { value: new THREE.Vector2() },
    uCB: { value: CLOUD_MARCH_LAYER.baseKm },
    uCT: { value: CLOUD_MARCH_LAYER.topKm },
    uPhase: { value: 0 },
    uBillow: { value: new THREE.Vector2() },
    uDomes: { value: null as THREE.Texture | null },
    uRegion: { value: null as THREE.Texture | null },
    uShape: { value: null as THREE.Texture | null },
    uDetail: { value: null as THREE.Texture | null },
    uBlue: { value: null as THREE.Texture | null },
    uDeck: {
      value: new THREE.Vector3(
        CLOUD_COVER_LAW.deckLevel,
        CLOUD_COVER_LAW.deckRelief,
        1,
      ),
    },
    uMap: map,
    uEcef: { value: new THREE.Matrix3() },
    uMapSkew: { value: new THREE.Vector3(1, 1, 1) },
    uLifeGain: { value: 1 },
    uRcT: { value: [...CLOUD_COVER_LAW.domes] },
    uOvT: { value: [...CLOUD_COVER_LAW.deck] },
    uSceneDepth: { value: null as THREE.Texture | null },
    uSceneInverseProjection: { value: new THREE.Matrix4() },
    uSceneDepthOn: { value: 0 },
    uTMax: { value: 1 },
    uTFade: { value: 1 },
    uGrowA: { value: CLOUD_FAR_MARCH.growAfterKm },
    uGrowG: { value: CLOUD_FAR_MARCH.growPerKm },
    uGrowMax: { value: CLOUD_FAR_MARCH.growMax },
    uFarIt: { value: 0 },
    uMaxIt: { value: 1 },
    uSegN: { value: 1 },
    uKStep: { value: 1 },
    uTOff: { value: 1 },
    uDtMin: { value: 1 },
    uLSteps: { value: 1 },
    uMsOct: { value: 1 },
    uFiltPx: { value: 1 },
    uFiltStep: { value: new THREE.Vector4() },
    uRefDiv: { value: 2 },
    uShW: { value: 0 },
    uShadowStrength: { value: 0 },
  };
}

export interface GlobeCloudMarch {
  /** The bakes are in and the map is loaded. */
  readonly ready: boolean;
  /**
   * The tiles and the two numbers from the bake; RangeError for a tile of
   * the wrong size. Later calls are ignored.
   */
  setBakes(bakes: CloudBakes): void;
  /** Draws the clouds, and with `shadow` their shadow; false when not ready. */
  render(frame: CloudMarchFrame): boolean;
  /** The clouds: premultiplied radiance, opacity in alpha. */
  readonly texture: THREE.Texture;
  /** The ground shadow, in alpha. */
  readonly shadowTexture: THREE.Texture;
  /** The share of the textures the last frame drew. */
  readonly uv: THREE.Vector2;
  /** The size of the textures (pixels). */
  readonly resolution: THREE.Vector2;
  /** The last frame's pixels and march quality, its weather position. */
  state(): {
    drawn: number;
    width: number;
    height: number;
    canvasPixelsPerCloudPixel: number;
    q: readonly [number, number];
  };
  /** The shader's uniforms (tests and debug hooks). */
  uniforms(): MarchUniforms;
  /** Frees everything; the pass then draws nothing. Idempotent. */
  dispose(): void;
}

/** The near clouds for `renderer` (`GlobeCloudMarchOptions`). */
export function createGlobeCloudMarch(
  renderer: THREE.WebGLRenderer,
  {
    ellipsoid,
    surfaceUniforms,
    lifeSpeed = CLOUD_LIFE_SPEED,
  }: GlobeCloudMarchOptions,
): GlobeCloudMarch {
  const { x: ra, y: rb, z: rc } = ellipsoid.radius;
  const R = CLOUD_MARCH_RADIUS_KM;
  const toSphere = new THREE.Vector3(R / ra, R / rb, R / rc);
  const uniforms = marchUniforms(surfaceUniforms.uClouds);
  uniforms.uMapSkew.value.set(1, ra / rb, ra / rc);
  const raw = (fragmentShader: string) =>
    new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: CLOUD_MARCH_VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
  const material = raw(CLOUD_MARCH_FRAGMENT);
  const shadowMaterial = raw(CLOUD_MARCH_SHADOW_FRAGMENT);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = cloudTarget(THREE.HalfFloatType);
  const shadowTarget = cloudTarget(THREE.UnsignedByteType);
  let textures: ReturnType<typeof bakedTextures> | null = null;
  let weather: CloudWeatherFrame | null = null;
  let disposed = false;
  let compiled = false;
  let compiling: Promise<void> | null = null;
  let drawn = 0;
  let canvasPixelsPerCloudPixel = 1;
  let reachAtKm = -1;
  const size = new THREE.Vector2();
  const uv = new THREE.Vector2(1, 1);
  const resolution = new THREE.Vector2(1, 1);
  const ecefFromWorld = new THREE.Matrix4();
  const view = new THREE.Matrix3();
  const position = new THREE.Vector3();

  /** A direction in the drifted sphere's frame, from one in ECEF. */
  const drifted = (out: THREE.Vector3, cos: number, sin: number) => {
    const x = out.x * toSphere.x;
    const y = out.y * toSphere.y;
    return out.set(x * cos + y * sin, y * cos - x * sin, out.z * toSphere.z);
  };

  /** The camera's place in the weather, its axes and the sun in its frame. */
  const applyPlace = (frame: CloudMarchFrame) => {
    const { camera, worldFromEcef, sunEcef } = frame;
    ecefFromWorld.copy(worldFromEcef).invert();
    const offset = surfaceUniforms.uCloudLonOffset.value;
    const cos = Math.cos(offset);
    const sin = Math.sin(offset);
    position.setFromMatrixPosition(camera.matrixWorld);
    position.applyMatrix4(ecefFromWorld);
    drifted(position, cos, sin);
    const radius = position.length();
    const up = [
      position.x / radius,
      position.y / radius,
      position.z / radius,
    ] as const;
    weather =
      weather === null
        ? cloudWeatherFrameAt(up)
        : advanceCloudWeatherFrame(weather, up);
    const { x, z, q } = weather;
    uniforms.uH.value = Math.max(radius - R, 0.001);
    uniforms.uQ0.value.set(q[0], q[1]);
    uniforms.uEcef.value.set(
      x[0],
      up[0],
      z[0],
      x[1],
      up[1],
      z[1],
      x[2],
      up[2],
      z[2],
    );
    const inFrame = (out: THREE.Vector3) => {
      drifted(out, cos, sin).normalize();
      return out.set(
        out.x * x[0] + out.y * x[1] + out.z * x[2],
        out.x * up[0] + out.y * up[1] + out.z * up[2],
        out.x * z[0] + out.y * z[1] + out.z * z[2],
      );
    };
    view.setFromMatrix4(ecefFromWorld);
    const axis = (out: THREE.Vector3, i: number, sign: number) =>
      inFrame(
        out
          .setFromMatrixColumn(camera.matrixWorld, i)
          .multiplyScalar(sign)
          .applyMatrix3(view),
      );
    axis(uniforms.uRight.value, 0, 1);
    axis(uniforms.uUp.value, 1, 1);
    axis(uniforms.uFwd.value, 2, -1);
    inFrame(uniforms.uSun.value.copy(sunEcef));
    const projection = camera.projectionMatrix.elements;
    uniforms.uTan.value.set(1 / (projection[0] ?? 1), 1 / (projection[5] ?? 1));
  };

  /** The light of this sun, the haze's reach at this height, the clock. */
  const applyAir = (frame: CloudMarchFrame) => {
    const sun = uniforms.uSun.value;
    const light = cloudMarchLight([sun.x, sun.y, sun.z]);
    uniforms.uSunCol.value.fromArray(light.sunPath);
    uniforms.uCloudSun.value.fromArray(light.cloudSun);
    uniforms.uAmbTop.value.fromArray(light.ambientTop);
    uniforms.uAmbBot.value.fromArray(light.ambientBottom);
    const h = uniforms.uH.value;
    // The search is a few thousand samples: once per 1 % of height.
    if (Math.abs(h - reachAtKm) > Math.max(0.02, 0.01 * h)) {
      reachAtKm = h;
      uniforms.uTFade.value = cloudHazeReachKm(h, MID_KM, HAZE_FADE);
      uniforms.uTMax.value = cloudHazeReachKm(h, MID_KM, HAZE_END);
    }
    const clock = cloudLifeClock(frame.timeS, lifeSpeed);
    uniforms.uPhase.value = clock.phase;
    uniforms.uBillow.value.set(clock.billow[0], clock.billow[1]);
  };

  /** The frame's limits, the target fitted and its share set. */
  const applyScale = (frame: CloudMarchFrame) => {
    const { quality, pixelScale } = frame;
    renderer.getSize(size);
    const pixelRatio = renderer.getPixelRatio();
    const fit = cloudTargetSize(size.x, size.y, pixelRatio, quality);
    if (target.width !== fit.width || target.height !== fit.height) {
      target.setSize(fit.width, fit.height);
      shadowTarget.setSize(fit.width, fit.height);
      resolution.set(fit.width, fit.height);
    }
    const s = cloudViewSettings(quality, {
      cssWidth: size.x,
      cssHeight: size.y,
      pixelRatio,
      altitudeKm: uniforms.uH.value,
      pixelScale,
    });
    target.viewport.set(0, 0, s.width, s.height);
    target.scissor.set(0, 0, s.width, s.height);
    shadowTarget.viewport.copy(target.viewport);
    shadowTarget.scissor.copy(target.scissor);
    uv.set(s.uv[0], s.uv[1]);
    canvasPixelsPerCloudPixel = s.canvasPixelsPerCloudPixel;
    const m = s.march;
    uniforms.uMaxIt.value = m.maxSteps;
    uniforms.uFarIt.value = Math.min(
      CLOUD_FAR_MARCH.extraStepsMax,
      m.maxSteps * CLOUD_FAR_MARCH.extraShare,
    );
    uniforms.uSegN.value = m.segments;
    uniforms.uKStep.value = m.stepFactor;
    uniforms.uTOff.value = m.stepOffsetKm;
    uniforms.uDtMin.value = m.minStepKm;
    uniforms.uLSteps.value = m.lightSteps;
    uniforms.uMsOct.value = m.scatterOctaves;
    uniforms.uDetailW.value = m.detail;
    uniforms.uShW.value = m.shadowDetail;
    uniforms.uRefDiv.value = quality.entrySubSteps;
    uniforms.uFiltPx.value = s.filterPixels;
    uniforms.uFiltStep.value.fromArray(s.filterStep);
    uniforms.uPixAng.value =
      (2 * uniforms.uTan.value.y) / (size.y * pixelRatio);
  };

  const applySceneDepth = (depth: CloudMarchFrame["sceneDepth"]) => {
    uniforms.uSceneDepthOn.value = depth === null ? 0 : 1;
    if (depth === null) return;
    uniforms.uSceneDepth.value = depth.texture;
    uniforms.uSceneInverseProjection.value.copy(
      depth.camera.projectionMatrixInverse,
    );
  };

  /** Compiles both shaders off the frame that first draws them; a browser
   *  that fails the wait compiles on that frame instead. Until it is over
   *  the materials stay: three polls their programs by a timer, and one
   *  freed under it throws there. */
  const compile = () => {
    quad.material = shadowMaterial;
    const shadow = renderer.compileAsync(scene, quadCamera);
    quad.material = material;
    const clouds = renderer.compileAsync(scene, quadCamera);
    compiling = Promise.all([shadow, clouds])
      .catch(() => undefined)
      .then(() => {
        compiled = true;
        compiling = null;
      });
  };

  const ready = () =>
    !disposed &&
    compiled &&
    textures !== null &&
    surfaceUniforms.uClouds.value !== null;

  return {
    get ready() {
      return ready();
    },
    setBakes(bakes) {
      if (disposed || textures !== null) return;
      textures = bakedTextures(bakes);
      uniforms.uShape.value = textures.shape;
      uniforms.uDetail.value = textures.detail;
      uniforms.uDomes.value = textures.domes;
      uniforms.uRegion.value = textures.region;
      uniforms.uBlue.value = textures.blue;
      uniforms.uLifeGain.value = bakes.lifeGain;
      uniforms.uDnMean.value = bakes.detailMean;
      compile();
    },
    render(frame) {
      if (!ready()) return false;
      applyPlace(frame);
      applyAir(frame);
      applyScale(frame);
      applySceneDepth(frame.sceneDepth);
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      quad.material = material;
      renderer.render(scene, quadCamera);
      if (frame.shadow > 0) {
        uniforms.uShadowStrength.value = frame.shadow;
        renderer.setRenderTarget(shadowTarget);
        quad.material = shadowMaterial;
        renderer.render(scene, quadCamera);
      }
      renderer.setRenderTarget(previous);
      drawn += 1;
      return true;
    },
    texture: target.texture,
    shadowTexture: shadowTarget.texture,
    uv,
    resolution,
    state: () => ({
      drawn,
      width: target.viewport.width,
      height: target.viewport.height,
      canvasPixelsPerCloudPixel,
      q: weather?.q ?? [0, 0],
    }),
    uniforms: () => uniforms,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (textures !== null) {
        for (const texture of Object.values(textures)) texture.dispose();
      }
      target.dispose();
      shadowTarget.dispose();
      const freeMaterials = () => {
        material.dispose();
        shadowMaterial.dispose();
      };
      if (compiling === null) freeMaterials();
      else void compiling.then(freeMaterials);
      geometry.dispose();
    },
  };
}
