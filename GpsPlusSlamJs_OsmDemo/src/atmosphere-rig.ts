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

import { AUTO_EXPOSURE } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-exposure";
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
 * The demo's tone mapping, desktop AND AR (one grade; AR imports it):
 * Khronos PBR Neutral since plan 2026-09-23-2149 M3 (DEC-SUN-9; DEC-SUN-11
 * moves AR with it). It replaced ACES Filmic (DEC-R6-4), whose hue shifts
 * and heavy shoulder bent both the twilight sky and the data colours;
 * Neutral keeps hues and is near-linear below its compression knee.
 */
export const TONE_MAPPING = THREE.NeutralToneMapping;

/**
 * `renderer.toneMappingExposure`, 0.5 / 0.6. three's ACES pass divided the
 * exposure by 0.6 before its curve; Neutral does not, so the old 0.5 would
 * have entered the curve 0.74 EV darker, the heat grid included (DEC-SUN-12).
 * This keeps the value that ENTERS the curve, not the look: Neutral has no
 * filmic shoulder, so the same input renders brighter and more saturated in
 * the mids and highlights (a 0.18 grey 80 → 93 of 255, a 1.0 grey 197 →
 * 230; M3 review finding 4), in AR as on the desktop. DEC-R4-5 requires the
 * affordance ramp to stay the loudest thing on screen; the e2e DEC-R4-5
 * sweep holds that. The sky's natural light is compensated instead: see
 * {@link NATURAL_LIGHT_COMPENSATION_EV}.
 */
export const TONE_MAPPING_EXPOSURE = 0.5 / 0.6;

/**
 * EV added to the sky's auto-exposure for the natural light (sky, sun,
 * environment). −2.75 under Khronos Neutral (plan 2026-09-23-2149 M3,
 * §10-§10.1): this is a DATA view, and DEC-R4-5 requires the heat ramp to
 * stay the loudest thing on screen, but a darker backdrop ALWAYS raises that
 * margin, so the EV is bounded from both sides:
 * - the heat grid's margin (bound 5; plain / default ground, 7 e2e sun
 *   points; the JUNE noon, the highest sun, always binds):
 *   −2 EV 4.93 (FAILS), −2.75 5.70 (114 %), −3.25 6.08, −3.75 6.78,
 *   −4.25 7.33, −4.5 7.89 (158 %);
 * - the LIT CITY (heat grid off; mean luma of the warm, low-saturation
 *   pixels, i.e. buildings and roads), boot / June noon / twilight −2.9°:
 *   the owner-approved ACES −2 look 42.6 / 64.7 / 20.8; Neutral −2
 *   48.0 / 75.7 / 23.4; **−2.75 32.0 / 49.5 / 14.7**; −3.75 19.7 / 25.0 /
 *   8.0; −4.5 13.9 / 13.5 / 5.2 (near-black buildings: Neutral's toe
 *   renders a grey below 0.08 as 6.25x²).
 * −2.75 is the brightest EV that passes the margin bound, with the lit city
 * about 25 % darker than the approved look; the e2e sweep holds the lit city
 * to at least half that look at every sun point. DEC-SUN-10's 150 % margin
 * could only be met by blacking out the city (−4.5), so it is an open
 * question for the owner (plan §10.1), not applied.
 *
 * UNDER ACES (the grade until M3; e2e `heat ramp stays the loudest thing`,
 * 2026-09-23), the
 * chroma the heat grid adds on the plain ground (bound 5) at time of day
 * 0.0217 (3.7° morning) / 0.98 (the boot time, evening) / 0.1467 (24°) /
 * 0.2717 (41°) / 0.5217 (55°):
 * - −2 EV: 8.40 / 8.16 / 8.84 / 8.04 / 7.78 (mean luma 64…72 of 255);
 * - −1.5 EV: 7.21 / 7.05 / 6.80 / 6.10 / 5.70 (luma 72…82);
 * - −1 EV: 5.2 at 0.0217, 2.5 at 0.5217 (fails; 0.98 not measured);
 * - +1 EV (the page's photographic look): −4.0 at 0.0217, −9.2 at 0.5217.
 * The old Preetham sky gave 6.35, measured at 0.0217 only. The auto-exposure
 * lifts every surface to mid-grey and absolute chroma grows with
 * brightness, so a brighter backdrop out-shouts the data. −2 kept ≥ 148 %
 * of the bound at every sun the old day reached.
 */
export const NATURAL_LIGHT_COMPENSATION_EV = -2.75;

/** The sun light's intensity at the model's reference elevation (45°): the demo's old white-light value. */
const SUN_INTENSITY = 1.1;

/**
 * Meteorological visibility, km. The middle of the look-dev presets (dawn 30,
 * golden 45, noon 60): at the 2400 m far plane the air keeps ~80 % of the
 * light, so distance reads as haze without hiding the plate. A taste value,
 * set on the page, not measured here.
 */
