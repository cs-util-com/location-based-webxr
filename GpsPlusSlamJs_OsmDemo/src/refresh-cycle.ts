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

import { SCORE_DISK_MAX_RADIUS, SCORE_DISK_RADIUS } from "gps-plus-slam-osm";

import { latestOnly, type LatestOnly } from "./latest-only.js";
import { selectOsmView, type DemoStore } from "./osm-store.js";
import type { TransferableMesh, UpdateResult } from "./worker/protocol.js";

/**
 * The part of the worker client this needs; narrowed so tests can fake it.
 *
 * Was `RefreshPipeline` with an `update(position, category)` — the pipeline now
 * lives in the worker, so the same call goes over the RPC boundary instead. The
 * narrow shape is what lets `refresh-cycle.test.ts` drive this without a worker.
 */
interface RefreshWorker {
  call(
    kind: "update",
    payload: {
      position: { lat: number; lng: number };
      category: string;
      radius: number;
    },
    options: { signal: AbortSignal },
  ): Promise<UpdateResult>;
}

/**
 * The ring radii one refresh scores, in order (W16, DEC-R2-30).
 *
 * DERIVED, not listed. The two constants are the decision; a hand-written
 * `[2, 3, 4]` would be a third place the radius lives and the one that silently
 * disagrees when either constant moves.
 *
 * The FIRST entry is the full original working set, and that is the requirement
 * rather than an accident of ordering: the user waits for the first answer and
 * for nothing else, so progressive scoring must not make it later. Starting at
 * ring 0 to make the steps uniform would do exactly that.
 */
const PROGRESSIVE_RADII: readonly number[] = Array.from(
  { length: SCORE_DISK_MAX_RADIUS - SCORE_DISK_RADIUS + 1 },
  (_, step) => SCORE_DISK_RADIUS + step,
);

/** The store handles the cycle writes through. */
export interface StoreAccess {
  readonly store: DemoStore["store"];
  readonly actions: DemoStore["actions"];
}

export interface RefreshCycleOptions extends StoreAccess {
  readonly worker: RefreshWorker;
  /**
   * Receives the freshly built mesh, BEFORE the snapshot is dispatched.
   *
   * The mesh cannot live in the store: it is `Float32Array` vertex data, which
   * RTK's serialisability scan rejects and devtools would try to serialise on
   * every action. But the 3D view is a snapshot subscriber, so the mesh has to be
   * in place by the time that subscriber runs — hence "before", and hence a
   * callback rather than a return value.
   */
  readonly onMesh: (mesh: TransferableMesh) => void;
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
  const { store, actions, worker, onMesh } = options;

  return latestOnly(async (_input, signal) => {
    const { position, category } = selectOsmView(store.getState());
    store.dispatch(
      actions.fetchStarted(
        `Fetching and scoring around ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}…`,
      ),
    );

    try {
      // RING BY RING (W16). Each pass widens the scored disk and publishes what
      // it has, so the map fills outward instead of appearing all at once after
      // the widest pass. `AffordanceIndex.update` sorts nearest-first precisely
      // so an interrupted run has done the most useful work first; this is the
      // interruption it was written for.
      //
      // KNOWN COST, recorded rather than hidden: every pass rebuilds the whole
      // mesh, and only the region slabs actually change with the radius — the
      // buildings, trees, roads and plates are identical each time. Splitting the
      // reply so later passes carry only what grew is a real improvement and a
      // follow-up, not a correctness issue; the work is in the worker.
      for (const radius of PROGRESSIVE_RADII) {
        const { snapshot, mesh } = await worker.call(
          "update",
          { position, category, radius },
          { signal },
        );
        // NOTHING IS APPLIED FOR A SUPERSEDED RUN. Normally the abort rejects the
        // call before it resolves, but there is a real race: if the worker's reply
        // has already landed when the newer input arrives, the promise is already
        // settled and the cancellation has nothing left to cancel. Without this
        // guard that snapshot would be dispatched — a visible flash of the previous
        // position before the current one replaces it.
        //
        // It also ENDS THE LOOP, which is the other half of the guarantee: the
        // remaining rings belong to a place the user has left, and scoring them
        // would spend the worker on ground nobody is looking at.
        if (signal.aborted) return;
        // AN ERROR ON SCREEN STOPS THE WIDENING, and this is a defect W16
        // introduced rather than defensive tidiness. Publishing a snapshot
        // returns the loading phase to `idle`, which erases whatever message is
        // showing. With one emission per refresh that window was negligible;
        // with three it spans the whole widening, so an error arriving in the
        // middle of it — a refused geolocation permission was the real case —
        // was wiped off the status line by the next ring, and the demo looked
        // like it had done nothing at all.
        //
        // CHECKED HERE, immediately before publishing, rather than at the top of
        // the pass. An error can arrive while a ring is already in flight, and
        // that ring's own dispatch is then what erases it — a top-of-loop check
        // runs too early to see it.
        //
        // `fetchStarted` clears any earlier error at the top of the run, so an
        // error visible here always belongs to THIS run.
        if (selectOsmView(store.getState()).loading.phase === "error") return;
        // Mesh FIRST, then dispatch. The 3D view draws from a snapshot
        // subscription, so a dispatch before the mesh is in place would draw the
        // new snapshot's cells over the PREVIOUS mesh — one frame of buildings
        // belonging to somewhere else, which is the class of disagreement the
        // store was introduced to make impossible.
        onMesh(mesh);
        store.dispatch(actions.snapshotReady(snapshot));
      }
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
