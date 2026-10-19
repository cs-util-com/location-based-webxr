/**
 * The ground under a ray, from the relief's SAMPLED heights (tour editor
 * plan 2026-10-17-1816 §13, "Picking and dragging"; G0 spikes Q2): a march
 * along the ray, each step one height sample and never longer than the
 * height measured there allows, then bisection on the step where the ray
 * goes from above the ground to below it. 10-20 times
 * cheaper than the relief's raycast, which reads the DRAWN mesh (and is
 * blocked by the globe's stencil fill); 0 misses in the spike's 40 drags,
 * identical heights across levels of detail.
 *
 * What the editor picks (its items, on its own layer) is the editor's: this
 * gives the distance along the ray to the ground, so an item behind the
 * ground can be told from one in front of it.
 *
 * @see globe-ground-hit.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

export const GROUND_HIT = Object.freeze({
  /**
   * How far along the ray the march looks (m); the spike's 5 km. A ray
   * from height h reaches the ground within it only when pitched at least
   * asin(h / 5 km) down: from 3 km, about 37 degrees. A shallow overview
   * passes a larger `maxDistanceM`.
   */
  maxDistanceM: 5_000,
  /**
   * The steepest ground the step bound assumes, rise per run: 3, about 72
   * degrees. From a sample at a height h over the ground the next step is
   * h / sqrt(1 + maxSlope^2): on ground no steeper, nothing of the relief
   * lies that close, so a step cannot pass through a ridge and out again.
   */
  maxSlope: 3,
  /** The least step (m): an underground stretch shorter can be stepped over. */
  minStepM: 1,
  /**
   * The least step's growth with the distance (m per m): from a sample t
   * along the ray the step is at least `stepPerM` x t, 1 mm a metre, about
   * a pixel's footprint there (a 60 degree view over 1 000 pixels: 1.05e-3
   * rad a pixel). A ray aimed at the horizon grazes the ground for its
   * whole reach, where the step bounded by the height is a metre or less:
   * from 300 m to its 61.8 km horizon that took 11 664 samples, 1 327 with
   * this. The price: an underground stretch shorter than
   * max(`minStepM`, `stepPerM` x its distance) can be stepped over (1 m
   * at 1 km, 20 m at 20 km).
   */
  stepPerM: 1e-3,
  /**
   * The step from a sample with NO heights loaded, as a fraction of the
   * distance (2 %; at least `minStepM`): nothing measured bounds it there.
   */
  stepFraction: 0.02,
  /** Halvings of the crossing's step: 1 m to 0.06 micrometres. */
  bisections: 24,
});

export interface GroundHitOptions {
  /** Where along the ray the march starts (m, >= 0; 0 = the origin). */
  readonly startM?: number;
  readonly maxDistanceM?: number;
  /** Finite and > 0. */
  readonly maxSlope?: number;
  readonly minStepM?: number;
  /** Finite and >= 0 (0: the least step stays `minStepM`). */
  readonly stepPerM?: number;
  readonly stepFraction?: number;
  /** 1-60. */
  readonly bisections?: number;
}

/** Height samples taken, and how many found no heights loaded. */
interface GroundSamples {
  readonly samples: number;
  readonly nulls: number;
}

export interface GroundHit extends GroundSamples {
  /** Null: a hit. */
  readonly miss: null;
  /** The distance along the (normalised) ray to the ground, m. */
  readonly t: number;
  /** The point on the ground, in the ray's frame. */
  readonly point: THREE.Vector3;
}

/**
 * Why a ray found no ground, so the editor knows what to do about it:
 * - `not-loaded`: some heights along the ray were missing (or the start's
 *   were), so the ground may be there once they load: ask again;
 * - `below-start`: the ray starts on or under the ground: no pick;
 * - `out-of-reach`: the ray was still closing on the ground when its
 *   reach ran out: a longer `maxDistanceM` may find it;
 * - `above`: the ray was moving away from the ground at its end (the
 *   sky, or past the horizon): no pick.
 */
export type GroundMissReason =
  "not-loaded" | "below-start" | "out-of-reach" | "above";

export interface GroundMiss extends GroundSamples {
  readonly miss: GroundMissReason;
}

/** A hit (`miss` null) or a miss with its reason. */
export type GroundHitResult = GroundHit | GroundMiss;

/**
 * The height (m) of a point above the sampled ground (negative below), or
 * null where no heights are loaded under it.
 */
export type AboveGround = (point: THREE.Vector3) => number | null;

