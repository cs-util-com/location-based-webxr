/**
 * The cached two-map sun shadow over a city, the three.js controller: the
 * sun light carries a NEAR map that follows the orbit target and is fitted
 * to the camera distance; a second light of zero intensity, added after the
 * sun under the same parent, carries a FAR map over the whole loaded city.
 * Both maps render only when the update rule says so (a sun step, a caster
 * change, a re-centre or a zoom step), never per frame. The shader side is
 * `two-map-shadow.ts` (install it once per page); the fit is
 * `shadow-fit.ts`; the rules are `two-map-shadow-rig.ts`.
 *
 * The `low` tier has one map: the sun itself carries the far bounds and no
 * second light exists, so the rewrite stays inert.
 *
 * @see two-map-sun-shadow.ts.md
 */

import * as THREE from 'three';

import {
  SHADOW_FIT,
  nearFadeFar,
  nearShadowHalfWidth,
  shadowCasterDistance,
  shadowStrengthAt,
  snapShadowCentre,
  wholeSquareFar,
  type CityBox,
} from './shadow-fit.js';
import {
  createSunShadow,
  type SunShadow,
  type SunShadowFit,
} from './sun-shadow.js';
import {
  SUN_SHADOW,
  type ShadowUpdateState,
  type Vec3,
} from './sun-shadow-rig.js';
import {
  SHADOW_TIERS,
  planMapRenders,
  type MapRenderPlan,
  type ShadowTier,
  type ShadowTierSpec,
} from './two-map-shadow-rig.js';

/** The controller's knobs (defaults from `SHADOW_FIT` and `SUN_SHADOW`). */
export interface TwoMapShadowOptions {
  /** Near half width = k x camera distance, before the steps. */
  readonly k?: number;
  readonly halfWidthSteps?: readonly number[];
  readonly floorDeg?: number;
  readonly fullDeg?: number;
  readonly marginM?: number;
  /** The near map's depth fade starts this fraction of R past its centre. */
  readonly fadeFraction?: number;
  /** A map re-renders when the sun moved more than this. */
  readonly sunUpdateDeg?: number;
  /** The near map re-centres past this fraction of R. */
  readonly innerFraction?: number;
  /** Render near and far in alternate frames instead of one. */
  readonly split?: boolean;
  /** The tier table (default `SHADOW_TIERS`). */
  readonly tiers?: Readonly<Record<Exclude<ShadowTier, 'off'>, ShadowTierSpec>>;
}

/** What the app knows this frame. */
export interface TwoMapShadowInput {
  /** Unit direction toward the sun; may be at or below the horizon. */
  readonly sunDir: Vec3;
  /** The orbit target, on the ground. */
  readonly target: Vec3;
  /** The camera's distance from the target, metres. */
  readonly cameraDistanceM: number;
  /** The loaded city's box and tallest caster. */
  readonly city: CityBox;
  /** Changes whenever the caster set changed (`casterGeneration`). */
  readonly casterGeneration: string;
}

export interface TwoMapSunShadow {
  /**
   * Follow the sun, the view and the casters. Sets the shadow strength,
   * places the sun light along the current sun, and requests the map
   * renders the rule asks for. `again` asks the caller for one more frame
   * (a far render deferred by `split`).
   */
  update(input: TwoMapShadowInput): MapRenderPlan;
  /** Free both maps' GPU memory; `update` renders nothing until `restore`. */
  release(): void;
  /** After `release`: the next `update` renders both maps once. */
  restore(): void;
  /** Switch the tier; `off` stops casting and removes the far light. */
  setTier(tier: ShadowTier): void;
  /** How many map renders `update` has requested, both maps together. */
  readonly renders: number;
  /** The far light, or undefined with fewer than two maps (tests, probes). */
  readonly farLight: THREE.DirectionalLight | undefined;
  /** Stop casting, remove the far light, restore the sun as it was found. */
  dispose(): void;
}

const DEG = Math.PI / 180;

interface Maps {
  readonly near: SunShadow;
  readonly far?: SunShadow;
  readonly farLight?: THREE.DirectionalLight;
  readonly spec: ShadowTierSpec;
}

function elevationDeg(sunDir: Vec3): number {
  return Math.asin(Math.max(-1, Math.min(1, sunDir[1]))) / DEG;
}

function assertInput(input: TwoMapShadowInput): void {
  const finite = [...input.sunDir, ...input.target].every(Number.isFinite);
  if (!finite || !(input.cameraDistanceM > 0)) {
    throw new RangeError(
      'the sun direction and target must be finite and the camera distance positive'
    );
  }
}

/**
 * Makes `sun` the city's shadow-casting sun in `tier`. `sun` must already be
 * a child of `parent`: the far light is added after it, so three makes the
 * sun shadow 0 (three orders casting lights by traversal).
 *
 * @throws RangeError when `sun` is not a child of `parent`.
 */
