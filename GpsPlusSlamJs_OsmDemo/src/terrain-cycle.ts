/**
 * The terrain cycle: a position in, one heightfield out, coalesced.
 *
 * WHY THIS IS ITS OWN MODULE RATHER THAN A CLOSURE IN `main.ts`. It is the
 * demo's SECOND async action, and it was the only one not coalesced. `refresh`
 * goes through `latestOnly`; the terrain load did not, so the two could disagree
 * about which position is current: `TerrariumProvider` caches decoded tiles, so
 * a second click can resolve from cache while the first is still fetching, and
 * the older load then lands LAST and wins. The result is buildings for the new
 * position standing on the relief of the old one, with a status line confidently
 * reporting the old one's `reliefM`. Nothing about that points at concurrency.
 *
 * Latest-wins rather than a lock, for the same reason `refresh-cycle.ts` gives:
 * refusing a click while a fetch is in flight would make the map feel broken.
 * The intermediate load is what gets dropped, never the user's final intent.
 *
 * WHY IT REPORTS THROUGH A CALLBACK instead of returning the field. The caller
 * has to update four things at once — the heightfield the 3D view stands on, the
 * status-line note, the view's own copy, and the attribution — and they must
 * move together or the screen says one thing while it draws another. One `apply`
 * makes that atomic by construction.
 *
 * @see terrain-cycle.ts.md
 */

import {
  enuFrameAt,
  type ElevationProvider,
  type LatLng,
} from "gps-plus-slam-osm";

import { buildHeightfield, type Heightfield } from "./heightfield.js";
import { latestOnly, type LatestOnly } from "./latest-only.js";

/** Everything one finished load produces, applied as a unit. */
export interface TerrainState {
  /**
   * The loaded relief, or `undefined` when the ground stays FLAT.
   *
   * Never a sea-level field: `hasData: false` rendered as zero height would be
   * a hole shaped exactly like the DEM outage, which reads as terrain rather
   * than as a failure and buries the buildings standing in it.
   */
  readonly field: Heightfield | undefined;
  /** One phrase for the status line, never empty. */
  readonly note: string;
}

export interface TerrainCycleOptions {
  readonly provider: ElevationProvider;
  /** Half-width of the sampled square, metres. */
  readonly extentM: number;
  /** Distance between posts, metres. Match the DEM's own resolution. */
  readonly spacingM: number;
  /** Called once per surviving load, with everything the UI needs. */
  readonly apply: (state: TerrainState) => void;
}

/**
 * The status-line phrase for a finished load.
 *
 * The relief is stated out loud because it is the one number distinguishing
 * "the terrain loaded and this place is flat" from "the terrain did not load" —
 * two very different facts that render identically.
 */
function describe(field: Heightfield): string {
  if (!field.hasData) return "terrain unavailable — ground is flat";
  const missing =
    field.missing > 0
      ? ` (${field.missing}/${field.total} samples missing)`
      : "";
  return `terrain ±${Math.round(field.reliefM)} m${missing}`;
}

/**
 * Builds the coalesced terrain loader.
 *
 * The returned wrapper never rejects — a DEM outage costs the relief, not the
 * 3D view — and `apply` is called exactly once per load that is not superseded.
 */
export function createTerrainCycle(
  options: TerrainCycleOptions,
): LatestOnly<LatLng> {
  const { provider, extentM, spacingM, apply } = options;

  return latestOnly(async (centre: LatLng) => {
    const field = await buildHeightfield(provider, {
      frame: enuFrameAt(centre),
      extentM,
      spacingM,
    });
    apply({
      field: field.hasData ? field : undefined,
      note: describe(field),
    });
  });
}
