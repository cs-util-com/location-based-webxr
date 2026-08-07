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

import { describeGeoEvent } from "./event-label.js";
import { selectOsmView, type DemoStore } from "./osm-store.js";

/** The button's resting label. Matches `index.html`, which renders it first. */
export const GEO_EVENT_IDLE_LABEL = "Next geo-event";

/** The button's in-progress label. */
export const GEO_EVENT_BUSY_LABEL = "Finding…";

/** The part of the worker client this needs; narrowed so tests can fake it. */
interface GeoEventWorker {
  call(
    kind: "geoEvent",
    payload: { position: LatLng; category: string; now: number },
  ): Promise<GeoEvent>;
}

export interface GeoEventCycleOptions {
  readonly store: DemoStore["store"];
  readonly actions: DemoStore["actions"];
  readonly worker: GeoEventWorker;
  /** Draws an event, or clears the layer when given `undefined`. */
  readonly render: (event: GeoEvent | undefined) => void;
  /** Sets the button's label. The cycle owns all three of its states. */
  readonly setLabel: (label: string) => void;
  /** Disables the button while a search is running. */
  readonly setBusy: (busy: boolean) => void;
  /**
   * Publishes a fresh snapshot, so the cells and tiles the search produced
   * reach the store like any other work. See the module header for why this is
   * the full refresh rather than a single `update`.
   */
  readonly republish: () => Promise<void>;
  /**
   * The clock. Injectable so a test can pin the requested instant, and so W6's
   * picker can hand over a chosen one instead of "now".
   */
  readonly now?: () => number;
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
): () => Promise<void> {
  const {
    store,
    actions,
    worker,
    render,
    setLabel,
    setBusy,
    republish,
    now = () => Date.now(),
  } = options;

  return async (): Promise<void> => {
    // Captured at DISPATCH time. The position is what the label's distance and
    // bearing are measured from, so reading it again on arrival would describe
    // the answer from wherever the user ended up rather than from where they
    // asked.
    const { position, category } = selectOsmView(store.getState());

    setBusy(true);
    setLabel(GEO_EVENT_BUSY_LABEL);
    try {
      let event: GeoEvent;
      try {
        event = await worker.call("geoEvent", {
          position,
          category,
          now: now(),
        });
      } catch (error) {
        store.dispatch(
          actions.nonFatalError(`geo-event failed: ${messageOf(error)}`),
        );
        setLabel(GEO_EVENT_IDLE_LABEL);
        return;
      }

      if (selectOsmView(store.getState()).category !== category) {
        // Superseded. The label goes back to resting rather than staying on
        // "Finding…", which would claim a search is still running.
        setLabel(GEO_EVENT_IDLE_LABEL);
        return;
      }

      render(event);
      // The distance and direction are not decoration (F56): the winner is very
      // often outside the viewport — an event tile is ~900 m across and the demo
      // opens at zoom 18 — so without them a successful search looks exactly
      // like nothing happening.
      setLabel(describeGeoEvent(position, event));

      // AFTER the render and the label, not before: those two are what the user
      // pressed the button for, and the refresh is ~1.9 s of work behind them.
      //
      // ITS OWN CATCH, and the wording is the reason. `refresh` is `latestOnly`,
      // which never rejects, so this is unreachable with the real wiring — but
      // folding it into the search's handler would let a refresh fault report
      // "geo-event failed" for a search that plainly succeeded, and the label
      // would snap back to resting over a result that is on the map.
      try {
        await republish();
      } catch (error) {
        store.dispatch(
          actions.nonFatalError(
            `geo-event republish failed: ${messageOf(error)}`,
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  };
}
