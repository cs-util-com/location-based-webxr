/**
 * The cloud volume (volume-cloud plan 2026-10-05-0016, C2): the framework's
 * ray-marched cloud slab near the camera, its clouds from the globe's own
 * cloud map, drawn after the Earth so a ridge in front of a cloud hides it.
 * Moved out of the globe lab as a pure refactor; its arithmetic is
 * `globe-cloud-volume.ts`.
 *
 * - **The slab is the ground sky's** (`SkyAtmosphere` in slab mode, cover 1,
 *   the coverage chunk `CLOUD_VOLUME_COVERAGE_GLSL` reading the globe's map
 *   with its drift, a disc of `radiusKm` x the altitude share).
 * - **The relief's depth** comes from a depth-only pass of the relief's own
 *   meshes (`globe-scene-depth.ts`: their colour writes off; the
 *   displacement is in their vertex shader, so an override material would
 *   draw them flat) into a depth texture the slab reads
 *   (`setCloudSceneDepth`): the march ends at the ground. Drawn with the
 *   relief alone as the scene, the relief's program compiles once more
 *   without the page's fog, on the first volume frame.
 * - **The height**: the framework's slab sits at fixed heights (1.8-2.2 km);
 *   the volume draws it with a copy of the camera lowered by "the shell's
 *   height minus the slab's middle", which raises the slab to the shell's
 *   height without touching the framework. Noise, depth and distances are
 *   unchanged by a vertical shift. Its thickness is not scaled with E.
 * - **The composite**: the slab into its own half-float target (cleared to
 *   alpha 0), then over the frame after the Earth: straight colour, three's
 *   tone mapping and colour space, its alpha blended.
 *
 * Only in the target's local frame (F2a), below the ceiling, with the relief.
 *
 * @see globe-cloud-volume-pass.ts.md
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { CLOUD_LAYER } from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-layer";
import { CLOUD_NOISE_PERIOD_TILES } from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-hex";
import type { CloudNoiseMode } from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-live-noise";
import {
  CLOUD_SLAB,
  CLOUD_SLAB_REACH,
} from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-slab";
import { CloudShadow } from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-shadow";
import type { SkyAtmosphere } from "gps-plus-slam-app-framework/visualization/atmosphere/sky-atmosphere";

import {
  CLOUD_VOLUME_COVERAGE_GLSL,
  type CloudNoiseAnchorKm,
  cloudVolumeAnchorDrift,
  cloudVolumeAnchorRecentre,
  cloudVolumeDiscCentre,
  cloudVolumeNoiseAnchor,
  cloudVolumeNoiseOffset,
  cloudVolumeRecentreShift,
  cloudVolumeShare,
  unwrapDriftRad,
} from "./globe-cloud-volume.js";
import type { GlobeSceneDepth } from "./globe-scene-depth.js";
import type { GlobeSurfaceUniforms } from "./globe-surface-material.js";
import type { LatLng } from "./globe-target.js";

const COMPOSITE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tVolume;
varying vec2 vUv;
void main() {
  vec4 c = texture2D( tVolume, vUv );
  if ( c.a < 1e-4 ) discard;
  gl_FragColor = vec4( c.rgb / c.a, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.a = c.a;
}`;

/** The slab's middle (m): the height the lift moves to the shell's. */
const SLAB_MIDDLE_M = (CLOUD_SLAB.baseM + CLOUD_SLAB.topM) / 2;

/**
 * The slab's reach never ends before its default (m): a small disc keeps
 * the look-dev page's fade.
 */
const MIN_REACH_END_M = CLOUD_SLAB_REACH.farEndM;

/** A noise coordinate wrapped to the noise's period, [0, period) tiles. */
const wrapNoise = (t: number): number =>
  t - CLOUD_NOISE_PERIOD_TILES * Math.floor(t / CLOUD_NOISE_PERIOD_TILES);

const DEG = Math.PI / 180;

/** The live noise's anchor, and the frame target and drift it was carried to. */
interface LiveAnchor {
  anchor: CloudNoiseAnchorKm;
  at: LatLng;
  drift: number;
}

/**
 * The live noise's anchor carried to the frame `target` (degrees) and the
 * map's unwrapped `drift` (radians), from `previous` (null: the first,
 * from the place itself): each recentre and each drift step applied to the
 * one before (`cloudVolumeAnchorRecentre` and `cloudVolumeAnchorDrift`), so
 * the noise stays on the ground across recentres and through the drift's
 * wrap (round-3 plan N1, cold review item 4).
 */
