/**
 * The desktop view's physical sky, and everything that must agree with it
 * (plan 2026-09-23-0048, M3; replaces `sky-rig.ts`).
 *
 * ONE OBJECT, because the pieces share one invariant: the visible sky, the
 * sun light, the environment light, the fog colour and the distance haze all
 * describe the same air under the same sun, and each goes visibly wrong on
 * its own if it is updated separately. The framework's `SkyAtmosphere` (a
 * Hillaire 2020 physical sky) supplies the sky, the environment map, the sun
 * light and the horizon colour; `AtmosphereHaze` fades distant geometry
 * toward the sky in its own view direction.
 *
 * WHAT IT REPLACES AND WHY. `sky-rig.ts` drew three's Preetham `Sky` into a
 * PMREM. Above ~20° of sun its disc overflowed the half-float environment map
 * and every standard material rendered black (private docs, 2026-09-23-0828
 * follow-up), and its fog colour was a constant that matched the sky at one
 * time of day. Both are gone with it.
 *
 * THE FALLBACK. A device without float render targets cannot run
 * `SkyAtmosphere`; it gets `fallbackSky`'s CPU colours instead: a gradient
 * dome, a `HemisphereLight`, the same sun light and fog colour. Never a black
 * sky, never an exception that takes the view with it.
 *
 * @see atmosphere-rig.ts.md
 */

import { fallbackSky } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-fallback";
import { AtmosphereHaze } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-haze";
import {
  SkyAtmosphere,
  SkyAtmosphereUnsupportedError,
} from "gps-plus-slam-app-framework/visualization/atmosphere/sky-atmosphere";
import * as THREE from "three";

import type { SunAngles, Vector3Like } from "./sun-position.js";
import { sunDirection } from "./sun-position.js";

/**
 * `renderer.toneMappingExposure` for the ACES pass (DEC-R6-4), UNCHANGED by
 * the physical sky. Every emissive colour in the demo (the heat grid, the
 * beacons) was graded under ACES at 0.5, and DEC-R4-5 requires the
 * affordance ramp to stay the loudest thing on screen; `heat-ramp-dominance`
 * in the e2e suite holds that. The sky's natural light is compensated
 * instead: see {@link NATURAL_LIGHT_COMPENSATION_EV}.
 */
export const TONE_MAPPING_EXPOSURE = 0.5;

/**
 * EV added to the sky's auto-exposure for the natural light (sky, sun,
 * environment). −2, which with the 0.5 above puts the backdrop 3 EV below the
 * look-dev page's photographic grading: this is a DATA view, and DEC-R4-5
 * requires the heat ramp to stay the loudest thing on screen.
 *
 * MEASURED (e2e `heat ramp stays the loudest thing`, 2026-09-23), the
 * chroma the heat grid adds on the plain ground (bound 5) at time of day
 * 0.0217 (3.7° morning) / 0.98 (the boot time, evening) / 0.1467 (24°) /
 * 0.2717 (41°) / 0.5217 (55°):
 * - −2 EV: 8.40 / 8.16 / 8.84 / 8.04 / 7.78 (mean luma 64…72 of 255);
 * - −1.5 EV: 7.21 / 7.05 / 6.80 / 6.10 / 5.70 (luma 72…82);
 * - −1 EV: 5.2 at 0.0217, 2.5 at 0.5217 (fails; 0.98 not measured);
 * - +1 EV (the page's photographic look): −4.0 at 0.0217, −9.2 at 0.5217.
 * The old Preetham sky gave 6.35, measured at 0.0217 only. The auto-exposure
 * lifts every surface to mid-grey and absolute chroma grows with
 * brightness, so a brighter backdrop out-shouts the data. −2 keeps ≥ 153 %
 * of the bound at every time; −1.5 is brighter with 111 % at noon. A taste
 * decision for the owner within that range.
 */
export const NATURAL_LIGHT_COMPENSATION_EV = -2;

/** The sun light's intensity at the model's reference elevation (45°): the demo's old white-light value. */
const SUN_INTENSITY = 1.1;

