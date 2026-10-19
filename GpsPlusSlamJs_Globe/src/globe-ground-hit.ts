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
  readonly stepFraction?: number;
  /** 1-60. */
  readonly bisections?: number;
}

export interface GroundHit {
  /** The distance along the (normalised) ray to the ground, m. */
  readonly t: number;
  /** The point on the ground, in the ray's frame. */
  readonly point: THREE.Vector3;
  /** Height samples taken, and how many found no heights loaded. */
  readonly samples: number;
  readonly nulls: number;
}

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

/** The options with their defaults, each checked (RangeError). */
function checked(options: GroundHitOptions) {
  const o = {
    startM: options.startM ?? 0,
    maxDistanceM: options.maxDistanceM ?? GROUND_HIT.maxDistanceM,
    maxSlope: options.maxSlope ?? GROUND_HIT.maxSlope,
    minStepM: options.minStepM ?? GROUND_HIT.minStepM,
    stepFraction: options.stepFraction ?? GROUND_HIT.stepFraction,
    bisections: options.bisections ?? GROUND_HIT.bisections,
  };
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
 * sample h over the ground, max(`minStepM`, h / sqrt(1 + `maxSlope`^2));
 * from an unloaded one, max(`minStepM`, `stepFraction` x the distance)),
 * then bisected between the last loaded sample above the ground and the
 * first loaded sample on or below it, unloaded samples between them or
 * not (a crossing inside an unloaded stretch is found within that
 * stretch; a bisection that meets an unloaded midpoint stops there). On
 * ground no steeper than `maxSlope`, every underground stretch longer
 * than `minStepM` is found and the hit is the first one's entry. Null
 * when the ray stays above the ground within `maxDistanceM`, starts on or
 * below it (its first LOADED sample is: an unloaded start proves nothing),
 * or finds nothing loaded. RangeError for a zero direction or an option
 * out of range.
 */
export function marchToGround(
  ray: THREE.Ray,
  aboveGround: AboveGround,
  options: GroundHitOptions = {},
): GroundHit | null {
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
  // The last loaded sample above the ground (null before the first).
  let lastAbove: number | null = null;
  for (let t = o.startM; ;) {
    const h = above(t);
    if (h !== null) {
      if (h > 0) lastAbove = t;
      // On or under the ground: a crossing if anything loaded was above,
      // else the ray started there, as far as anything loaded shows.
      else if (lastAbove === null) return null;
      else {
        const hit = bisect(lastAbove, t, above, o.bisections);
        return {
          t: hit,
          point: r.at(hit, new THREE.Vector3()),
          samples,
          nulls,
        };
      }
    }
    if (t >= o.maxDistanceM) return null;
    const bound = h === null ? o.stepFraction * t : h * perHeight;
    t = Math.min(o.maxDistanceM, t + Math.max(o.minStepM, bound));
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
): GroundHit | null {
  return marchToGround(ray, terrainAboveGround(terrain), options);
}