function carryLive(
  previous: LiveAnchor | null,
  target: LatLng,
  drift: number,
): LiveAnchor {
  const at = { lat: target.lat, lng: target.lng };
  if (previous === null) {
    return {
      anchor: cloudVolumeNoiseAnchor({
        latRad: at.lat * DEG,
        lonRad: at.lng * DEG,
        lonOffsetRad: drift,
      }),
      at,
      drift,
    };
  }
  let anchor = previous.anchor;
  if (previous.at.lat !== at.lat || previous.at.lng !== at.lng) {
    anchor = cloudVolumeAnchorRecentre(
      WGS84_ELLIPSOID,
      anchor,
      previous.at,
      at,
    );
  }
  if (drift !== previous.drift) {
    anchor = cloudVolumeAnchorDrift(
      anchor,
      at.lat * DEG,
      drift - previous.drift,
    );
  }
  return { anchor, at, drift };
}

/** The globe surface's cloud uniforms the volume reads (shared, not copied). */
type CloudSurfaceUniforms = Pick<
  GlobeSurfaceUniforms,
  "uClouds" | "uCloudCubic" | "uCloudLonOffset" | "uCloudOpacity"
>;

interface GlobeCloudVolumeOptions {
  /** The ground sky's framework sky, whose slab is drawn. */
  atmosphere: SkyAtmosphere;
  /** The ground sky's scene, which holds the slab. */
  skyScene: THREE.Scene;
  /** The globe surface's uniforms: the map, its drift and opacity. */
  surfaceUniforms: CloudSurfaceUniforms;
  /** The relief's depth, shared with the space pass. */
  sceneDepth: GlobeSceneDepth;
}

/** What `update` is told each frame. */
interface CloudVolumeFrame {
  /** The camera's height (km). */
  altitudeKm: number;
  /** The frame's target (degrees); null before one: nothing is drawn. */
  target: LatLng | null;
  /** The disc's radius at a share of 1 (km). */
  radiusKm: number;
  ceilingKm: number;
  /** The fade below the ceiling (km, default 10; capped at the ceiling). */
  fadeKm?: number;
  /** The volume's cover gain (default 1). */
  cover?: number;
  /** The cloud shell's height (m): the deck the slab is lifted to. */
  shellHeightM: number;
  /** The camera's world position and view direction, or null. */
  view?: {
    position: readonly [number, number, number];
    direction: readonly [number, number, number];
  } | null;
  /** How far ahead the disc's centre may move (m; 0 keeps it on the camera). */
  maxAheadM?: number;
  /** Whether the spherical volume mixes the slab by its share. */
  mixed?: boolean;
}

/** A frame with its defaults filled in. */
type FullFrame = Required<CloudVolumeFrame>;

/**
 * `frame` with the lab's defaults where a field is undefined (fade 10 km,
 * cover 1, no view, no reach ahead, not mixed).
 */
function withDefaults(frame: CloudVolumeFrame): FullFrame {
  return {
    ...frame,
    fadeKm: frame.fadeKm === undefined ? 10 : frame.fadeKm,
    cover: frame.cover === undefined ? 1 : frame.cover,
    view: frame.view === undefined ? null : frame.view,
    maxAheadM: frame.maxAheadM === undefined ? 0 : frame.maxAheadM,
    mixed: frame.mixed === undefined ? false : frame.mixed,
  };
}

export interface GlobeCloudVolumeState {
  enabled: boolean;
  share: number;
  radiusM: number;
  aheadM: number;
  discCentre: { x: number; z: number } | null;
  deckY: number;
  liftM: number;
  drawn: number;
  shadow: boolean;
  hex: boolean;
  noise: CloudNoiseMode;
  fineGain: number;
}

/** A tile set whose loaded models the shadow patches (3d-tiles-renderer's). */
interface ShadowTiles {
  addEventListener(
    type: "load-model",
    listener: (event: { scene: THREE.Object3D }) => void,
  ): void;
}

