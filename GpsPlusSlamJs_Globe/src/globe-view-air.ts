/**
 * The air for an app's globe view (the full-globe editor plan
 * 2026-10-27-1850): the lab's three air drawers (the space pass over the
 * Earth, the framework's ground sky, the haze over the relief) made for a
 * `GlobeView` and wired through `globe-air.ts`, so an app gets the blue
 * sky below the hand-over edge with one call. The view core alone draws
 * only the sun's disc, the stars and navy space: black at noon. With
 * `clouds` (`globeViewClouds(view)`, `globe-view-clouds.ts`) it draws the
 * lab's heavy clouds too, stepped between the hand-over and the sun's
 * eased exposure and drawn before the space pass, as the lab does.
 *
 * The app calls the four parts at the view's places, as the lab does:
 * `afterSky` in the view's `afterSky` seam (the ground sky over the space
 * sky, before the Earth), `step` once a frame after its camera is placed
 * (the hand-over and the globe's sun at the eased exposure), `afterScene`
 * in the view's `afterScene` seam (the space pass over the Earth and the
 * sky), and `haze(tiles)` once per relief it draws.
 *
 * The lab's defaults, but one: the space pass's veil over the ground
 * stays below the edge (the lab's `atmoGround=1`) only with the near
 * clouds, whose depth ends its rays at the relief. Without a depth they
 * end at the ellipsoid, under the relief, and over high ground the veil
 * would be far too thick; so a page without clouds, and the old clouds,
 * fade it with the sky (`atmoGround=0`) and the haze carries the ground.
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
import type { GlobeSea } from "./globe-sea.js";
import { GLOBE_SKY_HAND_OVER } from "./globe-sky-hand-over.js";
import {
  GLOBE_VIEW_CLOUDS,
  type CloudsFactory,
  type GlobeViewClouds,
} from "./globe-view-clouds.js";

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
    /** The cloud shell, its height set here when no heavy clouds do. */
    readonly cloudShell: { setHeightM(heightM: number): void };
  };
  /** The sea, given the ground sky's tables to reflect. */
  readonly sea?: Pick<GlobeSea, "setSky"> | null;
  ecefCamera(): { readonly position: THREE.Vector3 };
  frameTarget(): unknown;
}

/** The three drawers, as the air uses them (tests pass fakes). */
interface AirDrawers {
  readonly spacePass: Pick<
    GlobeAtmosphere,
    "setLook" | "render" | "dispose" | "transmittance"
  >;
  readonly groundSky: Pick<
    GlobeGroundSky,
    | "atmosphere"
    | "update"
    | "state"
    | "render"
    | "dispose"
    | "supported"
    | "scene"
  >;
  readonly haze: Pick<GlobeHaze, "patch" | "sync" | "setWeight" | "dispose">;
}

/** The relief's tiles, as the haze (and the clouds' shadow) patch them. */
type HazedTiles = Parameters<GlobeHaze["patch"]>[0] &
  Parameters<GlobeViewClouds["patch"]>[0];

/** What a frame's `step` is told. */
interface AirStepFrame {
  /**
   * Gives the globe's cloud shell its share for the flat layer's `flat`
   * (1 without the clouds) and returns it: the page's relief mount's
   * `shareClouds(true, flat)`. Absent: the shell gets none.
   */
  readonly shareClouds?: (flat: number) => number;
}

export interface GlobeViewAir {
  /** The view's `afterSky` seam: the ground sky over the space sky. */
  afterSky(): void;
  /**
   * Once a frame, after the camera is placed: the hand-over at the
   * camera's height, the clouds (with the cloud shell's share from
   * `frame.shareClouds`) and the globe's sun at its eased exposure.
   */
  step(frame?: AirStepFrame): void;
  /**
   * The view's `afterScene` seam: the clouds, then the space pass over the
   * Earth and sky.
   */
  afterScene(): void;
  /**
   * Hazes every model `tiles` loads from now on (call before it loads);
   * with the clouds, their shadow first, and the relief they end at.
   */
  haze(tiles: HazedTiles): void;
  /** The heavy clouds on or off (nothing without the clouds). */
  setClouds(on: boolean): void;
  /** The heavy clouds' shell (`GlobeViewClouds.shell`); null without the
   *  clouds. */
  cloudShell(): ReturnType<GlobeViewClouds["shell"]> | null;
  /** The ground sky's share now, the observer's height (km), its stage,
   *  and the clouds' state (null without them). */
  state(): {
    weight: number;
    observerKm: number;
    groundSky: Record<string, unknown>;
    clouds: ReturnType<GlobeViewClouds["state"]> | null;
  };
  /** Frees the drawers (and the clouds); every part then does nothing.
   *  Idempotent. */
  dispose(): void;
}

interface GlobeViewAirOptions {
  /** A touch screen: the space pass marches fewer samples (the lab's). */
  readonly coarsePointer: boolean;
  /** Tests: the drawers (default: the real ones, made for the view). */
  readonly drawers?: (view: AirView) => AirDrawers;
  /** The heavy clouds, made over the drawers (`globeViewClouds(view)`);
   *  absent: none. */
  readonly clouds?: CloudsFactory;
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
  const clouds = options.clouds?.(drawers) ?? null;
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
    // Set each frame: the near clouds may fail after the view opened.
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
    step(frame = {}) {
      if (disposed) return;
      params.atmoGround = clouds?.nearLive() === true ? 1 : 0;
      const { position } = view.ecefCamera();
      air.step(params, {
        cameraEcef: [position.x, position.y, position.z],
        framed: view.frameTarget() !== null,
      });
      view.sea?.setSky(groundSky.atmosphere?.sharedUniforms ?? null);
      const shareClouds = frame.shareClouds ?? (() => 0);
      // The clouds between the hand-over and the sun's ease (the volumes
      // update with the frame's previous sun, as in the lab); without
      // them the flat layer is whole, on a shell at the clouds' height (the
      // heavy clouds set it each frame; the shell is made at height 0,
      // under the terrain).
      if (clouds) {
        clouds.step({ observerKm: air.observerKm(), shareClouds });
      } else {
        view.globe.cloudShell.setHeightM(GLOBE_VIEW_CLOUDS.cloudShellKm * 1000);
        shareClouds(1);
      }
      air.finish(params);
      stepped = true;
    },
    afterScene() {
      if (!live()) return;
      clouds?.render({ weight: air.weight() });
      air.render(view.camera, params, {
        drawn: true,
        worldFromEcef: view.globe.tiles.group.matrixWorld,
        sunEcef: view.globe.surfaceUniforms.uSunEcef.value,
        sceneDepth: clouds?.sceneDepth() ?? null,
      });
    },
    haze(tiles) {
      if (disposed) return;
      // The clouds' shadow first: the haze is applied last.
      clouds?.patch(tiles);
      haze.patch(tiles);
    },
    setClouds(on) {
      clouds?.setOn(on);
    },
    cloudShell: () => clouds?.shell() ?? null,
    state: () => ({
      weight: air.weight(),
      observerKm: air.observerKm(),
      groundSky: air.groundSkyState(),
      clouds: clouds?.state() ?? null,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const drawer of [clouds, haze, groundSky, spacePass]) {
        try {
          drawer?.dispose();
        } catch {
          // One drawer that fails to free leaves the others to run.
        }
      }
    },
  };
}