export function createTwoMapSunShadow(config: {
  readonly sun: THREE.DirectionalLight;
  readonly parent: THREE.Object3D;
  readonly tier: ShadowTier;
  readonly options?: TwoMapShadowOptions;
}): TwoMapSunShadow {
  const { sun, parent } = config;
  if (sun.parent !== parent) {
    throw new RangeError('the sun light must be a child of the given parent');
  }
  const o = config.options ?? {};
  const tiers = o.tiers ?? SHADOW_TIERS;
  const ramp = {
    floorDeg: o.floorDeg ?? SHADOW_FIT.floorDeg,
    fullDeg: o.fullDeg ?? SHADOW_FIT.fullDeg,
  };
  const marginM = o.marginM ?? SHADOW_FIT.marginM;
  const thresholds = {
    sunDeg: o.sunUpdateDeg ?? SUN_SHADOW.sunUpdateDeg,
    innerFraction: o.innerFraction ?? SUN_SHADOW.innerFraction,
  };
  const previousIntensity = sun.shadow.intensity;
  let maps: Maps | undefined;
  let released = false;
  let finished = false;
  let lastCentre: Vec3 | undefined;
  let lastDistance = 0;
  let rendersBefore = 0;

  const makeMaps = (tier: ShadowTier): Maps | undefined => {
    if (tier === 'off') return undefined;
    const spec = tiers[tier];
    const near = createSunShadow({
      light: sun,
      mapSize: spec.nearSize,
      thresholds,
      lightFollowsSun: true,
    });
    if (spec.maps === 1 || spec.farSize === undefined) return { near, spec };
    const farLight = new THREE.DirectionalLight(0xffffff, 0);
    farLight.name = 'two-map far shadow';
    parent.add(farLight, farLight.target);
    const far = createSunShadow({
      light: farLight,
      mapSize: spec.farSize,
      thresholds,
    });
    return { near, far, farLight, spec };
  };

  const dropMaps = (): void => {
    if (!maps) return;
    rendersBefore += maps.near.renders + (maps.far?.renders ?? 0);
    maps.near.dispose();
    maps.far?.dispose();
    if (maps.farLight) parent.remove(maps.farLight, maps.farLight.target);
    maps = undefined;
  };

  /** The near state: R from the camera distance, centre on the texel grid. */
  const nearState = (input: TwoMapShadowInput, m: Maps): ShadowUpdateState => {
    const R = nearShadowHalfWidth(input.cameraDistanceM, {
      ...(o.k === undefined ? {} : { k: o.k }),
      ...(o.halfWidthSteps === undefined ? {} : { steps: o.halfWidthSteps }),
    });
    return {
      sunDir: input.sunDir,
      centre: snapShadowCentre(input.target, input.sunDir, R, m.spec.nearSize),
      halfWidthM: R,
      casterGeneration: input.casterGeneration,
      casterOffsetM: 0,
    };
  };

  /** The whole-city state: the city's square, centred on its ground. */
  const cityState = (input: TwoMapShadowInput): ShadowUpdateState => ({
    sunDir: input.sunDir,
    centre: input.city.centre,
    halfWidthM: input.city.halfExtentM,
    casterGeneration: input.casterGeneration,
    casterOffsetM: 0,
  });

  const fitFor = (
    state: ShadowUpdateState,
    input: TwoMapShadowInput,
    fade: boolean
  ): SunShadowFit => {
    const distanceM = shadowCasterDistance({
      centre: state.centre,
      sunDir: state.sunDir,
      halfWidthM: state.halfWidthM,
      city: input.city,
      floorDeg: ramp.floorDeg,
      marginM,
    });
    const farM = fade
      ? nearFadeFar(distanceM, state.halfWidthM, o.fadeFraction)
      : wholeSquareFar(distanceM, state.halfWidthM);
    return { distanceM, farM };
  };

  /** Below the floor: no map, the light still along the current sun. */
  const placeBelowFloor = (input: TwoMapShadowInput): void => {
    const centre = lastCentre ?? input.target;
    const d = lastDistance > 0 ? lastDistance : 1000;
    sun.position.set(
      centre[0] + input.sunDir[0] * d,
      centre[1] + input.sunDir[1] * d,
      centre[2] + input.sunDir[2] * d
    );
    sun.target.position.set(centre[0], centre[1], centre[2]);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
  };

  const remember = (state: ShadowUpdateState, fit: SunShadowFit): void => {
    lastCentre = state.centre;
    lastDistance = fit.distanceM ?? lastDistance;
  };

  const updateMaps = (input: TwoMapShadowInput, m: Maps): MapRenderPlan => {
    const two = m.far !== undefined;
    const sunState = two ? nearState(input, m) : cityState(input);
    const farState = cityState(input);
    const plan = planMapRenders({
      near: m.near.wouldUpdate(sunState),
      far: m.far?.wouldUpdate(farState) ?? false,
      split: o.split ?? false,
    });
    const sunFit = plan.near ? fitFor(sunState, input, two) : {};
    m.near.update(sunState, sunFit);
    if (plan.near) remember(sunState, sunFit);
    if (plan.far) m.far?.update(farState, fitFor(farState, input, false));
    return plan;
  };

  const none: MapRenderPlan = { near: false, far: false, again: false };

  maps = makeMaps(config.tier);

  return {
    update(input) {
      assertInput(input);
      if (finished || !maps || released) return none;
      const strength = shadowStrengthAt(elevationDeg(input.sunDir), ramp);
      sun.shadow.intensity = strength;
      if (strength === 0) {
        placeBelowFloor(input);
        return none;
      }
      return updateMaps(input, maps);
    },
    release() {
      released = true;
      maps?.near.release();
      maps?.far?.release();
    },
    restore() {
      released = false;
    },
    setTier(tier) {
      if (finished) return;
      dropMaps();
      maps = makeMaps(tier);
      if (released) {
        maps?.near.release();
        maps?.far?.release();
      }
    },
    get renders() {
      return (
        rendersBefore +
        (maps ? maps.near.renders + (maps.far?.renders ?? 0) : 0)
      );
    },
    get farLight() {
      return maps?.farLight;
    },
    dispose() {
      if (finished) return;
      finished = true;
      dropMaps();
      sun.shadow.intensity = previousIntensity;
    },
  };
}
