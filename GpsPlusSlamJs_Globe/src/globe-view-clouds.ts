/**
 * The heavy clouds for an app's globe view: the globe lab's cloud volume
 * (the slab near the ground), its spherical volume (the shell from orbit
 * down to the slab) and its high layer, with the lab's settings, made for
 * a `GlobeView` and stepped by `globe-view-air.ts` between the sky's
 * hand-over and the sun's eased exposure, as the lab steps them.
 *
 * Its parts, each at the air's place:
 * - `patch(tiles)` before the haze's: the slab's shadow on every model the
 *   relief loads, and the relief whose depth ends the march;
 * - `step(frame)` between the air's `step` and `finish`: who draws the
 *   clouds at the camera's altitude (`globe-cloud-step.ts`), the cloud
 *   shell's share from the page (its relief mount) and the ground's soft
 *   shadow, then the two volumes' update;
 * - `render(frame)` after the Earth, before the space pass: the relief's
 *   depth while the ground sky shows, then the slab and the shell mixed.
 *
 * `setOn(false)` turns the slab off, and with it the shell (the lab's
 * `cloudVolume=0`): the flat layer then only weakens near the ground.
 *
 * @see globe-view-clouds.ts.md
 */
import * as THREE from "three";

import {
  createGlobeCloudShellVolume,
  type GlobeCloudShellVolume,
} from "./globe-cloud-shell-volume-pass.js";
import {
  CLOUD_HIGH_LAYER,
  CLOUD_SHELL_VOLUME,
} from "./globe-cloud-shell-volume.js";
import {
  createGlobeCloudStep,
  type GlobeCloudKnobs,
} from "./globe-cloud-step.js";
import {
  createGlobeCloudVolume,
  type GlobeCloudVolume,
} from "./globe-cloud-volume-pass.js";
import type { GlobeAtmosphere } from "./globe-atmosphere.js";
import type { GlobeGroundSky } from "./globe-ground-sky.js";
import {
  createGlobeSceneDepth,
  type GlobeSceneDepth,
} from "./globe-scene-depth.js";
import type { GlobeSurface } from "./globe-surface.js";
import type { LatLng } from "./globe-target.js";

/** The top station of the shell's law (the coarse set). */
const TOP = CLOUD_SHELL_VOLUME.stations[0];

/** The cloud step's knobs and the three the view's clouds add. */
export type GlobeViewCloudKnobs = GlobeCloudKnobs & {
  /** The cloud shell's height (km). */
  readonly cloudShellKm: number;
  /** The shell's soft shadow on the ground (0 off). */
  readonly cloudShadow: number;
  /** How much of the slab's flat deck the shell takes. */
  readonly cloudShellFlat: number;
};

/**
 * The lab's cloud settings with its heavy clouds on (the spherical volume,
 * the high layer and the shell's own shadow), under the lab's hash names;
 * every other value is the lab's default.
 */
export const GLOBE_VIEW_CLOUDS = Object.freeze({
  cloudVolume: 2,
  cloudVolumeKm: 80,
  cloudVolumeCeilingKm: 40,
  cloudVolumeFadeKm: 25,
  cloudVolumeCover: 1,
  cloudShadowFrom: 0,
  cloudNoise: "live",
  cloudFineGain: 0.5,
  cloudShellVolume: 1,
  cloudShellTopKm: CLOUD_SHELL_VOLUME.topKm,
  cloudShellMidKm: 200,
  cloudShellBandKm: CLOUD_SHELL_VOLUME.bandKm,
  cloudShellFields: 3,
  cloudShellCell: TOP.cellScale,
  cloudShellThick: TOP.thicknessScale,
  cloudShellNoise: TOP.noiseShare,
  cloudShellRes: 0.5,
  cloudShellShadow: 0.5,
  cloudFlat: 1,
  cloudFlatTopKm: 5_000,
  cloudFlatWeak: 0.3,
  cloudFlatOutFromKm: 900,
  cloudFlatOutToKm: 700,
  cloudHigh: 1,
  cloudHighKm: CLOUD_HIGH_LAYER.altitudeKm,
  cloudHighCell: CLOUD_HIGH_LAYER.cellScale,
  cloudHighCover: CLOUD_HIGH_LAYER.cover,
  cloudHighShare: CLOUD_HIGH_LAYER.noiseShare,
  /** The cloud shell's height (km; the lab's, with no exaggeration). */
  cloudShellKm: 3,
  /** The shell's soft shadow on the ground (the lab's). */
  cloudShadow: 0.6,
  /** How much of the slab's flat deck the shell takes (the lab's). */
  cloudShellFlat: 1,
} as const satisfies GlobeViewCloudKnobs);