/** RangeError with `message` unless `ok`. */
function must(ok: boolean, message: string): void {
  if (!ok) throw new RangeError(message);
}

const finiteAtLeast = (v: number, least: number): boolean =>
  Number.isFinite(v) && v >= least;

const finitePositive = (v: number): boolean => Number.isFinite(v) && v > 0;

/** The options with their defaults. */
function withDefaults(options: GroundHitOptions) {
  return {
    startM: options.startM ?? 0,
    maxDistanceM: options.maxDistanceM ?? GROUND_HIT.maxDistanceM,
    maxSlope: options.maxSlope ?? GROUND_HIT.maxSlope,
    minStepM: options.minStepM ?? GROUND_HIT.minStepM,
    stepPerM: options.stepPerM ?? GROUND_HIT.stepPerM,
    stepFraction: options.stepFraction ?? GROUND_HIT.stepFraction,
    bisections: options.bisections ?? GROUND_HIT.bisections,
  };
}

/** The options with their defaults, each checked (RangeError). */
function checked(options: GroundHitOptions) {
  const o = withDefaults(options);
  must(
    finiteAtLeast(o.startM, 0),
    `the start must be finite and >= 0, got ${o.startM}`,
  );
  must(
    finiteAtLeast(o.maxDistanceM, o.startM) && o.maxDistanceM > o.startM,
    `the maximum distance must be finite and past the start, got ${o.maxDistanceM}`,
  );
  must(
    finitePositive(o.maxSlope),
    `the steepest slope must be finite and > 0, got ${o.maxSlope}`,
  );
  must(
    finitePositive(o.minStepM),
    `the least step must be finite and > 0, got ${o.minStepM}`,
  );
  must(
    finiteAtLeast(o.stepPerM, 0),
    `the least step's growth must be finite and >= 0, got ${o.stepPerM}`,
  );
  must(
    finiteAtLeast(o.stepFraction, 0),
    `the step fraction must be finite and >= 0, got ${o.stepFraction}`,
  );
  must(
    Number.isInteger(o.bisections) && o.bisections >= 1 && o.bisections <= 60,
    `bisections must be an integer 1-60, got ${o.bisections}`,
  );
  return o;
}

/**
 * The crossing within [lo, hi] (above the ground at lo, on or below at
 * hi), halved `times` times; an unloaded midpoint ends the halving there.
 */
