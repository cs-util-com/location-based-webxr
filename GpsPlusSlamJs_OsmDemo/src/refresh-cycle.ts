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
import { isLayerEnabled } from "./layers.js";
import { nextAnchor, type AnchorDecision } from "./scene-anchor.js";
import { selectLayers, selectOsmView, type DemoStore } from "./osm-store.js";
import type { MeshUpdate, UpdateResult } from "./worker/protocol.js";

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
      /**
       * Where the scene's ENU frame is anchored — see `scene-anchor.ts`.
       *
       * Separate from `position`, which still says what to fetch and clip to.
       * Without this the frame follows the user and every vertex moves when
       * they do, which no AR content can live with.
       */
      frameOrigin: { lat: number; lng: number };
      category: string;
      radius: number;
      /** Round 10, stage B -- see the call site. */
      includeCells: boolean;
      /** The underground diagnostic layer, same rule. */
      includeUnderground: boolean;
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

/**
 * Whether a snapshot of this radius is the LAST one a refresh will publish (F42).
 *
 * EXPORTED FROM HERE, next to the list that defines "last". The cycle publishes
 * once per ring and `snapshotReady` sets `loading: idle` every time, so without
 * this the app announced a final-looking answer three times: a user watched the
 * cell, region and triangle counts settle and then silently change twice, and
 * the e2e helper could only infer the end of widening from the status line
 * holding still — which worker contention defeats, so one run scored 845 cells
 * where another scored 1692 from the same fixture.
 *
 * `>=` rather than `===`, deliberately. A radius the cycle never scores must not
 * leave the UI claiming "still widening" forever; erring towards finished makes
 * an unexpected value a cosmetic bug instead of a permanent spinner.
 */
export function isFinalRing(radius: number): boolean {
  return radius >= (PROGRESSIVE_RADII.at(-1) ?? SCORE_DISK_MAX_RADIUS);
}

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
  readonly onMesh: (mesh: MeshUpdate) => void;
  /**
   * Where the scene is anchored, whenever that is decided.
   *
   * The anchor is computed HERE, on the page, and merely sent to the worker —
   * so the page is its source rather than a copy of it. That is what lets the
   * camera pivot on the user without a worker round-trip: position comes from
   * the store, the anchor comes from here, and the ENU conversion is a pure
   * function of the two.
   */
  readonly onAnchor?: (origin: { lat: number; lng: number }) => void;
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
  const { store, actions, worker, onMesh, onAnchor } = options;

  // THE SCENE ANCHOR IS HELD ACROSS RUNS, which is the whole point: the ENU
  // frame belongs to the scene, not to the current position. It moves only on a
  // declared place change or past REANCHOR_THRESHOLD_M — see `scene-anchor.ts`.
  let anchor: AnchorDecision | undefined;

  return latestOnly(async (_input, signal) => {
    const { position, category } = selectOsmView(store.getState());
    anchor = nextAnchor(anchor?.origin, position);
    onAnchor?.(anchor.origin);
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
      // THE MESH IS BUILT ONCE PER CLICK (W6), not once per pass. Only the
      // region slabs change with the radius; the buildings, trees, POI markers,
      // roads and plates depend on the features, the terrain and the ENU frame
      // origin, none of which a widening ring touches. The worker decides which
      // kind of reply to send and the callback merges it — see `MeshUpdate`.
      // This was recorded here as a known cost for one round.
      for (const radius of PROGRESSIVE_RADII) {
        // THE CELL ARRAY ONLY TRAVELS IF SOMETHING DRAWS IT (round 10, stage B).
        // Read per ring rather than captured once, so toggling the layer
        // mid-widening takes effect on the next ring instead of being decided by
        // whatever was true when the click landed.
        const includeCells = isLayerEnabled(
          selectLayers(store.getState()),
          "cells",
        );
        // Read per ring for the same reason `includeCells` is: intent belongs to
        // the moment it is used, not to the moment the run was queued.
        const includeUnderground = isLayerEnabled(
          selectLayers(store.getState()),
          "underground",
        );
        const { snapshot, mesh } = await worker.call(
          "update",
          {
            position,
            frameOrigin: anchor.origin,
            category,
            radius,
            includeCells,
            includeUnderground,
          },
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
      // A SUPERSEDED RUN IS NOT A FAILURE, and treating it as one was the
      // reported "the scene resets" bug (finding R3-5).
      //
      // A newer click or a category change aborts the run in flight
      // (`latest-only.ts`), the RPC rejects with `RpcAbortError`
      // (`worker/rpc-client.ts`), and this `catch` used to hand that to
      // `fetchFailed` — which clears the snapshot, the selected cell and the
      // selected feature by design, because a DATA failure means nothing new was
      // produced and anything still drawn is unsupported. None of that is true
      // of an abort: the data is fine, a newer run is already queued, and the
      // only thing that happened is that this one stopped early.
      //
      // Both views are snapshot subscribers, so the dispatch blanked the map and
      // the 3D scene and closed the details panel — on nearly every second
      // click, because three progressive rings over a 2.8 km mesh build leave a
      // wide window in which to be superseded.
      //
      // KEYED ON `signal.aborted`, NOT ON THE ERROR TYPE. Only this demo's own
      // coalescing aborts these calls, so the signal is the authoritative fact;
      // matching `RpcAbortError` would need an import across the worker boundary
      // and would still miss an abort that surfaces as some other error on the
      // way out (the worker's own `DOMException("Aborted")`, for one).
      //
      // The two guards further up do NOT cover this: they check the signal after
      // an await RESOLVES, and an aborted call rejects instead.
      if (signal.aborted) return;
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