/** What the clouds read and write of the view (a `GlobeView` is one). */
export interface CloudsView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly globe: Pick<GlobeSurface, "cloudShell" | "surfaceUniforms"> & {
    readonly sun: { readonly intensity: number };
    readonly tiles: Pick<GlobeSurface["tiles"], "ellipsoid" | "group">;
  };
  ecefCamera(): { readonly position: THREE.Vector3 };
  frameTarget(): LatLng | null;
}

/** The three parts the clouds drive (tests pass fakes). */
export interface CloudsParts {
  readonly sceneDepth: Pick<GlobeSceneDepth, "beginFrame" | "render"> &
    Partial<Pick<GlobeSceneDepth, "dispose">>;
  readonly cloudVolume: GlobeCloudVolume;
  readonly shellVolume: GlobeCloudShellVolume;
}

/** The relief's tiles, as the slab's shadow patches them. */
type CloudsTiles = Parameters<GlobeCloudVolume["patchShadow"]>[0] & {
  readonly group: THREE.Object3D;
};

/** What `step` is told each frame. */
interface CloudsStepFrame {
  /** The observer's height over the ellipsoid (km; the air's). */
  readonly observerKm: number;
  /**
   * Gives the cloud shell its share for the flat layer's `flat` and
   * returns it (the page's relief mount: `shareClouds(true, flat)`).
   */
  readonly shareClouds: (flat: number) => number;
}

/** What `render` is told each frame. */
interface CloudsRenderFrame {
  /** The ground sky's share now (the air's `weight()`). */
  readonly weight: number;
}

export interface GlobeViewClouds {
  /** The slab's shadow on `tiles`, whose depth ends the march. */
  patch(tiles: CloudsTiles): void;
  /** Who draws the clouds, the shell's share and shadow, the volumes. */
  step(frame: CloudsStepFrame): void;
  /** The relief's depth (while the ground sky shows), the clouds. */
  render(frame: CloudsRenderFrame): void;
  /** The heavy clouds on (the default) or off. */
  setOn(on: boolean): void;
  /** Whether they are on, and the last plan's flat share and shell, the
   *  shell's own ground shadow and the surface's (`uCloudShadow`). */
  state(): {
    on: boolean;
    flat: number;
    shellOn: boolean;
    shellShadow: number;
    surfaceShadow: number;
  };
  /** The shell's frames drawn and its share and weights now (its
   *  `state()`; no GPU read-back): what a shadow check reads to tell an
   *  undrawn shell from an empty one. */
  shell(): { drawn: number; share: number; weight: number; slabWeight: number };
  /** Frees the three parts; idempotent; every part then does nothing. */
  dispose(): void;
}

/** The air's drawers the clouds are made over. */
interface CloudsDrawers {
  readonly groundSky: Pick<
    GlobeGroundSky,
    "supported" | "atmosphere" | "scene"
  >;
  readonly spacePass: Pick<GlobeAtmosphere, "transmittance">;
}

/** Makes the clouds over the air's drawers (null: none can be drawn). */
export type CloudsFactory = (drawers: CloudsDrawers) => GlobeViewClouds | null;

/**
 * The real parts for `view`, or null where the ground sky cannot draw
 * (its slab is the cloud volume).
 */
export function createCloudsParts(
  view: CloudsView,
  { groundSky, spacePass }: CloudsDrawers,
): CloudsParts | null {
  const { atmosphere } = groundSky;
  if (!groundSky.supported || atmosphere === null) return null;
  const sceneDepth = createGlobeSceneDepth(view.renderer);
  const cloudVolume = createGlobeCloudVolume(view.renderer, {
    atmosphere,
    skyScene: groundSky.scene,
    surfaceUniforms: view.globe.surfaceUniforms,
    sceneDepth,
  });
  const shellVolume = createGlobeCloudShellVolume(view.renderer, {
    ellipsoid: view.globe.tiles.ellipsoid,
    surfaceUniforms: view.globe.surfaceUniforms,
    groundSky: atmosphere,
    atmosphere: spacePass,
    sceneDepth,
  });
  return { sceneDepth, cloudVolume, shellVolume };
}

/**
 * The heavy clouds for `view`, for `mountGlobeViewAir`'s `clouds`: made
 * over the air's ground sky and space pass, none where the ground sky
 * cannot draw.
 */
export function globeViewClouds(
  view: CloudsView,
  options: GlobeViewCloudsOptions = {},
): CloudsFactory {
  return (drawers) => {
    const parts = createCloudsParts(view, drawers);
    return parts ? createGlobeViewClouds(view, parts, options) : null;
  };
}

const NO_EXTRA: readonly THREE.Object3D[] = Object.freeze([]);