export interface GlobeCloudVolume {
  /** Turns the slab on (or off) in the ground sky; idempotent. */
  setEnabled(on: boolean): void;
  /**
   * This frame's share and disc (`CloudVolumeFrame`). `mixed`: the
   * spherical volume mixes the slab by its share (round-4 plan R4d), so the
   * slab's cover and disc are drawn whole wherever its share is above 0.
   * Returns `{ share, radiusM }` (0 when not drawn).
   */
  update(frame: CloudVolumeFrame): { share: number; radiusM: number };
  /**
   * Draws the volume over the frame, after the Earth: the relief's depth
   * and `extra`'s (the city; drawn here unless already drawn this frame),
   * the slab with the lifted camera, the composite (unless `composite` is
   * false: the caller mixes `texture` itself). Nothing at share 0; returns
   * whether the slab was drawn.
   */
  render(
    camera: THREE.PerspectiveCamera,
    relief: THREE.Object3D,
    extra?: readonly THREE.Object3D[],
    options?: { composite?: boolean },
  ): boolean;
  /**
   * The slab's last frame, premultiplied (for a caller's own composite:
   * `render(..., { composite: false })`, the spherical volume's mix).
   */
  readonly texture: THREE.Texture;
  /**
   * Patches every lit mesh `tiles` loads from now on with the volume's
   * shadow (call before the haze's patch: the haze is applied last).
   */
  patchShadow(tiles: ShadowTiles): void;
  /** The volume's shadow on (C3, `cloudShadowFrom=1`) or off. */
  setShadow(on: boolean): void;
  /**
   * Which noise the clouds read (round-3 plan 2026-10-08-2345, N1, the
   * lab's `cloudNoise`): `tile`, `hex` (hex-tiling plan H2: no repeat at
   * 24 km) or `live` (no repeat in view). The ground sky's switch and
   * threshold, and the shadow's copies; idempotent.
   */
  setNoise(mode: CloudNoiseMode): void;
  /**
   * The live noise's fine gain (round-3 plan §19 item 2, the lab's
   * `cloudFineGain`); idempotent. The shadow shares the amplitudes.
   */
  setFineGain(fineGain: number): void;
  /** `setNoise` as the older switch: hex on, or the tile. */
  setHex(on: boolean): void;
  /**
   * The last volume frame read back (debug, slow): the share of its pixels
   * the clouds cover (alpha over 0.05), over the whole frame and over its
   * lower half (the view down, where the deck is nearest), and the largest
   * alpha. Null before a frame was drawn.
   */
  coverage(): { share: number; lowerShare: number; maxAlpha: number } | null;
  /**
   * The last volume frame read back by horizontal bands (debug, slow;
   * round-3 plan §19 item 1): `bands` bands from the bottom of the frame
   * up, each its mean alpha and the share of its pixels over 0.5. Null
   * before a frame was drawn.
   */
  rows(bands: number): { meanAlpha: number; over: number }[] | null;
  /**
   * The last frame's alpha at an `nx` x `ny` grid of pixel centres,
   * bottom row first (debug, slow; round-4 plan R4d: the spherical
   * volume's seam). Null before a frame was drawn.
   */
  alphaGrid(nx: number, ny: number): number[] | null;
  state(): GlobeCloudVolumeState;
  dispose(): void;
}

/**
 * The volume for `renderer`, drawing the ground sky's `atmosphere` slab
 * found in `skyScene`, its coverage from the globe's `surfaceUniforms`,
 * ending at `sceneDepth`.
 */