/**
 * Meteorological visibility, km. The middle of the look-dev presets (dawn 30,
 * golden 45, noon 60): at the 2400 m far plane the air keeps ~80 % of the
 * light, so distance reads as haze without hiding the plate. A taste value,
 * set on the page, not measured here.
 */
const VISIBILITY_KM = 45;

/** What the rig uses of `SkyAtmosphere` (the seam its tests stub). */
export type SkyLike = Pick<
  SkyAtmosphere,
  | "configure"
  | "setExposureCompensation"
  | "applySunLight"
  | "horizonColour"
  | "sharedUniforms"
  | "visibilityKm"
  | "dispose"
>;

export interface AtmosphereRigOptions {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  /** The view's sun; its colour and intensity are set here. */
  readonly sun: THREE.DirectionalLight;
  /**
   * Builds the sky. Defaults to a real `SkyAtmosphere`; tests substitute a
   * stub. Throwing `SkyAtmosphereUnsupportedError` selects the fallback.
   */
  readonly createSky?: (options: {
    readonly renderer: THREE.WebGLRenderer;
    readonly scene: THREE.Scene;
    readonly visibilityKm: number;
    readonly sunIntensity: number;
  }) => SkyLike;
}

/** The fallback's sky: a dome of vertex colours, drawn first, behind everything. */
interface FallbackParts {
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly hemisphere: THREE.HemisphereLight;
}

const DOME_NAME = "fallback-sky-dome";

export class AtmosphereRig {
  /** The distance haze; exposed so an AR session can switch it to stock fog. */
  readonly haze: AtmosphereHaze;
  private readonly scene: THREE.Scene;
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: SkyLike | undefined;
  private readonly fallback: FallbackParts | undefined;
  /** Removes the context-restore listener (physical sky only). */
  private readonly unsubscribeRestore: () => void;
  private sunSet = false;

  constructor(options: AtmosphereRigOptions) {
    this.scene = options.scene;
    this.sun = options.sun;
    this.haze = new AtmosphereHaze({ visibilityKm: VISIBILITY_KM });
    const create =
      options.createSky ??
      ((o: Parameters<NonNullable<AtmosphereRigOptions["createSky"]>>[0]) =>
        new SkyAtmosphere(o));
    let sky: SkyLike | undefined;
    try {
      sky = create({
        renderer: options.renderer,
        scene: this.scene,
        visibilityKm: VISIBILITY_KM,
        sunIntensity: SUN_INTENSITY,
      });
    } catch (error) {
      // ONLY the missing capability selects the fallback; anything else is a
      // defect and must surface where it happened.
      if (!(error instanceof SkyAtmosphereUnsupportedError)) throw error;
    }
    this.sky = sky;
    if (sky === undefined) {
      this.fallback = this.buildFallback();
      this.unsubscribeRestore = () => {};
    } else {
      this.fallback = undefined;
      sky.setExposureCompensation(NATURAL_LIGHT_COMPENSATION_EV);
      // A context restore makes the sky rebuild and RE-MEASURE its exposure;
      // the sun light, the fog colour and the haze hold copies of
      // exposure-dependent values, so they are re-read after it (M3 review,
      // finding 5). Registered after the sky's own listener, so DOM order
      // runs it after the rebuild.
      const canvas = (options.renderer as Partial<THREE.WebGLRenderer>)
        .domElement;
      const onRestored = () => {
        if (this.sunSet) this.syncFromSky(sky);
      };
      canvas?.addEventListener("webglcontextrestored", onRestored);
      this.unsubscribeRestore = () =>
        canvas?.removeEventListener("webglcontextrestored", onRestored);
    }
  }

  /** True when the device could not run the physical sky. */
  get usingFallback(): boolean {
    return this.sky === undefined;
  }

  /**
   * Points the sky at a sun and re-derives everything that depends on it:
   * the sun light, the environment, the fog colour and the haze.
   *
   * Returns the unit direction toward the sun, so the caller places its
   * `DirectionalLight` along the SAME vector the sky uses.
   */
  setSun(angles: SunAngles): Vector3Like {
    const direction = sunDirection(angles);
    this.sunSet = true;
    if (this.sky !== undefined) {
      this.sky.configure({ sunDirection: direction });
      this.syncFromSky(this.sky);
    } else {
      this.applyFallback(direction);
    }
    return direction;
  }