const VISIBILITY_KM = 45;

/**
 * The sky's cloud cover, 0…1 (the share of the sky clouded): the look-dev
 * page's golden-hour preset. OsmDemo adopted the physical sky without its
 * clouds (cover 0) until the owner's first look at the r718 preview asked
 * for them (plan 2026-09-24-0706). DEC-R4-5's margin and the lit-city floor
 * are measured with them on.
 */
export const CLOUD_COVER = 0.25;

/**
 * The noon brightening (plan 2026-09-24-0901): the colour factor of the
 * building and road materials, 1 up to `fromDeg` of sun, rising linearly to
 * `max` at `fullDeg` and constant above. Those surfaces are nearly grey, so
 * the lift adds brightness without the colour that competes with the heat
 * grid: measured at the June noon, the DEC-R4-5 margin stays 5.50 at ×1.6
 * while lit surfaces go 48 → 70; an exposure lift to the same brightness
 * broke the bound. ×1.45 is the approved look's noon brightness (≈ 65).
 */
export const NOON_SURFACE_GAIN = {
  max: 1.45,
  fromDeg: 20,
  fullDeg: 45,
} as const;

/** The ramp of the building and road colour factor (the light dialog tunes it). */
export interface SurfaceGainRamp {
  readonly max: number;
  readonly fromDeg: number;
  readonly fullDeg: number;
}

/**
 * The building and road colour factor for a sun elevation (radians), on the
 * shipped ramp or the given one.
 *
 * @throws RangeError for a non-finite elevation, or a ramp that does not
 *   rise (`fullDeg` ≤ `fromDeg`).
 */
export function surfaceGainAt(
  elevationRad: number,
  ramp: SurfaceGainRamp = NOON_SURFACE_GAIN,
): number {
  if (!Number.isFinite(elevationRad)) {
    throw new RangeError(`sun elevation must be finite, got ${elevationRad}`);
  }
  const { max, fromDeg, fullDeg } = ramp;
  if (!(fullDeg > fromDeg)) {
    throw new RangeError(
      `the gain ramp must rise, got ${fromDeg}° to ${fullDeg}°`,
    );
  }
  const t = ((elevationRad * 180) / Math.PI - fromDeg) / (fullDeg - fromDeg);
  return 1 + (max - 1) * Math.min(1, Math.max(0, t));
}

/** What the rig uses of `SkyAtmosphere` (the seam its tests stub). */
export type SkyLike = Pick<
  SkyAtmosphere,
  | "configure"
  | "setExposureCompensation"
  | "setAutoExposureAdaptation"
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
  /** The last sun direction (the fallback re-derives from it). */
  private lastDirection: Vector3Like | undefined;
  /** The exposure the light dialog set (`setExposure`); the shipped look by default. */
  private exposureEv: number = NATURAL_LIGHT_COMPENSATION_EV;
  private adaptation: number = AUTO_EXPOSURE.adaptation;

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
    sky?.configure({ cloudCover: CLOUD_COVER });
    if (sky === undefined) {
      this.fallback = this.buildFallback();
      this.unsubscribeRestore = () => {};
    } else {
      this.fallback = undefined;
      sky.setExposureCompensation(this.exposureEv);
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
    this.lastDirection = direction;
    if (this.sky !== undefined) {
      this.sky.configure({ sunDirection: direction });
      this.syncFromSky(this.sky);
    } else {
      this.applyFallback(direction);
    }
    return direction;
  }

  /**
   * The exposure the light dialog tunes (plan 2026-09-24-2140): the EV on top
   * of the auto-exposure and its adaptation. Re-derives every COPY of the
   * sky's exposure (the sun light, the fog colour, the haze), which a change
   * on the sky alone would leave stale until the sun moved (review H1). On
   * the fallback it re-derives the fallback's lights. Validated before any
   * change.
   *
   * @throws RangeError for a non-finite EV or an adaptation outside [0, 1].
   */
  setExposure(exposure: {
    readonly ev: number;
    readonly adaptation: number;
  }): void {
    const { ev, adaptation } = exposure;
    if (!Number.isFinite(ev)) {
      throw new RangeError(`exposure EV must be finite, got ${ev}`);
    }
    if (!(Number.isFinite(adaptation) && adaptation >= 0 && adaptation <= 1)) {
      throw new RangeError(
        `auto-exposure adaptation must be in [0, 1], got ${adaptation}`,
      );
    }
    this.exposureEv = ev;
    this.adaptation = adaptation;
    if (this.sky !== undefined) {
      this.sky.setExposureCompensation(ev);
      this.sky.setAutoExposureAdaptation(adaptation);
      if (this.sunSet) this.syncFromSky(this.sky);
    } else if (this.lastDirection !== undefined) {
      this.applyFallback(this.lastDirection);
    }
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
      exposureCompensationEv: this.exposureEv,
      autoExposureAdaptation: this.adaptation,
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
