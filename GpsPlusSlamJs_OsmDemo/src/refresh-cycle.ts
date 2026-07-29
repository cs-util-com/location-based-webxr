/**
 * The refresh cycle: intent in the store, data out of the pipeline, phases back.
 *
 * WHY THE FAILURE PATH IS SPLIT IN TWO. The old `doRefresh` wrapped three steps
 * in one `try` — fetch-and-score, draw the map, draw the 3D scene — so an
 * Overpass 429 and a lost WebGL context arrived at the same `catch` and got the
 * same treatment: a `Failed: …` status line over whatever was already on screen.
 * Those are not the same event.
 *
 * - A **data** failure means nothing new was produced. Anything still drawn is a
 *   claim nothing supports — that is the stale map that prompted this work, and
 *   it must be cleared.
 * - A **view** failure means the snapshot is fine and the other view drew it
 *   correctly. Blanking that view to report a fault elsewhere destroys good
 *   information for nothing.
 *
 * So the data step lives here and reports `fetchFailed`; each view wraps its own
 * draw in {@link renderSafely} and reports `nonFatalError`. The classification is
 * made where it is actually known, rather than guessed from one `catch`.
 *
 * WHY THE CYCLE TAKES NO ARGUMENTS. Position and category are dispatched intent,
 * and a coalesced run may start long after the click that queued it. Reading
 * them from the store at call time means the run that survives coalescing always
 * fetches for the CURRENT intent — capturing them at call time would let a
 * superseded position win.
 *
 * @see refresh-cycle.ts.md
 */

import type { LatLng } from "gps-plus-slam-osm";

import type { DemoSnapshot } from "./demo-pipeline.js";
import { latestOnly, type LatestOnly } from "./latest-only.js";
import { selectOsmView, type DemoStore } from "./osm-store.js";

/** The part of `DemoPipeline` this needs; narrowed so tests can fake it. */
export interface RefreshPipeline {
  update(position: LatLng, category: string): Promise<DemoSnapshot>;
}

/** The store handles the cycle writes through. */
export interface StoreAccess {
  readonly store: DemoStore["store"];
  readonly actions: DemoStore["actions"];
}

export interface RefreshCycleOptions extends StoreAccess {
  readonly pipeline: RefreshPipeline;
}

/** `Error` messages when we have one, the value's text when we do not. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the demo's one async action: fetch, score, publish.
 *
 * Coalesced through `latestOnly` because the map stays clickable across an 18 s
 * fetch and two overlapping runs would drive one `AffordanceIndex` concurrently,
 * letting the EARLIER one write the final state. Latest-wins rather than a lock:
 * an 18 s dead zone after every click would break the demo's only interaction.
 */
export function createRefreshCycle(
  options: RefreshCycleOptions,
): LatestOnly<void> {
  const { store, actions, pipeline } = options;

  return latestOnly(async () => {
    const { position, category } = selectOsmView(store.getState());
    store.dispatch(
      actions.fetchStarted(
        `Fetching and scoring around ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}…`,
      ),
    );

    try {
      const snapshot = await pipeline.update(position, category);
      store.dispatch(actions.snapshotReady(snapshot));
    } catch (error) {
      store.dispatch(actions.fetchFailed(messageOf(error)));
    }
  });
}

/**
 * Runs one view's draw, reporting a failure without discarding the snapshot.
 *
 * `label` names the view in the message, because "the 3D view failed" and "the
 * map failed" send a reader to different files and the raw exception rarely
 * says which one it came from.
 *
 * Also the reason a throwing view cannot break the others: store subscribers run
 * inside `dispatch`, so an exception escaping one would propagate out of the
 * dispatch that fed them all and skip every later subscriber — turning one
 * broken pane into a blank app.
 */
export function renderSafely(
  access: StoreAccess,
  label: string,
  draw: () => void,
): void {
  try {
    draw();
  } catch (error) {
    access.store.dispatch(
      access.actions.nonFatalError(`${label}: ${messageOf(error)}`),
    );
  }
}
