/**
 * The air's per-frame wiring (globe F2 plan 2026-10-03-1922, F2b), moved
 * out of the globe lab: the observer's height over the ellipsoid, the sky
 * hand-over between the space pass and the framework's ground sky, the
 * haze that follows it, the sun's eased intensity and the space pass's
 * shell thinning on the way down.
 *
 * The three drawers (the space pass, the ground sky, the haze;
 * `globe-atmosphere.ts`, `globe-ground-sky.ts`, `globe-haze.ts`) are
 * passed in, so this wiring is tested over recording fakes. This module only
 * decides, each frame, what they are told and in which order:
 *
 * - `step` (after the clip planes): the observer's height, the sun's world
 *   direction, the ground sky's update or the space view's values, the
 *   haze's sync after each of the ground sky's reads, the haze's weight.
 * - `finish` (after the cloud volumes' updates): the sun's intensity and
 *   the shell's thickness.
 * - `render` (after the scene): the space pass over the Earth and the sky.
 *
 * @see globe-air.ts.md
 */
import * as THREE from "three";

import { observerAltitudeKm } from "./globe-atmosphere-frame.js";
import { shellThicknessAt } from "./globe-sky-hand-over.js";

/** This frame's hand-over: the ground sky's share and the sun's scale. */
interface AirHandOver {
  weight: number;
  exposure: number;
}

/** What the ground sky's `update` is told each frame. */
interface GroundSkyFrame {
  altitudeKm: number;
  sunWorld: THREE.Vector3;
  framed: boolean;
  edgeKm: number;
  widthKm: number;
  stepPct: number;
  spaceExposure: number;
}

/** The lab's ground sky, as the wiring uses it. */
interface AirGroundSky<Sky> {
  readonly atmosphere: Sky | null;
  update(frame: GroundSkyFrame): AirHandOver;
  state(): { lastStage: string };
}

/** The lab's haze, as the wiring uses it. */
interface AirHaze<Sky> {
  sync(atmosphere: Sky): void;
  setWeight(weight: number, scale: number): void;
}

/** What the space pass's `render` is told. */
interface SpacePassFrame<Depth> {
  worldFromEcef: THREE.Matrix4;
  sunEcef: THREE.Vector3;
  sunIntensity: number;
  skyShare: number;
  groundShare: number;
  sceneDepth: Depth;
  sceneDepthWeight: number;
}

/** The lab's space pass (the atmosphere over the Earth), as used here. */
interface AirSpacePass<Depth> {
  setLook(
    look: { thickness: number } | { steps: number; strength: number },
  ): void;
  render(camera: THREE.Camera, frame: SpacePassFrame<Depth>): void;
}

/**
 * The page's settings the air reads, under the lab's hash names:
 * `groundSky` and `sky` (0 is off), the hand-over's `skyEdgeKm`,
 * `skyWidthKm` and `skyStepPct`, the space view's `sunIntensity`, the
 * haze's `hazeScale`, the shell's `atmoRamp` (1 thins it on the way down)
 * and far `atmoThickness`, `atmoGround` (1 keeps the ground's veil), and
 * the space pass's live `atmoSteps` and `atmoStrength`.
 */
export interface AirParams {
  groundSky: number;
  sky: number;
  skyEdgeKm: number;
  skyWidthKm: number;
  skyStepPct: number;
  sunIntensity: number;
  hazeScale: number;
  atmoRamp: number;
  atmoThickness: number;
  atmoGround: number;
  atmoSteps: number;
  atmoStrength: number;
}

interface GlobeAirOptions<Sky, Depth> {
  /** The ellipsoid's radii (m), x, y, z. */
  ellipsoidRadii: readonly [number, number, number];
  /** The atmosphere model's ground radius (km). */
  groundRadiusKm: number;
  /** The globe's sun: its position in the globe's group, its intensity. */
  sun: { position: THREE.Vector3; intensity: number };
  /** The globe's group, whose world matrix turns the sun into the world. */
  globeGroup: { matrixWorld: THREE.Matrix4 };
  spacePass: AirSpacePass<Depth>;
  groundSky: AirGroundSky<Sky>;
  haze: AirHaze<Sky>;
}

