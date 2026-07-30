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
 * WHAT CHANGED WITH THE WORKER. The sampling itself moved (~55 000 posts once the
 * terrain covers the rendered extent), so this file is now the coalescing wrapper
 * around an RPC call rather than around the sampler. The coalescing is still
 * needed for exactly the reason above — the worker's tile cache makes a second
 * request resolve faster than the first just as readily as the provider's did.
 *
 * @see terrain-cycle.ts.md
 */

import { type LatLng } from "gps-plus-slam-osm";

import type { HeightfieldData } from "./heightfield.js";
import { latestOnly, type LatestOnly } from "./latest-only.js";
import type { TerrainResult } from "./worker/protocol.js";

/** Everything one finished load produces, applied as a unit. */
export interface TerrainState {
  /**
   * The loaded relief as PLAIN DATA, or `undefined` when the ground stays FLAT.
   *
   * Never a sea-level field: `hasData: false` rendered as zero height would be
   * a hole shaped exactly like the DEM outage, which reads as terrain rather
   * than as a failure and buries the buildings standing in it.
   *
   * `HeightfieldData`, not `Heightfield`: this arrives from the worker, and
   * `heightAt` is a method that structured clone drops **silently** — leaving an
   * object that looks right until the first call. The caller rebuilds the sampler
   * with `heightfieldFrom`.
   */
  readonly field: HeightfieldData | undefined;
  /** One phrase for the status line, never empty. */
  readonly note: string;
}

/** Narrowed so `terrain-cycle.test.ts` can drive this without a worker. */
interface TerrainWorker {
  call(
    kind: "terrain",
    payload: { centre: LatLng; extentM: number; spacingM: number },
    options: { signal: AbortSignal },
  ): Promise<TerrainResult>;
}

export interface TerrainCycleOptions {
  readonly worker: TerrainWorker;
  /** Half-width of the sampled square, metres. */
  readonly extentM: number;
  /** Distance between posts, metres. Match the DEM's own resolution. */
  readonly spacingM: number;
  /** Called once per surviving load, with everything the UI needs. */
  readonly apply: (state: TerrainState) => void;
}

/**
 * Builds the coalesced terrain loader.
 *
 * The returned wrapper never rejects — a DEM outage costs the relief, not the
 * 3D view — and `apply` is called exactly once per load that is not superseded.
 *
 * THE STATUS PHRASE IS BUILT IN THE WORKER (`demo-worker.ts`), beside the posts
 * it describes. Deriving it here instead would be a second place that could
 * describe a field it did not compute — and the number's whole job is to
 * distinguish "this ground is flat" from "the DEM did not load", which is exactly
 * the claim that must not be made by something holding stale data.
 */
export function createTerrainCycle(
  options: TerrainCycleOptions,
): LatestOnly<LatLng> {
  const { worker, extentM, spacingM, apply } = options;

  return latestOnly(async (centre: LatLng, signal) => {
    apply(
      await worker.call("terrain", { centre, extentM, spacingM }, { signal }),
    );
  });
}
