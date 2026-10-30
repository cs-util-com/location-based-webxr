/**
 * The air for an app's globe view (the full-globe editor plan
 * 2026-10-27-1850): the lab's three air drawers (the space pass over the
 * Earth, the framework's ground sky, the haze over the relief) made for a
 * `GlobeView` and wired through `globe-air.ts`, so an app gets the blue
 * sky below the hand-over edge with one call. The view core alone draws
 * only the sun's disc, the stars and navy space: black at noon.
 *
 * The app calls the four parts at the view's places, as the lab does:
 * `afterSky` in the view's `afterSky` seam (the ground sky over the space
 * sky, before the Earth), `step` once a frame after its camera is placed
 * (the hand-over and the globe's sun at the eased exposure), `afterScene`
 * in the view's `afterScene` seam (the space pass over the Earth and the
 * sky), and `haze(tiles)` once per relief it draws.
 *
 * The lab's defaults, but one: the space pass's veil over the ground
 * fades with its sky under the ground sky (the lab's `atmoGround=0`). The
 * lab ends that veil's rays at the drawn relief through a depth pass of
 * its own; without one they end at the ellipsoid, under the relief, and
 * over high ground the veil would be far too thick. Below the edge the
 * haze carries the ground.
 *
 * @see globe-view-air.ts.md
 */
import type * as THREE from "three";

import { EARTH_ATMOSPHERE } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-model";

import { createGlobeAir, type AirParams } from "./globe-air.js";
import {
  GLOBE_ATMOSPHERE,
  defaultAtmosphereSteps,
} from "./globe-atmosphere-frame.js";
import {
  createGlobeAtmosphere,
  type GlobeAtmosphere,
} from "./globe-atmosphere.js";
import {
  createGlobeGroundSky,
  type GlobeGroundSky,
} from "./globe-ground-sky.js";
import { createGlobeHaze, type GlobeHaze } from "./globe-haze.js";
import { GLOBE_SKY_HAND_OVER } from "./globe-sky-hand-over.js";

/** What the air reads of the view (a `GlobeView` is one). */
interface AirView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly globe: {
    readonly sun: { readonly position: THREE.Vector3; intensity: number };
    readonly group: { readonly matrixWorld: THREE.Matrix4 };
    readonly tiles: {
      readonly group: { readonly matrixWorld: THREE.Matrix4 };
      readonly ellipsoid: { readonly radius: THREE.Vector3 };
    };
    readonly surfaceUniforms: {
      readonly uSunEcef: { readonly value: THREE.Vector3 };
    };
  };
  ecefCamera(): { readonly position: THREE.Vector3 };
  frameTarget(): unknown;
}

/** The three drawers, as the air uses them (tests pass fakes). */
interface AirDrawers {
  readonly spacePass: Pick<GlobeAtmosphere, "setLook" | "render" | "dispose">;
  readonly groundSky: Pick<
    GlobeGroundSky,
    "atmosphere" | "update" | "state" | "render" | "dispose"
  >;
  readonly haze: Pick<GlobeHaze, "patch" | "sync" | "setWeight" | "dispose">;
}

/** The relief's tiles, as the haze patches them. */
type HazedTiles = Parameters<GlobeHaze["patch"]>[0];

export interface GlobeViewAir {
  /** The view's `afterSky` seam: the ground sky over the space sky. */
  afterSky(): void;
  /**
   * Once a frame, after the camera is placed: the hand-over at the
   * camera's height and the globe's sun at its eased exposure.
   */
  step(): void;
  /** The view's `afterScene` seam: the space pass over the Earth and sky. */
  afterScene(): void;
  /** Hazes every model `tiles` loads from now on (call before it loads). */
  haze(tiles: HazedTiles): void;
  /** The ground sky's share now, the observer's height (km), its stage. */
  state(): {
    weight: number;
    observerKm: number;
    groundSky: Record<string, unknown>;
  };
  /** Frees the three drawers; every part then does nothing. Idempotent. */
  dispose(): void;
}

interface GlobeViewAirOptions {
  /** A touch screen: the space pass marches fewer samples (the lab's). */
  readonly coarsePointer: boolean;
  /** Tests: the drawers (default: the real ones, made for the view). */
  readonly drawers?: (view: AirView) => AirDrawers;
}

/** The real drawers, made for the view's renderer and scene. */
function createDrawers(view: AirView): AirDrawers {
  const { x, y, z } = view.globe.tiles.ellipsoid.radius;
  const spacePass = createGlobeAtmosphere(view.renderer, [x, y, z]);
  const groundSky = createGlobeGroundSky(view.renderer);
  const haze = createGlobeHaze(view.scene, {
    visibilityKm:
      groundSky.atmosphere?.visibilityKm ?? GLOBE_ATMOSPHERE.visibilityKm,
  });
  return { spacePass, groundSky, haze };
}

/** The air for `view`; see the module's comment for where each part runs. */
export function mountGlobeViewAir(
  view: AirView,
  options: GlobeViewAirOptions,
): GlobeViewAir {
  const drawers = (options.drawers ?? createDrawers)(view);
  const { spacePass, groundSky, haze } = drawers;
  const { radius } = view.globe.tiles.ellipsoid;
  const params: AirParams = {
    groundSky: 1,
    sky: 1,
    skyEdgeKm: GLOBE_SKY_HAND_OVER.edgeKm,
    skyWidthKm: GLOBE_SKY_HAND_OVER.widthKm,
    skyStepPct: GLOBE_SKY_HAND_OVER.altitudeStepPct,
    // The space view's exposure: the globe's own sun, as the view made it.
    sunIntensity: view.globe.sun.intensity,
    hazeScale: 1,
    atmoRamp: 1,
    atmoThickness: GLOBE_ATMOSPHERE.thickness,
    atmoGround: 0,
    atmoSteps: defaultAtmosphereSteps(options.coarsePointer),
    atmoStrength: GLOBE_ATMOSPHERE.strength,
  };
  const air = createGlobeAir({
    ellipsoidRadii: [radius.x, radius.y, radius.z],
    groundRadiusKm: EARTH_ATMOSPHERE.groundRadiusKm,
    sun: view.globe.sun,
    globeGroup: view.globe.group,
    spacePass,
    groundSky,
    haze,
  });
  air.setLook(params);
  let stepped = false;
  let disposed = false;
  /** Drawn only between the first step and the dispose. */
  const live = () => stepped && !disposed;
  return {
    afterSky() {
      if (live()) groundSky.render(view.camera);
    },
    step() {
      if (disposed) return;
      const { position } = view.ecefCamera();
      air.step(params, {
        cameraEcef: [position.x, position.y, position.z],
        framed: view.frameTarget() !== null,
      });
      // No cloud volumes here: the sun's ease and the shell's thickness
      // follow the hand-over at once.
      air.finish(params);
      stepped = true;
    },
    afterScene() {
      if (!live()) return;
      air.render(view.camera, params, {
        drawn: true,
        worldFromEcef: view.globe.tiles.group.matrixWorld,
        sunEcef: view.globe.surfaceUniforms.uSunEcef.value,
        sceneDepth: null,
      });
    },
    haze(tiles) {
      if (!disposed) haze.patch(tiles);
    },
    state: () => ({
      weight: air.weight(),
      observerKm: air.observerKm(),
      groundSky: air.groundSkyState(),
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const drawer of [haze, groundSky, spacePass]) {
        try {
          drawer.dispose();
        } catch {
          // One drawer that fails to free leaves the others to run.
        }
      }
    },
  };
}