export interface GlobeAir<Depth> {
  /**
   * The hand-over for this frame, after the clip planes: `cameraEcef` the
   * camera's ECEF position (m), `framed` whether the world is the target's
   * local frame. RangeError as `observerAltitudeKm` for a non-finite
   * camera.
   */
  step(
    params: AirParams,
    frame: { cameraEcef: readonly [number, number, number]; framed: boolean },
  ): void;
  /**
   * The sun's eased intensity and the shell's thickness, after the clouds.
   * Throws an Error before the first `step`: there is no hand-over yet.
   */
  finish(params: AirParams): void;
  /**
   * The page's live look of the space pass (its march steps and strength),
   * whenever a setting changes. Never the thickness: `finish` owns it and
   * writes it only on a change, so a live write here would stick.
   */
  setLook(params: AirParams): void;
  /**
   * The space pass over the Earth and the sky (nothing when `drawn` is
   * false): its sky share fades under the ground sky, its ground keeps its
   * veil unless `atmoGround` is 0, its rays end at the drawn relief.
   */
  render(
    camera: THREE.Camera,
    params: AirParams,
    frame: {
      drawn: boolean;
      worldFromEcef: THREE.Matrix4;
      sunEcef: THREE.Vector3;
      sceneDepth: Depth;
    },
  ): void;
  /** The observer's height over the ellipsoid's image (km), this frame. */
  observerKm(): number;
  /** The ground sky's share of the sky this frame (0 above the edge). */
  weight(): number;
  /** The ground sky's state and the observer's height it is fed from. */
  groundSkyState(): Record<string, unknown> & { observerAltitudeKm: number };
}

/** The air's wiring over the lab's three drawers. */
export function createGlobeAir<Sky, Depth>(
  options: GlobeAirOptions<Sky, Depth>,
): GlobeAir<Depth> {
  const { sun, globeGroup, spacePass, groundSky, haze } = options;
  const radii: [number, number, number] = [...options.ellipsoidRadii];
  const sunWorld = new THREE.Vector3();
  let handOver: AirHandOver = { weight: 0, exposure: Number.NaN };
  let observerKm = Number.POSITIVE_INFINITY;
  let shellThickness: number | null = null;
  let stepped = false;
  return {
    step(params, { cameraEcef, framed }) {
      observerKm = observerAltitudeKm(
        cameraEcef,
        radii,
        options.groundRadiusKm,
      );
      sunWorld.copy(sun.position).transformDirection(globeGroup.matrixWorld);
      handOver =
        params.groundSky === 1 && params.sky !== 0
          ? groundSky.update({
              altitudeKm: observerKm,
              sunWorld,
              framed,
              edgeKm: params.skyEdgeKm,
              widthKm: Math.min(params.skyWidthKm, params.skyEdgeKm),
              stepPct: params.skyStepPct,
              spaceExposure: params.sunIntensity,
            })
          : { weight: 0, exposure: params.sunIntensity };
      // The haze follows the ground sky: its state after each read, its
      // strength by the weight. Without its sky there is nothing to copy.
      const { atmosphere } = groundSky;
      if (groundSky.state().lastStage === "read" && atmosphere !== null) {
        haze.sync(atmosphere);
      }
      haze.setWeight(handOver.weight, params.hazeScale);
      stepped = true;
    },
    finish(params) {
      // Before the first `step` there is no hand-over (its exposure NaN,
      // the observer at +Infinity): a caller out of order fails loudly
      // rather than drawing the scene black or guessing a far look.
      if (!stepped) throw new Error("GlobeAir.finish before the first step");
      sun.intensity = handOver.exposure;
      const thickness =
        params.atmoRamp === 1
          ? shellThicknessAt(Math.max(0, observerKm), params.atmoThickness)
          : params.atmoThickness;
      if (thickness !== shellThickness) {
        shellThickness = thickness;
        spacePass.setLook({ thickness });
      }
    },
    setLook(params) {
      spacePass.setLook({
        steps: params.atmoSteps,
        strength: params.atmoStrength,
      });
    },
    render(camera, params, { drawn, worldFromEcef, sunEcef, sceneDepth }) {
      if (!drawn) return;
      spacePass.render(camera, {
        worldFromEcef,
        sunEcef,
        sunIntensity: sun.intensity,
        skyShare: 1 - handOver.weight,
        // The ground keeps its veil, its rays ending at the drawn relief
        // (§17); `atmoGround=0` fades it with the sky's, for a comparison.
        groundShare: params.atmoGround === 1 ? 1 : 1 - handOver.weight,
        sceneDepth,
        // From nothing at the 80 km edge, so the depth is no jump there.
        sceneDepthWeight: handOver.weight,
      });
    },
    observerKm: () => observerKm,
    weight: () => handOver.weight,
    groundSkyState: () => ({
      ...groundSky.state(),
      observerAltitudeKm: observerKm,
    }),
  };
}
