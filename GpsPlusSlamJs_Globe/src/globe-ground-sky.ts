/**
 * The globe's ground sky (globe F2 plan 2026-10-03-1922, F2b, M1): the
 * framework's physical sky, seen from the camera's height, taking over the
 * sky's pixels below the hand-over edge. Moved out of the globe lab as a
 * pure refactor.
 *
 * - The sky is a staged `SkyAtmosphere` in its OWN scene (DEC-GL5-16: its
 *   environment never reaches the globe's tiles), rebuilt one stage a frame
 *   (`stepRebuild`), its observer quantised in log steps and its sun in
 *   0.25 degree steps (`globe-sky-hand-over.ts`), so a descent costs about
 *   one rebuild per step and no frame carries a whole rebuild.
 * - It is drawn into its own half-float target and composited over the
 *   space sky with the cross-fade's weight, before the Earth: the Earth
 *   covers the ground's pixels, so the ground sky replaces only the sky's.
 *   The composite does the tone mapping and the output colour space (three
 *   applies neither when drawing into a target), so the result is the sky
 *   drawn straight to the canvas, faded. The space sky's stars and its sun
 *   disc fade under it as the ground sky's own disc fades in: the two discs
 *   are never both at full.
 * - The exposure: ONE eased value, the sun's scale in the scene, from the
 *   space view's (the lab's fixed sun intensity, 5) to the ground sky's
 *   automatic one, by the weight (`easedExposure`). It is the globe's sun
 *   intensity, and the ground sky's own scale (its sun intensity is the
 *   framework's 1, so its scale is its exposure, set through the
 *   compensation). The framework's automatic exposure is calibrated as pi
 *   at its reference light for a sun intensity of 1 (OsmDemo's
 *   convention), so the two ends are the same quantity: 5 and about 4.2 at
 *   60 km over the Alps at noon. The first build gave the sky the lab's 5
 *   AND multiplied the globe's 5 by the automatic 4.2, counting the scale
 *   twice: the frame brightened by 2 EV across the cross-fade (2026-10-05).
 * - It starts working a width ABOVE the edge, so its tables are built
 *   before its weight leaves 0.
 *
 * Only in the target's local frame (x east, y up, F2a): before a target the
 * world is ECEF and "up" means nothing to a flat sky, so the weight is 0.
 *
 * @see globe-ground-sky.ts.md
 */
import * as THREE from "three";

import {
  SkyAtmosphere,
  SkyAtmosphereUnsupportedError,
} from "gps-plus-slam-app-framework/visualization/atmosphere/sky-atmosphere";

import {
  GLOBE_SKY_HAND_OVER,
  easedExposure,
  groundSkyWeight,
  quantisedObserverKm,
  sunStepped,
} from "./globe-sky-hand-over.js";