  /**
   * Call before every render. Hazes materials built since the last frame
   * (buildings, cells, routes are rebuilt all the time). It would also heal
   * a material whose `onBeforeCompile` a LATER installer re-assigned; none
   * does today (the ground installers run in the constructor, the cell
   * emissive patches a new material), so that half is a guard. An unchanged
   * material costs a WeakMap lookup. In the fallback, keeps the sky dome on
   * the camera.
   */
  prepareFrame(camera: THREE.Camera): void {
    this.haze.applyToObject(this.scene);
    this.fallback?.dome.position.copy(camera.position);
  }

  /** Releases the sky, the haze's texture and the fallback's objects. */
  dispose(): void {
    this.unsubscribeRestore();
    this.sky?.dispose();
    this.haze.dispose();
    if (this.fallback !== undefined) {
      const { dome, hemisphere } = this.fallback;
      this.scene.remove(dome, hemisphere);
      dome.geometry.dispose();
      dome.material.dispose();
      hemisphere.dispose();
    }
  }

  /** Everything that holds a copy of the sky's exposure-dependent state. */
  private syncFromSky(sky: SkyLike): void {
    sky.applySunLight(this.sun);
    this.setFogColour(sky.horizonColour());
    this.haze.sync(sky);
  }

  private setFogColour(colour: THREE.Color): void {
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(colour);
  }

  private buildFallback(): FallbackParts {
    const geometry = new THREE.SphereGeometry(10, 24, 12);
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(
        new Float32Array(geometry.attributes.position!.count * 3),
        3,
      ),
    );
    const dome = new THREE.Mesh(
      geometry,
      // NOT tone-mapped, to match the fog it meets: in the fallback the haze
      // stays on three's stock fog, which blends AFTER tone mapping toward
      // an un-tone-mapped fog colour. A tone-mapped dome met its own fogged
      // geometry 1.3-2.2x off (M3 review, finding 1). The dome's horizon IS
      // the fog colour, so distance dissolves into the sky behind it. Drawn
      // first, never depth-tested, so its size is irrelevant.
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    dome.name = DOME_NAME;
    dome.renderOrder = -1e6;
    dome.frustumCulled = false;
    const hemisphere = new THREE.HemisphereLight();
    this.scene.add(dome, hemisphere);
    return { dome, hemisphere };
  }

  private applyFallback(direction: Vector3Like): void {
    const parts = this.fallback;
    if (parts === undefined) return;
    const sky = fallbackSky(direction, {
      visibilityKm: VISIBILITY_KM,
      sunIntensity: SUN_INTENSITY,
      exposureCompensationEv: NATURAL_LIGHT_COMPENSATION_EV,
    });
    this.sun.color.setRGB(...sky.sun.colour);
    this.sun.intensity = sky.sun.intensity;
    this.setFogColour(new THREE.Color(...sky.horizon));
    // Radiance-coloured, so π turns it into the irradiance three's
    // hemisphere term expects; the zenith's hue is an approximation of the
    // whole sky's (it is a fallback).
    parts.hemisphere.color.setRGB(...sky.zenith);
    parts.hemisphere.groundColor.setRGB(...sky.ground);
    parts.hemisphere.intensity = Math.PI;
    // Horizon at and below the horizon, easing to the zenith overhead.
    const positions = parts.dome.geometry.attributes.position!;
    const colours = parts.dome.geometry.attributes.color!;
    for (let i = 0; i < positions.count; i++) {
      const up = Math.max(0, positions.getY(i) / 10);
      const t = Math.sqrt(up);
      colours.setXYZ(
        i,
        sky.horizon[0] + (sky.zenith[0] - sky.horizon[0]) * t,
        sky.horizon[1] + (sky.zenith[1] - sky.horizon[1]) * t,
        sky.horizon[2] + (sky.zenith[2] - sky.horizon[2]) * t,
      );
    }
    colours.needsUpdate = true;
  }
}