function bisect(
  lo: number,
  hi: number,
  above: (t: number) => number | null,
  times: number,
): number {
  for (let i = 0; i < times; i++) {
    const mid = (lo + hi) / 2;
    const m = above(mid);
    if (m === null) break;
    if (m > 0) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** A copy of `ray` with a unit direction (RangeError for a zero or non-finite one). */
function unitRay(ray: THREE.Ray): THREE.Ray {
  const length = ray.direction.length();
  if (!(length > 0 && Number.isFinite(length))) {
    throw new RangeError("the ray needs a non-zero, finite direction");
  }
  return new THREE.Ray(
    ray.origin.clone(),
    ray.direction.clone().divideScalar(length),
  );
}

/**
 * Where `ray` first goes from above the ground to on or below it, by
 * `aboveGround`: marched in steps bounded by the height measured (from a
 * sample h over the ground at a distance t, max(`minStepM`,
 * `stepPerM` x t, h / sqrt(1 + `maxSlope`^2)); from an unloaded one,
 * max(`minStepM`, `stepPerM` x t, `stepFraction` x t)),
 * then bisected between the last loaded sample above the ground and the
 * first loaded sample on or below it, unloaded samples between them or
 * not (a crossing inside an unloaded stretch is found within that
 * stretch; a bisection that meets an unloaded midpoint stops there). On
 * ground no steeper than `maxSlope`, and where every sample had heights
 * loaded (`nulls` 0), every underground stretch longer than
 * max(`minStepM`, `stepPerM` x its distance) is found and the hit is the
 * first one's entry; with `nulls` > 0 a ridge inside or right after an
 * unloaded stretch can have been stepped over, so a hit may lie behind
 * it (ask again once the heights load). A miss
 * says why (`GroundMissReason`): heights missing along the way (or at
 * the start) make it `not-loaded`, whatever else holds; else a first
 * loaded sample on or under the ground makes it `below-start`; else a ray
 * still closing on the ground at `maxDistanceM` (its last two loaded
 * heights falling) is `out-of-reach`, and any other is `above`.
 * RangeError for a zero direction or an option out of range.
 */
export function marchToGround(
  ray: THREE.Ray,
  aboveGround: AboveGround,
  options: GroundHitOptions = {},
): GroundHitResult {
  const o = checked(options);
  const r = unitRay(ray);
  // The clear distance per metre of height over S-sloped ground.
  const perHeight = 1 / Math.hypot(1, o.maxSlope);
  const at = new THREE.Vector3();
  let samples = 0;
  let nulls = 0;
  const above = (t: number): number | null => {
    samples++;
    const h = aboveGround(r.at(t, at));
    if (h === null || !Number.isFinite(h)) {
      nulls++;
      return null;
    }
    return h;
  };
  // Missing heights make any miss not-loaded: waiting may change it.
  const missed = (reason: GroundMissReason): GroundMiss => ({
    miss: nulls > 0 ? "not-loaded" : reason,
    samples,
    nulls,
  });
  // The last loaded sample above the ground (null before the first), its
  // height, and whether that height fell from the loaded one before it.
  let lastAbove: number | null = null;
  let lastH = Infinity;
  let closing = false;
  for (let t = o.startM; ;) {
    const h = above(t);
    if (h !== null && h > 0) {
      closing = h < lastH;
      lastH = h;
      lastAbove = t;
    } else if (h !== null) {
      // On or under the ground: a crossing if anything loaded was above,
      // else the ray started there, as far as anything loaded shows.
      if (lastAbove === null) return missed("below-start");
      const hit = bisect(lastAbove, t, above, o.bisections);
      return {
        miss: null,
        t: hit,
        point: r.at(hit, new THREE.Vector3()),
        samples,
        nulls,
      };
    }
    if (t >= o.maxDistanceM) {
      return missed(closing ? "out-of-reach" : "above");
    }
    const bound = h === null ? o.stepFraction * t : h * perHeight;
    const least = Math.max(o.minStepM, o.stepPerM * t);
    t = Math.min(o.maxDistanceM, t + Math.max(least, bound));
  }
}

/** What `terrainAboveGround` reads of a terrain (`createGlobeTerrain`'s). */
export interface SampledTerrain {
  readonly tiles: {
    readonly group: THREE.Object3D;
    readonly ellipsoid: Ellipsoid;
  };
  readonly plugin: {
    /** The drawn height (m) at a latitude and longitude (radians), or null. */
    sampleCartographicElevation(lat: number, lon: number): number | null;
  };
}

/**
 * A world point's height above `terrain`'s sampled ground: the point taken
 * into the tiles' frame (the group's world matrix, read once now), then to
 * a latitude, longitude and height on the ellipsoid.
 */
export function terrainAboveGround(terrain: SampledTerrain): AboveGround {
  const toTiles = terrain.tiles.group.matrixWorld.clone().invert();
  const local = new THREE.Vector3();
  const c = { lat: 0, lon: 0, height: 0 };
  return (point) => {
    local.copy(point).applyMatrix4(toTiles);
    terrain.tiles.ellipsoid.getPositionToCartographic(local, c);
    const ground = terrain.plugin.sampleCartographicElevation(c.lat, c.lon);
    return ground === null ? null : c.height - ground;
  };
}

/** The ground under a WORLD-space ray over `terrain` (`marchToGround`). */
export function groundHit(
  terrain: SampledTerrain,
  ray: THREE.Ray,
  options: GroundHitOptions = {},
): GroundHitResult {
  return marchToGround(ray, terrainAboveGround(terrain), options);
}

/** The Earth's mean radius (m), for the horizon's distance. */
const EARTH_RADIUS_M = 6_371_000;

/**
 * A reach (`maxDistanceM`) for a camera `heightM` over the ground: the
 * distance to its horizon over a smooth Earth, sqrt(2 R h + h^2), and never
 * less than the default reach (a camera under the ground, at a bad height,
 * keeps the default). From 30 m 19.6 km, from 3 km 195.5 km. Ground that
 * stands up beyond the horizon (a far mountain) is out of this reach.
 * RangeError for a non-finite height.
 */
export function groundReachM(heightM: number): number {
  if (!Number.isFinite(heightM)) {
    throw new RangeError(`the height must be finite, got ${heightM}`);
  }
  const h = Math.max(0, heightM);
  return Math.max(
    GROUND_HIT.maxDistanceM,
    Math.sqrt(2 * EARTH_RADIUS_M * h + h * h),
  );
}
