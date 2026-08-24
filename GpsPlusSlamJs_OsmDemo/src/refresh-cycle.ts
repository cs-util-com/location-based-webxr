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

import { PROGRESSIVE_RADII, SCORE_DISK_MAX_RADIUS } from "gps-plus-slam-osm";

import { latestOnly, type LatestOnly } from "./latest-only.js";
import {
  composeClickSummary,
  composeClickTimings,
  type ClickSummary,
  type ClickTimings,
} from "./click-timings.js";
import { nowMs, nowEpochMs } from "./monotonic-clock.js";
import { isLayerEnabled } from "./layers.js";
import type { AnchorHolder } from "./scene-anchor.js";
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
      /** Epoch ms at post time, so the worker can report its queue wait. */
      postedAtEpochMs: number;
      /**
       * The datum this mesh must stand on — see `protocol.ts`.
       *
       * The mesh build declares it so the worker can tell a matching field from
       * a stale one; AR entry does not move the user, so the position alone
       * cannot distinguish an ellipsoidal field from a window-centre one.
       */
      geoidUndulationM?: number;
    },
    options: { signal: AbortSignal },
  ): Promise<UpdateResult>;
}

// `PROGRESSIVE_RADII` LIVES IN `resolutions.ts` NOW (DEC-K1), beside the two
// constants it derives from — this file only consumes it. `//` on purpose: a
// signpost, not a docstring, so it cannot be read as documenting the function
// below (PR #343 review). The move's full story — the hand-derived copy that
// went quietly wrong, and why the FIRST entry must stay the full working set —
// is told once, on the constant itself.

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
   * Where the scene is anchored — READ, never decided here.
   *
   * This cycle used to own the decision, and that was the bug: a position change
   * drives three consumers (the camera pivot, the terrain load and this), and
   * this one runs LAST. The other two therefore read the outgoing anchor
   * whenever the anchor moved. The holder is advanced once by whoever handles
   * the position change, and everything downstream reads the same value.
   *
   * The page remains the SOURCE of the anchor rather than a copy of it — which
   * is what lets the camera pivot on the user without a worker round-trip.
   */
  readonly anchors: AnchorHolder;
  /**
   * The datum the mesh must stand on, read at post time.
   *
   * A GETTER rather than a value, because it changes with the MODE and this
   * cycle outlives an AR session. Returns the geoid undulation while AR runs
   * and `undefined` on the desktop; `main.ts` owns the single held value so the
   * terrain load and the mesh build cannot state different datums.
   *
   * Omitted behaves exactly as before, which is what keeps the existing tests
   * meaningful rather than merely passing.
   */
  readonly geoidUndulationM?: () => number | undefined;
  /**
   * The nine-stage breakdown for one pass, once it is complete.
   *
   * **A callback rather than a `console.info` here**, for the reason `onMesh`
   * is one: this module is tested without a DOM and without a worker, and a
   * cycle that printed for itself could not be asserted on. `main.ts` wires it
   * to the console, exactly as it does for `GeoEventStats`.
   *
   * Optional so nothing that does not want the numbers has to take them — but
   * the cycle always COMPUTES them, because a breakdown that only exists when
   * someone is watching is a breakdown that is broken when they start.
   */
  readonly onTimings?: (timings: ClickTimings) => void;
  /**
   * The WHOLE CLICK, once its rings have all published.
   *
   * **Separate from `onTimings` because the per-ring lines cannot be summed to
   * it, and the difference is the point.** Each ring's `wallMs` is one worker
   * round trip plus its draw; everything else the cycle does — the
   * `fetchStarted` dispatch and its subscriber renders, the per-ring layer
   * reads, both guards, the gaps between passes, and printing the lines
   * themselves — falls outside every one of them.
   *
   * Worse, the per-ring residual is structurally blind to all of it: the
   * algebra in `click-timings.ts` shows page time CANCELS, leaving only
   * unattributed worker time. So without this clock a page-side stage nobody
   * enumerated could never surface — which is exactly the class of defect this
   * whole instrument was built after missing.
   */
  readonly onClickSummary?: (summary: ClickSummary) => void;
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
  const { store, actions, worker, onMesh, anchors, onTimings, onClickSummary } =
    options;

  return latestOnly(async (_input: void, signal) => {
    const { position, category } = selectOsmView(store.getState());
    // READ, NOT DECIDED. The holder was advanced by whoever handled the position
    // change, before the camera and the terrain load read it — see
    // `scene-anchor.ts` for why that ordering is structural rather than a rule.
    // A refresh with no position change (a category switch, a layer toggle, the
    // initial load) reads the same origin it read last time, which is exactly
    // right: the ENU frame belongs to the scene, not to this call.
    const frameOrigin = anchors.origin;

    // THE CLICK-LEVEL WALL CLOCK, OPENED BEFORE THE DISPATCH (r504 review).
    // It used to open twenty-two lines below, after `fetchStarted` — while
    // three separate places (this file's `onClickSummary` doc, `ClickSummary`
    // in `click-timings.ts`, and `main.ts`) all said `pageResidualMs` covers
    // "the `fetchStarted` dispatch and its subscriber renders".
    //
    // A synchronous store dispatch with subscriber renders behind it is
    // EXACTLY the page-side stage this summary exists to make visible, and it
    // was the one page-side stage the docs named by hand while measuring none
    // of it. Since `pageResidualMs` is the only clock in the instrument that
    // can ever see page time — the per-ring algebra cancels it — an unmeasured
    // page stage here is invisible everywhere.
    const clickStart = nowMs();
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
      const rings: ClickTimings[] = [];
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
        // STAGE 8's ANCHOR. Clocked wholly on THIS side, and paired with the
        // worker's own `workerTotalMs` clocked wholly on that side, so the
        // clone cost is a difference of two durations rather than of two
        // timestamps. A dedicated worker has its own `performance.timeOrigin`,
        // which makes a cross-boundary timestamp subtraction an offset rather
        // than an elapsed time — and every existing timing in this demo is
        // taken inside the worker, so nothing here warned about it.
        const datum = options.geoidUndulationM?.();
        const callStart = nowMs();
        const { snapshot, mesh, workerTimings } = await worker.call(
          "update",
          {
            position,
            frameOrigin,
            category,
            radius,
            includeCells,
            includeUnderground,
            // ON AN ABSOLUTE TIMELINE, so the worker can subtract it from its
            // own reading and get the QUEUE WAIT. That is the one duration
            // neither side can measure alone: the page sees post-to-reply, the
            // worker sees handler-start-to-end, and the gap between them is
            // where a busy worker hides. See `monotonic-clock.ts`.
            postedAtEpochMs: nowEpochMs(),
            // THE DATUM THIS BUILD REQUIRES. Read at post time, not captured at
            // construction: the cycle outlives an AR session and the datum
            // changes with the mode. Spread conditionally because
            // `exactOptionalPropertyTypes` distinguishes absent from undefined,
            // and the protocol means ABSENT by "desktop datum".
            ...(datum === undefined ? {} : { geoidUndulationM: datum }),
          },
          { signal },
        );
        const roundTripMs = Math.max(0, nowMs() - callStart);
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
        // STAGE 9 — the three.js upload and the store dispatch that drives the
        // status line. Clocked around BOTH, because the ordering constraint
        // above means they are one indivisible step from the user's point of
        // view: the frame the user sees is the one after this pair.
        const drawStart = nowMs();
        onMesh(mesh);
        store.dispatch(actions.snapshotReady(snapshot));
        const drawMs = Math.max(0, nowMs() - drawStart);

        // REPORTED AFTER THE PUBLISH, so measuring never delays what the user
        // is waiting for. Always computed, even with no listener: a breakdown
        // that only exists when someone is watching is one that is broken when
        // they start watching.
        const ring = composeClickTimings({
          radius,
          pipeline: snapshot.timings,
          worker: workerTimings,
          roundTripMs,
          drawMs,
        });
        rings.push(ring);
        onTimings?.(ring);
      }
      // AFTER THE LOOP, so it covers the gaps between passes and the per-ring
      // bookkeeping. Reported only when at least one ring published: a run that
      // was superseded before publishing anything has no click to summarise,
      // and a "0 ms across 0 rings" line would be noise on every abort — of
      // which there is one per click the user makes while a fetch is in
      // flight, i.e. the common case on a slow network.
      if (rings.length > 0) {
        onClickSummary?.(
          composeClickSummary(Math.max(0, nowMs() - clickStart), rings),
        );
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