export function createGlobeCloudVolume(
  renderer: THREE.WebGLRenderer,
  {
    atmosphere,
    skyScene,
    surfaceUniforms,
    sceneDepth,
  }: GlobeCloudVolumeOptions,
): GlobeCloudVolume {
  const origin = { value: new THREE.Vector2() };
  /**
   * The frame target the noise was last anchored at, and the shift carried
   * across every recentre since, so a ground point keeps its noise when the
   * frame moves (the owner's "clouds jump when I zoom out and back in").
   */
  let anchor: { lat: number; lng: number; shift: [number, number] } | null =
    null;
  /**
   * The map's drift read unwrapped (the surface wraps it at 2 pi every 16
   * minutes; the noise jumped there by tiles), float64 on the CPU.
   */
  let drift: number | null = null;
  /**
   * The live noise's anchor (round-3 plan N1): where the frame's origin lies
   * on the noise plane (km, float64, unwrapped) and the frame's rotation,
   * carried across every recentre and moved by the drift; with the frame
   * target and the drift it was last carried to. Kept in every noise mode,
   * so a switch to live mid-flight starts where the ground is.
   */
  let live: LiveAnchor | null = null;
  const shareUniform = { value: 0 };
  const gainUniform = { value: 1 };
  const volumeTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  const material = new THREE.ShaderMaterial({
    uniforms: { tVolume: { value: volumeTarget.texture } },
    vertexShader: COMPOSITE_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const triangle = new THREE.Mesh(geometry, material);
  triangle.frustumCulled = false;
  const compositeScene = new THREE.Scene();
  compositeScene.add(triangle);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const lifted = new THREE.PerspectiveCamera();
  const size = new THREE.Vector2();
  const clearColour = new THREE.Color();
  // The volume's shadow on the relief (C3): the framework's cloud shadow
  // with the same coverage chunk and uniforms, the disc and the lift, so it
  // falls from exactly the clouds the volume draws. Off until asked for.
  const coverage = {
    glsl: CLOUD_VOLUME_COVERAGE_GLSL,
    uniforms: {
      uVolumeClouds: surfaceUniforms.uClouds,
      uCloudCubic: surfaceUniforms.uCloudCubic,
      uVolumeLonOffset: surfaceUniforms.uCloudLonOffset,
      uVolumeOpacity: surfaceUniforms.uCloudOpacity,
      uVolumeOrigin: origin,
      uVolumeShare: shareUniform,
      uVolumeGain: gainUniform,
    },
  };
  const shadow = new CloudShadow();
  shadow.configureMap({ coverage, disc: true });
  shadow.sync(atmosphere);
  shadow.setEnabled(false);
  let shadowOn = false;
  let noise: CloudNoiseMode = "tile";
  let enabled = false;
  let share = 0;
  let radiusM = 0;
  let liftM = 0;
  let drawn = 0;
  /** The reach's end last handed to the slab (m), or null (the default). */
  let lastReachEndM: number | null = null;
  /** How far ahead of the camera the disc's centre is (m), this frame. */
  let aheadM = 0;
  /**
   * The disc's centre this frame, world x and z (m), or null where it is
   * the camera's own ground point, and the deck's height (m): the spherical
   * volume weighs each pixel by the disc (R4d review, finding 1).
   */
  let discWorld: { x: number; z: number } | null = null;
  let deckWorldY = 0;

  const slab = () => skyScene.getObjectByName("atmosphere-cloud-slab");
  const fit = (target: THREE.WebGLRenderTarget) => {
    if (target.width !== size.x || target.height !== size.y) {
      target.setSize(size.x, size.y);
    }
  };
  /** The last volume frame's half-float pixels, read back (slow). */
  const readBack = () => {
    const w = volumeTarget.width;
    const h = volumeTarget.height;
    const pixels = new Uint16Array(w * h * 4);
    renderer.readRenderTargetPixels(volumeTarget, 0, 0, w, h, pixels);
    return { w, h, pixels };
  };
  /**
   * The frame target's origin and, while on, the noise anchored to the
   * ground: the noise belongs to the ground and drifts with the map;
   * without it every place put the same (clear) patch under its target.
   */
  const anchorNoise = (target: LatLng) => {
    origin.value.set(
      (target.lat * Math.PI) / 180,
      (target.lng * Math.PI) / 180,
    );
    if (!enabled) return;
    const tileM = CLOUD_LAYER.tileKm * 1000;
    const period = CLOUD_NOISE_PERIOD_TILES;
    const wrappedDrift = surfaceUniforms.uCloudLonOffset.value;
    const lonOffsetRad =
      drift === null ? wrappedDrift : unwrapDriftRad(drift, wrappedDrift);
    drift = lonOffsetRad;
    if (anchor === null) {
      anchor = { lat: target.lat, lng: target.lng, shift: [0, 0] };
    } else if (anchor.lat !== target.lat || anchor.lng !== target.lng) {
      const [du, dv] = cloudVolumeRecentreShift(
        WGS84_ELLIPSOID,
        anchor,
        target,
        lonOffsetRad,
        tileM,
        period,
      );
      anchor = {
        lat: target.lat,
        lng: target.lng,
        shift: [
          wrapNoise(anchor.shift[0] + du),
          wrapNoise(anchor.shift[1] + dv),
        ],
      };
    }
    const [u, v] = cloudVolumeNoiseOffset(
      { latRad: origin.value.x, lonRad: origin.value.y, lonOffsetRad },
      tileM,
      period,
    );
    atmosphere.cloudUniforms.atmCloudOffset.value.set(
      wrapNoise(u + anchor.shift[0]),
      wrapNoise(v + anchor.shift[1]),
    );
    live = carryLive(live, target, lonOffsetRad);
    atmosphere.setCloudNoiseAnchor(live.anchor);
  };
  /**
   * The disc's centre (volume-cloud plan §15): where the view meets the
   * deck (the shell's height), at most `maxAheadM` ahead; null (the
   * camera) without a view or with no reach ahead. Sets `aheadM`.
   */
  const placeDisc = ({ view, shellHeightM, maxAheadM }: FullFrame) => {
    const centre =
      view === null
        ? null
        : cloudVolumeDiscCentre({
            camera: view.position,
            direction: view.direction,
            deckY: shellHeightM,
            maxAheadM,
          });
    aheadM = centre?.aheadM ?? 0;
    return centre === null || maxAheadM === 0
      ? null
      : { x: centre.x, z: centre.z };
  };
  /** This frame's disc, aerial fade and reach, handed to the slab (on only). */
  const handOver = (
    discCentre: { x: number; z: number } | null,
    mixed: boolean,
  ) => {
    atmosphere.setCloudDiscRadius(radiusM > 0 ? radiusM : null);
    atmosphere.setCloudDiscCentre(discCentre);
    // Mixed with the spherical volume, the aerial fade comes in with the
    // slab's share, as the volume's does (round-5 plan C3); alone, all of
    // it, as before.
    atmosphere.setCloudAerial(mixed && share > 0 ? share ** 3 : null);
    // The slab's reach follows the disc (volume-cloud plan §13, R2; §15:
    // out to the disc's far side): its default ends 21 km from the camera,
    // which left the horizon the owner looked at without volume clouds
    // (2026-10-06). Moved in 1 km steps, not every frame.
    const reachEndM =
      Math.ceil(Math.max(aheadM + radiusM, MIN_REACH_END_M) / 1000) * 1000;
    if (reachEndM !== lastReachEndM) {
      lastReachEndM = reachEndM;
      atmosphere.setCloudReach({
        farStartM: (2 / 3) * reachEndM,
        farEndM: reachEndM,
      });
    }
  };
  /**
   * The slab alone, from the scene depth's camera lifted to the shell,
   * into the volume target cleared to transparent black; the clear colour
   * and the sky's other children given back. Leaves the target bound.
   */
  const drawSlab = (mesh: THREE.Object3D) => {
    lifted.copy(sceneDepth.camera);
    lifted.position.y -= liftM;
    lifted.updateMatrixWorld();
    const hidden: THREE.Object3D[] = [];
    for (const child of skyScene.children) {
      if (child !== mesh && child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    }
    renderer.getClearColor(clearColour);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(volumeTarget);
    renderer.clear(true, false, false);
    renderer.render(skyScene, lifted);
    renderer.setClearColor(clearColour, clearAlpha);
    for (const child of hidden) child.visible = true;
  };
  const setNoise = (mode: CloudNoiseMode) => {
    if (mode === noise) return;
    atmosphere.configure({ cloudNoise: mode });
    noise = mode;
    shadow.sync(atmosphere);
  };

  return {
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (on) {
        atmosphere.configure({ cloudMode: "slab", cloudCover: 1 });
        atmosphere.setCloudCoverage(coverage);
        atmosphere.setCloudSceneDepth(sceneDepth.texture);
      } else {
        atmosphere.setCloudCoverage(null);
        atmosphere.setCloudSceneDepth(null);
        atmosphere.setCloudDiscRadius(null);
        atmosphere.setCloudReach(null);
        atmosphere.setCloudAerial(null);
        atmosphere.setCloudDiscCentre(null);
        lastReachEndM = null;
        atmosphere.configure({ cloudMode: "dome", cloudCover: 0 });
      }
    },
    update(input) {
      const frame = withDefaults(input);
      const { target, shellHeightM, mixed } = frame;
      gainUniform.value = frame.cover;
      share =
        enabled && target !== null
          ? cloudVolumeShare(frame.altitudeKm, {
              ceilingKm: frame.ceilingKm,
              fadeKm: Math.min(frame.fadeKm, frame.ceilingKm),
            })
          : 0;
      // Mixed with the spherical volume (round-4 plan R4d): the slab is
      // drawn whole wherever it is drawn at all, and its share weights the
      // mix (the lab's `globe-cloud-shell-volume.js`); its fade by cover and
      // disc would weaken it twice.
      const drawShare = mixed && share > 0 ? 1 : share;
      radiusM = frame.radiusKm * 1000 * drawShare;
      liftM = shellHeightM - SLAB_MIDDLE_M;
      shareUniform.value = drawShare;
      if (target !== null) anchorNoise(target);
      const discCentre = placeDisc(frame);
      discWorld = discCentre;
      deckWorldY = shellHeightM;
      if (enabled) handOver(discCentre, mixed);
      shadow.setLiftM(liftM);
      if (radiusM > 0) shadow.setDiscRadiusM(radiusM);
      shadow.setDiscCentre(discCentre);
      shadow.setEnabled(shadowOn && enabled && radiusM > 0);
      return { share, radiusM };
    },
    render(camera, relief, extra, options) {
      const mesh = slab();
      if (!enabled || share <= 0 || mesh === undefined) return false;
      renderer.getDrawingBufferSize(size);
      fit(volumeTarget);
      const previous = renderer.getRenderTarget();
      // The depth's own near plane (at most 10 m): the camera's is fitted to
      // the ground, and the deck can be far nearer than the ground (3 km
      // under a 2.8 km near plane at the 12 km hold), so with it every view
      // down clipped the deck away. The slab reads the depth back through
      // its own inverse projection, so it draws from that camera too.
      if (!sceneDepth.fresh) sceneDepth.render(camera, relief, extra ?? []);
      drawSlab(mesh);
      renderer.setRenderTarget(previous);
      if (options?.composite !== false) {
        renderer.render(compositeScene, quadCamera);
      }
      drawn += 1;
      return true;
    },
    get texture() {
      return volumeTarget.texture;
    },
    patchShadow(tiles) {
      tiles.addEventListener("load-model", ({ scene: model }) => {
        shadow.applyToObject(model);
      });
    },
    setShadow(on) {
      shadowOn = Boolean(on);
    },
    setNoise,
    setFineGain(fineGain) {
      if (fineGain === atmosphere.cloudNoiseFineGain) return;
      atmosphere.configure({ cloudNoiseFineGain: fineGain });
    },
    setHex(on) {
      setNoise(on ? "hex" : "tile");
    },
    coverage() {
      if (drawn === 0) return null;
      const { w, h, pixels } = readBack();
      let covered = 0;
      let lower = 0;
      let maxAlpha = 0;
      // Read back bottom row first: the lower half is the first h/2 rows.
      const lowerEnd = Math.floor(h / 2) * w * 4;
      for (let i = 3; i < pixels.length; i += 4) {
        const a = THREE.DataUtils.fromHalfFloat(pixels[i] ?? 0);
        if (a > 0.05) {
          covered += 1;
          if (i < lowerEnd) lower += 1;
        }
        if (a > maxAlpha) maxAlpha = a;
      }
      return {
        share: covered / (w * h),
        lowerShare: lower / (Math.floor(h / 2) * w),
        maxAlpha,
      };
    },
    rows(bands) {
      if (drawn === 0) return null;
      const { w, h, pixels } = readBack();
      const out = [];
      for (let b = 0; b < bands; b++) {
        const y0 = Math.floor((b * h) / bands);
        const y1 = Math.floor(((b + 1) * h) / bands);
        let sum = 0;
        let over = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = 0; x < w; x++) {
            const a = THREE.DataUtils.fromHalfFloat(
              pixels[(y * w + x) * 4 + 3] ?? 0,
            );
            sum += a;
            if (a > 0.5) over += 1;
          }
        }
        const n = (y1 - y0) * w;
        out.push({ meanAlpha: sum / n, over: over / n });
      }
      return out;
    },
    alphaGrid(nx, ny) {
      if (drawn === 0) return null;
      const { w, h, pixels } = readBack();
      const out = new Array<number>(nx * ny);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x = Math.min(w - 1, Math.floor(((i + 0.5) * w) / nx));
          const y = Math.min(h - 1, Math.floor(((j + 0.5) * h) / ny));
          out[j * nx + i] = THREE.DataUtils.fromHalfFloat(
            pixels[(y * w + x) * 4 + 3] ?? 0,
          );
        }
      }
      return out;
    },
    state() {
      return {
        enabled,
        share,
        radiusM,
        aheadM,
        discCentre: discWorld,
        deckY: deckWorldY,
        liftM,
        drawn,
        shadow: shadowOn && enabled && radiusM > 0,
        hex: noise === "hex",
        noise,
        fineGain: atmosphere.cloudNoiseFineGain,
      };
    },
    dispose() {
      volumeTarget.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
