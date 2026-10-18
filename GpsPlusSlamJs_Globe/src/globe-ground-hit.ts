/**
 * The ground under a ray, from the relief's SAMPLED heights (tour editor
 * plan 2026-10-17-1816 §13, "Picking and dragging"; G0 spikes Q2): a march
 * along the ray, each step one height sample, then bisection on the step
 * where the ray goes from above the ground to below it. 10-20 times
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
  /** How far along the ray the march looks (m); the spike's 5 km. */
  maxDistanceM: 5_000,
  /** The least step (m)... */
  minStepM: 1,
  /** ...growing with the distance, as a fraction of it (2 %). */
  stepFraction: 0.02,
  /** Halvings of the crossing's step: 1 m to 0.06 micrometres. */
  bisections: 24,
});

export interface GroundHitOptions {
  /** Where along the ray the march starts (m, >= 0; 0 = the origin). */
  readonly startM?: number;
  readonly maxDistanceM?: number;
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

/** The options with their defaults, each checked (RangeError). */
function checked(options: GroundHitOptions) {
  const o = {
    startM: options.startM ?? 0,
    maxDistanceM: options.maxDistanceM ?? GROUND_HIT.maxDistanceM,
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
    finiteAtLeast(o.minStepM, 0) && o.minStepM > 0,
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
 * `aboveGround`: marched in steps of max(`minStepM`, `stepFraction` x the
 * distance), then bisected. A step with an unloaded end is skipped (a null
 * never brackets a crossing). Null when the ray stays above the ground
 * within `maxDistanceM`, starts below it, or finds nothing loaded. A
 * ridge thinner than a step can be stepped over (2 m at 100 m). RangeError
 * for a zero direction or an option out of range.
 */
export function marchToGround(
  ray: THREE.Ray,
  aboveGround: AboveGround,
  options: GroundHitOptions = {},
): GroundHit | null {
  const o = checked(options);
  const r = unitRay(ray);
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
  let t = o.startM;
  let a = above(t);
  // A ray that starts on or under the ground has no crossing to find.
  if (a !== null && a <= 0) return null;
  while (t < o.maxDistanceM) {
    const next = Math.min(
      o.maxDistanceM,
      t + Math.max(o.minStepM, o.stepFraction * t),
    );
    const b = above(next);
    if (a !== null && a > 0 && b !== null && b <= 0) {
      const hit = bisect(t, next, above, o.bisections);
      return { t: hit, point: r.at(hit, new THREE.Vector3()), samples, nulls };
    }
    t = next;
    a = b;
  }
  return null;
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
