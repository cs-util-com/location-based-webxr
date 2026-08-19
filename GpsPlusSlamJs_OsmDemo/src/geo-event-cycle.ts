/**
 * The geo-event cycle: a press in, an event out, and a republish behind it.
 *
 * WHY IT IS A MODULE RATHER THAN A CLOSURE IN `main.ts`. Same reason
 * `explain-cycle.ts` gives, and it applies harder here: this is the demo's
 * longest action (5–10 s with the OSM data already cached), it has a busy state,
 * a terminal label, a failure path and a follow-up refresh, and none of the four
 * was covered while it lived in the app shell — which cannot be unit-tested at
 * all. `refresh-cycle.ts`, `terrain-cycle.ts` and `explain-cycle.ts` are the
 * established pattern.
 *
 * WHY IT REPUBLISHES (W1, and the whole of G6/G7). `DemoPipeline.geoEvent` has
 * two lasting effects on worker state: it scores the cells around every
 * candidate, and it adds the tiles it had to fetch to `loaded`. Both would be
 * carried by the NEXT snapshot — but the RPC returns only the `GeoEvent` and
 * nothing asked for a next snapshot, so the probed cells never appeared on the
 * map and the red fetch rectangles never grew. A winner sitting outside them was
 * the reported symptom, and it was the honest picture of a stale overlay.
 *
 * WHY THE REPUBLISH IS THE FULL REFRESH (DEC-W1a). A single `update` at the
 * widest radius would be about a third of the work, but it would be a SECOND
 * publish path: `refresh-cycle.ts` dispatches `fetchStarted`, orders the mesh
 * before the snapshot so the 3D view never draws new cells over an old city, and
 * is `latestOnly` so a superseded run cannot land after the run that replaced
 * it. Duplicating three rules to save ~1.9 s on an action that just spent five
 * seconds is the wrong trade.
 *
 * WHY A FAILURE IS NOT `fetchFailed` (DEC-W2a). It used to be, "so a geo-event
 * failure is as visible as a fetch failure" — but `fetchFailed` clears the
 * snapshot and all three selections, so a transient Overpass error during a Find
 * blanked a map that was still entirely correct. A failed search says nothing
 * about whether the data on screen is good, which is exactly the split
 * `nonFatalError` exists for. Same reasoning as the locate control's refused
 * permission, one file over.
 *
 * WHY A STALE ANSWER IS DROPPED. The search is long enough to change the
 * category picker twice over, and the event was computed against the old
 * category's scores and its threshold. Drawing it over the new category's map is
 * the cross-view disagreement the store was introduced to make impossible — and
 * once a category change clears the markers (W2), a late arrival would silently
 * put them back.
 *
 * @see geo-event-cycle.ts.md
 */

import type { GeoEvent, LatLng } from "gps-plus-slam-osm";

import type { GeoEventStats } from "./geo-event-stats.js";
import { selectOsmView, type DemoStore } from "./osm-store.js";

/** The part of the worker client this needs; narrowed so tests can fake it. */
interface GeoEventWorker {
  call(
    kind: "geoEvent",
    payload: {
      position: LatLng;
      category: string;
      now: number;
      overlapMinutes?: number;
    },
  ): Promise<{ event: GeoEvent; stats: GeoEventStats }>;
}

export interface GeoEventCycleOptions {
  readonly store: DemoStore["store"];
  readonly actions: DemoStore["actions"];
  readonly worker: GeoEventWorker;
  /**
   * Reflects the search's in-progress state — the ONE thing here that is not
   * store state, because "a request is in flight" is a property of this cycle
   * rather than of the data, and putting it in the store would make it
   * persistable and inspectable for no gain.
   */
  readonly setBusy: (busy: boolean) => void;
  /**
   * Publishes a fresh snapshot, so the cells and tiles the search produced
   * reach the store like any other work. See the module header for why this is
   * the full refresh rather than a single `update`.
   */
  readonly republish: () => Promise<void>;
  /** The clock, for a search with no explicitly requested time. */
  readonly now?: () => number;
  /**
   * Reports what the search cost (W7). Optional, because nothing depends on it.
   *
   * A CALLBACK RATHER THAN STORE STATE. The counters describe one run of an
   * algorithm, not something any view draws — putting them in the store would
   * make them persistable, devtools-serialised and subject to the reducer rules,
   * for a diagnostic line.
   */
  readonly onStats?: (stats: GeoEventStats) => void;
  /**
   * Called with a quest the search actually produced.
   *
   * WHY A CALLBACK AND NOT A STORE SUBSCRIPTION. The two things it drives —
   * announcing the result in a toast, and panning the map to the winner — are
   * responses to THIS PRESS, not properties of the current state. A subscriber
   * on `view.geoEvent` would also fire when the same event is republished by a
   * refresh, panning the map out from under someone who did not ask.
   *
   * Not called when the search fails: the previous quest deliberately stays
   * published, and announcing it again would report a stale result as new.
   */
  readonly onFound?: (event: GeoEvent) => void;
}

