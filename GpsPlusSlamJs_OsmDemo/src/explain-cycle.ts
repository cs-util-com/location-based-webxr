/**
 * The explain cycle: a selected cell in, an explanation out, staleness dropped.
 *
 * WHY IT IS A MODULE RATHER THAN A CLOSURE IN `main.ts`. It was the demo's THIRD
 * async action and arrived last, so it was the only one still inline at the time.
 * It has the same two hazards as the other two — a late answer that no longer
 * matches the user's intent, and a rejection that has to reach the user — and
 * neither was covered by a test while it lived in the app shell, which cannot be
 * unit-tested at all. `refresh-cycle.ts` and `terrain-cycle.ts` were the
 * established pattern; `geo-event-cycle.ts` was extracted later (W0) for exactly
 * this reason, having been missed here because the geo-event did not exist yet.
 *
 * WHY IT NEEDS STALENESS CHECKS AT ALL. Explaining a cell is an RPC now, because
 * the explanation needs the merged features (~21 MB) and the rule table, both of
 * which live in the worker. So an answer can arrive after the user has clicked a
 * different cell, or switched category. Rendering it then would put a confident
 * description of one cell under a map showing another — exactly the cross-view
 * disagreement the store was introduced to make impossible.
 *
 * WHY BOTH the cell AND the category are re-checked. Either can change while the
 * call is in flight, and they change through different actions: a click on the map
 * and a change of the `<select>`. Checking only the cell would let a category
 * switch render the previous category's arithmetic for the right cell, which is
 * harder to notice than the wrong cell entirely.
 *
 * NOT COALESCED through `latestOnly`, unlike the other two cycles, and that is
 * deliberate: an explanation is cheap (no network, no scoring — it re-derives from
 * data already in the worker), so serialising it would add latency to the one
 * interaction that should feel instant. Dropping stale answers on arrival is the
 * cheaper guarantee and gives the same result.
 *
 * @see explain-cycle.ts.md
 */

import type { CellExplanation } from "gps-plus-slam-osm";

import { selectOsmView, type DemoStore } from "./osm-store.js";

/** The part of the worker client this needs; narrowed so tests can fake it. */
interface ExplainWorker {
  call(
    kind: "explain",
    payload: { cell: string; category: string },
  ): Promise<CellExplanation | undefined>;
}

export interface ExplainCycleOptions {
  readonly store: DemoStore["store"];
  readonly actions: DemoStore["actions"];
  readonly worker: ExplainWorker;
  /** Draws an explanation. Called only for an answer that is still current. */
  readonly render: (explanation: CellExplanation) => void;
  /** Empties the panel. Called only when nothing is selected. */
  readonly clear: () => void;
  /**
   * Says, in the panel, that this cell has no explanation to give.
   *
   * SEPARATE FROM `clear` because the two look identical from here and opposite
   * to the user: `clear` hides the panel, which is the silence DEC-7 exists to
   * remove. And separate from the store's error channel — see the module header.
   */
  readonly unavailable: (cell: string) => void;
}

/** `Error` messages when we have one, the value's text when we do not. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the explain action.
 *
 * The returned function never rejects — a failed explanation must not become an
 * unhandled rejection, and it reports through the store's non-fatal channel
 * because it says nothing about whether the map's data is still good.
 */
export function createExplainCycle(
  options: ExplainCycleOptions,
): (cell: string | undefined) => Promise<void> {
  const { store, actions, worker, render, clear, unavailable } = options;

  return async (cell: string | undefined): Promise<void> => {
    if (cell === undefined) {
      clear();
      return;
    }
    // Captured at DISPATCH time and compared against the store at ARRIVAL time.
    // Reading the category only on arrival would compare it against itself.
    const category = selectOsmView(store.getState()).category;

    try {
      const explanation = await worker.call("explain", { cell, category });
      const current = selectOsmView(store.getState());
      // Dropped unless BOTH still match — see the module header.
      if (current.selectedCell !== cell || current.category !== category) {
        return;
      }
      if (explanation === undefined) {
        // SAY SO, rather than doing nothing at all.
        //
        // DEC-7's whole reason for revealing sub-threshold cells is that "a
        // hidden cell is the one cell you cannot click to ask why" — so
        // clicking one and getting silence undercuts the feature it exists to
        // serve. The user is left unable to tell "this cell has no explanation"
        // from "the click missed".
        //
        // IN THE PANEL, NOT THROUGH `nonFatalError`, and that distinction is the
        // whole point. This is a legitimate, routine state — the selection
        // outlives one working set, so after a move the worker no longer scores
        // the cell — but `nonFatalError` sets `loading.phase = "error"`, and two
        // subscribers act on the PHASE rather than on the message:
        // `refresh-cycle.ts` drops the remaining rings of a progressive
        // widening, and `main.ts` expands a collapsed header. Since a new
        // snapshot re-explains whatever is still selected, and one widening
        // publishes three, moving with a stale cell selected silently cost the
        // user rings 2 and 3 and replaced the counts with "Failed: …".
        // Raised in review on #265; pinned by `explain-cycle.test.ts`.
        unavailable(cell);
        return;
      }
      render(explanation);
    } catch (error) {
      store.dispatch(
        actions.nonFatalError(`details panel: ${messageOf(error)}`),
      );
    }
  };
}