const COMPOSITE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tSky;
uniform float uWeight;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4( texture2D( tSky, vUv ).rgb, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.a = uWeight;
}`;

/** The stages of the framework sky's staged rebuild the state counts. */
type CountedStage = "luts" | "waiting" | "read" | "bake";

/** What `update` is told each frame (`globe-air.ts` builds it). */
interface GroundSkyFrame {
  /** The observer's height over the ellipsoid's image (km). */
  altitudeKm: number;
  /** The sun's unit direction in the world. */
  sunWorld: THREE.Vector3;
  /** Whether the world is the target's local frame. */
  framed: boolean;
  /** The hand-over's edge and width (km) and observer step (percent). */
  edgeKm: number;
  widthKm: number;
  stepPct: number;
  /** The space view's sun intensity, the exposure above the edge. */
  spaceExposure: number;
}

/** What the debug panel and the smokes read. */
interface GroundSkyState {
  supported: boolean;
  weight: number;
  exposure: number;
  automaticExposure: number;
  observerKm: number | null;
  rebuildPending: boolean;
  lastStage: string;
  rebuilds: Record<CountedStage, number>;
}

export interface GlobeGroundSky {
  /** False where the framework sky cannot run (no float targets). */
  readonly supported: boolean;
  /** The framework sky (null where unsupported), for the state and tests. */
  readonly atmosphere: SkyAtmosphere | null;
  /** The framework sky's scene (the cloud volume draws its slab from it). */
  readonly scene: THREE.Scene;
  /**
   * Advances the sky for this frame and returns `{ weight, exposure }`:
   * the ground sky's share of the sky and the eased scale of the sun in
   * the scene, the globe's sun intensity (`spaceExposure`, the space
   * view's, above the edge).
   */
  update(frame: GroundSkyFrame): { weight: number; exposure: number };
  /**
   * Draws the ground sky over the current frame with its weight (nothing
   * at 0). Call after the space sky, before the Earth.
   */
  render(camera: THREE.Camera): void;
  state(): GroundSkyState;
  dispose(): void;
}

/** The framework sky in its own scene, or null where it cannot run. */
function createSky(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): SkyAtmosphere | null {
  try {
    return new SkyAtmosphere({
      scene,
      renderer,
      rebuild: "staged",
      observerAltitudeKm: GLOBE_SKY_HAND_OVER.observerCeilingKm,
    });
  } catch (e) {
    if (!(e instanceof SkyAtmosphereUnsupportedError)) throw e;
    return null;
  }
}

/**
 * The ground sky for `renderer`, in the framework's units (a sun intensity
 * of 1, so its scene scale is its exposure). `supported` is false where the
 * framework sky cannot run (no float targets): the lab keeps the space sky
 * all the way down. Any other error of the framework sky is thrown.
 */
export function createGlobeGroundSky(
  renderer: THREE.WebGLRenderer,
): GlobeGroundSky {
  const scene = new THREE.Scene();
  const atmosphere = createSky(scene, renderer);
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  const uniforms = {
    tSky: { value: target.texture },
    uWeight: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
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
  const size = new THREE.Vector2();
  let lastSun: [number, number, number] | null = null;
  let compensationEv = 0;
  let weight = 0;
  let exposure = Number.NaN;
  let automatic = 1;
  let lastStage: string = "idle";
  const rebuilds: Record<CountedStage, number> = {
    luts: 0,
    waiting: 0,
    read: 0,
    bake: 0,
  };
  /** Moves the sky's observer and sun by their steps, one rebuild stage. */
  const advance = (
    sky: SkyAtmosphere,
    altitudeKm: number,
    stepPct: number,
    sunWorld: THREE.Vector3,
  ) => {
    const km = quantisedObserverKm(Math.max(0, altitudeKm), stepPct);
    if (km !== sky.observerAltitudeKm) {
      sky.setObserverAltitudeKm(km);
    }
    const sun: [number, number, number] = [sunWorld.x, sunWorld.y, sunWorld.z];
    if (sunStepped(lastSun, sun)) {
      sky.setSun(sunWorld);
      lastSun = sun;
    }
    const stage = sky.stepRebuild();
    lastStage = stage;
    if (stage !== "idle") rebuilds[stage] += 1;
  };
  return {
    get supported() {
      return atmosphere !== null;
    },
    get atmosphere() {
      return atmosphere;
    },
    get scene() {
      return scene;
    },
    update({
      altitudeKm,
      sunWorld,
      framed,
      edgeKm,
      widthKm,
      stepPct,
      spaceExposure,
    }) {
      const working =
        atmosphere !== null && framed && altitudeKm < edgeKm + widthKm;
      weight = working ? groundSkyWeight(altitudeKm, { edgeKm, widthKm }) : 0;
      if (working) advance(atmosphere, altitudeKm, stepPct, sunWorld);
      // The automatic exposure alone (without this page's compensation),
      // then ONE eased value for the sky and the globe's sun.
      automatic = atmosphere ? atmosphere.exposure / 2 ** compensationEv : 1;
      exposure =
        weight > 0
          ? easedExposure(spaceExposure, automatic, weight)
          : spaceExposure;
      if (atmosphere) {
        const ev = Math.log2(exposure / automatic);
        if (ev !== compensationEv) {
          compensationEv = ev;
          atmosphere.setExposureCompensation(ev);
        }
      }
      return { weight, exposure };
    },
    render(camera) {
      if (atmosphere === null || weight <= 0) return;
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) {
        target.setSize(size.x, size.y);
      }
      const previous = renderer.getRenderTarget();
      // The cloud volume's slab, when there is one, draws after the Earth
      // (globe-cloud-volume-pass.ts), never with the sky behind it.
      const slab = scene.getObjectByName("atmosphere-cloud-slab");
      const slabShown = slab?.visible ?? false;
      if (slab) slab.visible = false;
      renderer.setRenderTarget(target);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      if (slab) slab.visible = slabShown;
      uniforms.uWeight.value = weight;
      renderer.render(compositeScene, quadCamera);
    },
    state() {
      return {
        supported: atmosphere !== null,
        weight,
        exposure,
        automaticExposure: automatic,
        observerKm: atmosphere?.observerAltitudeKm ?? null,
        rebuildPending: atmosphere?.rebuildPending ?? false,
        lastStage,
        rebuilds: { ...rebuilds },
      };
    },
    dispose() {
      atmosphere?.dispose();
      target.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