/** `Error` messages when we have one, the value's text when we do not. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the geo-event action.
 *
 * The returned function never rejects. Its caller is a DOM listener, so a
 * rejection would be unhandled — and the failure has already been reported
 * through the store by the time it would have propagated.
 */
export function createGeoEventCycle(
  options: GeoEventCycleOptions,
): (requested?: number) => Promise<void> {
  const {
    store,
    actions,
    worker,
    setBusy,
    republish,
    now = () => Date.now(),
    onStats,
    onFound,
  } = options;

  return async (requested?: number): Promise<void> => {
    // Captured at DISPATCH time. The position is what the label's distance and
    // bearing are measured from, so reading it again on arrival would describe
    // the answer from wherever the user ended up rather than from where they
    // asked.
    const { position, category } = selectOsmView(store.getState());

    let event: GeoEvent | undefined;
    setBusy(true);
    try {
      const answer = await worker.call("geoEvent", {
        position,
        category,
        now: requested ?? now(),
        // ZERO FOR AN EXPLICIT PICK, the production default otherwise. The
        // overlap window means "I am arriving now, do not send me to a spawn
        // about to move", and it is applied before the rounding — so leaving it
        // at five would answer "show me 18:00" with the 18:15 slot. See
        // `nextEventTime`'s docstring, which used to claim otherwise.
        ...(requested === undefined ? {} : { overlapMinutes: 0 }),
      });
      event = answer.event;
      onStats?.(answer.stats);
      if (event !== undefined) onFound?.(event);
    } catch (error) {
      // The PREVIOUS event deliberately stays published. A search that failed
      // says nothing about the one already on the map, and taking it down would
      // make a transient Overpass error look like an expiry.
      store.dispatch(
        actions.nonFatalError(`geo-event failed: ${messageOf(error)}`),
      );
    } finally {
      // THE BUSY STATE ENDS WITH THE RPC, NOT WITH THE REPUBLISH, and the
      // ordering is the reason this is its own `try`. The label is derived, so
      // while `busy` is true it reads "Finding…" — holding that across the
      // ~1.9 s refresh would show it over markers that are already drawn, which
      // is the opposite of what F56's label is for. The refresh announces
      // itself through `fetchStarted` and the status line instead.
      setBusy(false);
    }

    if (event === undefined) return;

    if (selectOsmView(store.getState()).category !== category) {
      // Superseded. `categoryChanged` already cleared the field, and publishing
      // now would silently refill it with the old category's answer — the
      // stale-overlay bug arriving by a later route.
      return;
    }

    // PUBLISHED, not drawn. Every view that shows a geo-event reads it from
    // here, so there is one place it can be cleared from and one thing to keep
    // in step. An empty `picks` is published too: "no event nearby" is a result,
    // and it is what takes the previous search's markers down.
    store.dispatch(actions.geoEventFound(event));

    // ITS OWN CATCH, and the wording is the reason. `refresh` is `latestOnly`,
    // which never rejects, so this is unreachable with the real wiring — but
    // folding it into the search's handler would let a refresh fault report
    // "geo-event failed" for a search whose result is plainly on the map.
    try {
      await republish();
    } catch (error) {
      store.dispatch(
        actions.nonFatalError(
          `geo-event republish failed: ${messageOf(error)}`,
        ),
      );
    }
  };
}
