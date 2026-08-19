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

import { type FallbackProviderStats, type LatLng } from "gps-plus-slam-osm";

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
  /**
   * Which DEM composition sampled `field` — the worker provider's `sourceId`.
   *
   * Applied atomically with the field for the same reason the note is: a
   * label that arrived on its own could describe a provider the current
   * field was never sampled through.
   */
  readonly demSourceId: string;
  /**
   * Which member of the composition served, as position counts — the worker's
   * snapshot of the provider's cumulative stats at this load.
   *
   * Applied atomically with the field and the source id, and for the same
   * reason: the HUD's "which DEM actually served" suffix must describe the
   * field on screen, never a snapshot from another load. Absent when the
   * worker did not report one; the HUD then shows the composed id alone.
   */
  readonly demStats?: FallbackProviderStats | undefined;
  /**
   * The worker's verdict that this field arrived too late for the mesh already
   * drawn, so a refresh is warranted (F1d).
   *
   * The caller decides whether to act: `main.ts` declines while a refresh is
   * already running, because `refresh` is `latestOnly` and would abort it. See
   * `worker/terrain-arrival.ts`.
   */
  readonly meshOutdated?: boolean | undefined;
  /**
   * Where the window was sampled, in the scene's frame — even on failure.
   *
   * Carried separately from `field` precisely because `field` is `undefined`
   * during a DEM outage. The ground plane follows this centre, and the plane is
   * finite: leaving it behind during an outage means a user who walks past its
   * extent has no ground under them at all.
   */
  readonly centreEnu: { readonly x: number; readonly y: number };
}

/** Narrowed so `terrain-cycle.test.ts` can drive this without a worker. */
interface TerrainWorker {
  call(
    kind: "terrain",
    payload: {
      centre: LatLng;
      frameOrigin: LatLng;
      extentM: number;
      spacingM: number;
    },
    options: { signal: AbortSignal },
  ): Promise<TerrainResult>;
}

/**
 * One load's inputs: where the user is, and what the numbers will mean.
 *
 * TWO VALUES, NOT ONE, and that is the whole of round 5B's first half. They were
 * a single `centre` while the frame followed the user, so nothing could
 * disagree; once the scene got a fixed anchor the heightfield kept being sampled
 * in the user's frame while the buildings standing on it moved to the scene's,
 * and the ground slid under the city by the step distance on every step.
 */
export interface TerrainLoad {
  /** Where the user is — what the window is for. */
  readonly centre: LatLng;
  /** Where the scene's ENU frame is anchored — what the heights mean. */
  readonly frameOrigin: LatLng;
  /**
   * Geoid undulation N at the frame origin, metres. AR mode only.
   *
   * PRESENT means "give me absolute heights against the ellipsoid"; absent
   * means the desktop behaviour, relief against the window centre. AR cannot
   * use the default because the window follows the user, so that datum moves
   * mid-session and takes the scene Y baseline with it.
   */
  readonly geoidUndulationM?: number;
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
): LatestOnly<TerrainLoad> {
  const { worker, extentM, spacingM, apply } = options;

  return latestOnly(async (load: TerrainLoad, signal) => {
    const state = await worker.call(
      "terrain",
      {
        centre: load.centre,
        // SENT SEPARATELY, and it must be the anchor this position will actually
        // be drawn in — not the one held before the position change was handled.
        // See `scene-anchor.ts`'s holder for why that distinction has teeth.
        frameOrigin: load.frameOrigin,
        extentM,
        spacingM,
        ...(load.geoidUndulationM === undefined
          ? {}
          : { geoidUndulationM: load.geoidUndulationM }),
      },
      { signal },
    );
    // NOTHING IS APPLIED FOR A SUPERSEDED LOAD — the same guard `refresh-cycle.ts`
    // carries, and it matters more here. Usually the abort rejects the call before
    // it resolves; but if the reply has ALREADY landed when the newer position
    // arrives, the cancellation has nothing left to cancel and this continuation
    // runs anyway. `apply` would then hand the UI the superseded centre's field —
    // the 3D view's buildings on one position's relief with the status line
    // reporting the other's, which is by name the interleaving this whole module
    // exists to prevent.
    //
    // Missed when the sampling moved behind the RPC, and found in review rather
    // than by a test: the guard's sibling had the same hole.
    if (signal.aborted) return;
    apply(state);
  });
}