/** What an app may tune of the view's clouds. */
export interface GlobeViewCloudsOptions {
  /**
   * The clouds' shadow strength, 0 (none) to 1 (black under a full
   * cloud): the shell's own ground shadow near the ground and the
   * surface's soft one from orbit both take it, so the ground under a
   * full cloud keeps 1 - shadow of its light at every height. Absent: the
   * lab's (0.5 near the ground, 0.6 from orbit).
   */
  readonly shadow?: number;
  /**
   * What else stands on the ground (an app's city root), asked each
   * frame: drawn into the clouds' depth with the relief, so a cloud's
   * rays end at a building rather than passing through it. Absent: none.
   */
  readonly extra?: () => readonly THREE.Object3D[];
}

/**
 * The knobs with an app's shadow strength (the lab's without one).
 * RangeError for a strength that is not a number in 0..1.
 */
function knobsWith({ shadow }: GlobeViewCloudsOptions): GlobeViewCloudKnobs {
  if (shadow === undefined) return GLOBE_VIEW_CLOUDS;
  if (!(shadow >= 0 && shadow <= 1)) {
    throw new RangeError(`the clouds' shadow must be in 0..1, got ${shadow}`);
  }
  return Object.freeze({
    ...GLOBE_VIEW_CLOUDS,
    cloudShellShadow: shadow,
    cloudShadow: shadow,
  });
}

/** The clouds for `view` over `parts`; see the module's comment. */
export function createGlobeViewClouds(
  view: CloudsView,
  parts: CloudsParts,
  options: GlobeViewCloudsOptions = {},
): GlobeViewClouds {
  const { sceneDepth, cloudVolume, shellVolume } = parts;
  const clouds = createGlobeCloudStep({ cloudVolume, shellVolume });
  const onKnobs = knobsWith(options);
  const offKnobs: GlobeViewCloudKnobs = Object.freeze({
    ...onKnobs,
    cloudVolume: 0,
  });
  let knobs: GlobeViewCloudKnobs = onKnobs;
  const extraOf = options.extra ?? (() => NO_EXTRA);
  let relief: THREE.Object3D | null = null;
  let last = { flat: 1, shellOn: false, shellShadow: 0, surfaceShadow: 0 };
  let disposed = false;
  const direction = new THREE.Vector3();
  return {
    patch(tiles) {
      if (disposed) return;
      cloudVolume.patchShadow(tiles);
      relief ??= tiles.group;
    },
    step({ observerKm, shareClouds }) {
      if (disposed) return;
      const { globe, camera } = view;
      globe.cloudShell.setHeightM(knobs.cloudShellKm * 1000);
      const cameraAltM = globe.tiles.ellipsoid.getPositionElevation(
        view.ecefCamera().position,
      );
      const target = view.frameTarget();
      const plan = clouds.plan(knobs, { cameraAltM, framed: target !== null });
      const shellShare = shareClouds(plan.flat);
      globe.surfaceUniforms.uCloudShadow.value =
        knobs.cloudShadow *
        shellShare *
        plan.flatShadow *
        plan.shadow.mapFactor;
      last = {
        flat: plan.flat,
        shellOn: plan.shellOn,
        shellShadow: plan.shadow.shell,
        surfaceShadow: globe.surfaceUniforms.uCloudShadow.value,
      };
      clouds.updateVolumes(knobs, {
        observerKm,
        cameraAltM,
        target,
        view: {
          position: camera.position.toArray(),
          direction: camera.getWorldDirection(direction).toArray(),
        },
        deck: globe.cloudShell,
      });
    },
    render({ weight }) {
      if (disposed || relief === null) return;
      const { globe, camera } = view;
      sceneDepth.beginFrame();
      if (knobs.cloudVolume === 0) return;
      // The relief's depth while the ground sky shows (the shell's rays end
      // at it by that weight); the slab draws it itself when only it needs it.
      const extra = extraOf();
      if (weight > 0) sceneDepth.render(camera, relief, extra);
      clouds.render(camera, {
        relief,
        extra,
        worldFromEcef: globe.tiles.group.matrixWorld,
        sunEcef: globe.surfaceUniforms.uSunEcef.value,
        sunIntensity: globe.sun.intensity,
        sceneDepthWeight: weight,
        flatten: knobs.cloudShellFlat,
      });
    },
    setOn(on) {
      knobs = on ? onKnobs : offKnobs;
    },
    state: () => ({ on: knobs.cloudVolume !== 0, ...last }),
    shell() {
      const { drawn, share, weight, slabWeight } = shellVolume.state();
      return { drawn, share, weight, slabWeight };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const part of [shellVolume, cloudVolume, sceneDepth]) {
        try {
          part.dispose?.();
        } catch {
          // One part that fails to free leaves the others to run.
        }
      }
    },
  };
}
