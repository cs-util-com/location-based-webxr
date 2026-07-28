/**
 * Orthometric ↔ ellipsoidal height conversion.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE MOST DANGEROUS FILE IN THE PACKAGE.
 *
 * DEMs report **orthometric** height — above the geoid, i.e. mean sea level.
 * GNSS and the AR session work in **ellipsoidal** height, above the WGS84
 * ellipsoid. The two differ by the geoid undulation `N`:
 *
 *     ellipsoidal = orthometric + N
 *
 * `N` reaches ±100 m globally and is around **+45 m in central Europe**. Get it
 * wrong and every elevation is consistently tens of metres out — which does not
 * look like a bug in this file. It looks like a bug in the GPS+SLAM fusion,
 * which is a much more expensive place to go looking. That is why this is in
 * `lessons-learned.md` on day one rather than after someone loses a week.
 *
 * WHAT IS AND IS NOT SHIPPED HERE, and the reasoning is deliberately explicit
 * because the omission is the interesting part:
 *
 * The C# reference computes `N` properly, by evaluating the EGM96 spherical
 * harmonic series to degree 360 — which needs a **5 MB coefficient table**
 * (`Algorithms/AltitudeCalculation/Coef.cs`). That is a completely reasonable
 * thing to do in a desktop/Unity build and a completely unreasonable thing to
 * ship in a browser package whose entire dependency budget is one peer.
 *
 * **A verified 1-degree grid now ships as an opt-in import** — see
 * `egm96.ts`, and note what changed: the original objection was never "a grid
 * is a bad idea", it was "we must not ship numbers we cannot verify", because a
 * plausible wrong geoid is a confident, smooth, entirely wrong vertical offset
 * that no test would catch and that presents as a fusion bug. That is answered
 * by generating the grid with the reference evaluator and pinning it against
 * exact evaluations — not by waiving the concern. It lives behind its own entry
 * point (~170 KB) so an app that does not need absolute heights never pays.
 *
 * The model is still **injected**, and four are provided —
 *
 * - `egm96Geoid()` from `./egm96.js` — correct anywhere on Earth, mean 0.25 m.
 *
 * - `constantGeoid(n)` — the practical answer for an app operating in one
 *   region. Look `N` up once for your area (NGA's EGM96 calculator, or the C#
 *   `GeoidHeights.undulation`) and pass it. Wrong by centimetres over a city,
 *   which is far below the DEM's own ~30 m posting.
 * - `gridGeoid(grid)` — bilinear interpolation over a supplied undulation grid,
 *   for an app that has one.
 * - `ZERO_GEOID` — the identity, and the default, because a library must not
 *   silently apply a made-up correction. It is documented as introducing a
 *   systematic offset, and `describeGeoid` exists so an app can SHOW which
 *   model is in use rather than discovering it in the field.
 *
 * @see geoid.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";

export interface GeoidModel {
  /** Human-readable identity, so an app can display which model is active. */
  readonly id: string;
  /** Geoid undulation `N` in metres at a position. */
  undulationMetres(position: LatLng): number;
}

/**
 * The identity model: `N = 0` everywhere.
 *
 * **This is wrong everywhere on Earth**, by up to ~100 m and by ~45 m in
 * central Europe. It is the default only because the alternative — a library
 * quietly applying an unverifiable correction — is worse. An app that cares
 * about absolute height MUST replace it.
 */
export const ZERO_GEOID: GeoidModel = {
  id: "zero (NO geoid correction applied)",
  undulationMetres: () => 0,
};

/**
 * A single undulation value for the whole area of operation.
 *
 * The right answer for almost every app this library serves. `N` varies by
 * roughly 1 m per 100 km in mid-latitudes, so one value is accurate to
 * centimetres across a city — two orders of magnitude below the ~30 m posting
 * of the DEM being corrected.
 */
export function constantGeoid(undulationMetres: number): GeoidModel {
  if (!Number.isFinite(undulationMetres)) {
    throw new TypeError(
      `constantGeoid needs a finite undulation, got ${undulationMetres}`,
    );
  }
  return {
    id: `constant(${undulationMetres} m)`,
    undulationMetres: () => undulationMetres,
  };
}

/** A regular lat/lng grid of undulation values, row-major from the north-west. */
export interface UndulationGrid {
  readonly id: string;
  /** Degrees between samples. */
  readonly stepDeg: number;
  /** Latitude of row 0. */
  readonly northLat: number;
  /** Longitude of column 0. */
  readonly westLng: number;
  readonly rows: number;
  readonly cols: number;
  /** `rows × cols` undulation values in metres. */
  readonly values: ArrayLike<number>;
}

/**
 * Bilinear interpolation over a supplied undulation grid.
 *
 * Validates the grid at construction rather than per lookup: a grid whose
 * `values` length disagrees with `rows × cols` would otherwise read zeros off
 * the end and produce a smoothly wrong field, which is the failure mode this
 * whole file is organised around.
 *
 * Longitude wraps; latitude clamps. A grid covering the globe therefore behaves
 * correctly across the antimeridian, and a regional grid degrades to its edge
 * value rather than to NaN.
 */
export function gridGeoid(grid: UndulationGrid): GeoidModel {
  if (grid.rows < 2 || grid.cols < 2) {
    throw new TypeError("undulation grid needs at least 2 rows and 2 columns");
  }
  if (grid.values.length !== grid.rows * grid.cols) {
    throw new TypeError(
      `undulation grid has ${grid.values.length} values but ${grid.rows}×${grid.cols} = ${grid.rows * grid.cols} cells`,
    );
  }
  if (!(grid.stepDeg > 0)) {
    throw new TypeError(
      `undulation grid needs a positive step, got ${grid.stepDeg}`,
    );
  }

  const at = (row: number, col: number): number => {
    const r = Math.min(grid.rows - 1, Math.max(0, row));
    const c = ((col % grid.cols) + grid.cols) % grid.cols;
    return grid.values[r * grid.cols + c] ?? 0;
  };

  return {
    id: grid.id,
    undulationMetres(position) {
      const y = (grid.northLat - position.lat) / grid.stepDeg;
      const x = (position.lng - grid.westLng) / grid.stepDeg;
      const y0 = Math.floor(y);
      const x0 = Math.floor(x);
      const fy = y - y0;
      const fx = x - x0;

      const top = at(y0, x0) * (1 - fx) + at(y0, x0 + 1) * fx;
      const bottom = at(y0 + 1, x0) * (1 - fx) + at(y0 + 1, x0 + 1) * fx;
      return top * (1 - fy) + bottom * fy;
    },
  };
}

/** Orthometric (DEM) → ellipsoidal (GNSS, AR session). */
export function toEllipsoidal(
  orthometricMetres: number,
  position: LatLng,
  geoid: GeoidModel,
): number {
  return orthometricMetres + geoid.undulationMetres(position);
}

/** Ellipsoidal (GNSS, AR session) → orthometric (DEM). */
export function toOrthometric(
  ellipsoidalMetres: number,
  position: LatLng,
  geoid: GeoidModel,
): number {
  return ellipsoidalMetres - geoid.undulationMetres(position);
}

/**
 * A one-line description of the active model, for a UI or a log.
 *
 * Exists because the dangerous state — `ZERO_GEOID` still in place in a build
 * that renders absolute heights — is invisible by construction. Something has
 * to be able to say it out loud.
 */
export function describeGeoid(geoid: GeoidModel): string {
  return geoid === ZERO_GEOID
    ? `${geoid.id} — heights are ellipsoidal-relative and may be tens of metres off`
    : geoid.id;
}
