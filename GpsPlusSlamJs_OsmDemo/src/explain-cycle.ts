/**
 * The explain cycle: a selected cell in, an explanation out, staleness dropped.
 *
 * WHY IT IS A MODULE RATHER THAN A CLOSURE IN `main.ts`. It is the demo's THIRD
 * async action, and it arrived last, so it was the only one still inline. It has
 * the same two hazards as the other two — a late answer that no longer matches the
 * user's intent, and a rejection that has to reach the user — and neither was
 * covered by a test while it lived in the app shell, which cannot be unit-tested at
 * all. `refresh-cycle.ts` and `terrain-cycle.ts` are the established pattern.
 *
 * WHY IT NEEDS STALENESS CHECKS AT ALL. Explaining a cell is an RPC now, because
 * the explanation needs the merged features (28–68 MB) and the rule table, both of
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
  /** Empties the panel: no selection, or a cell the snapshot does not hold. */
  readonly clear: () => void;
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
  const { store, actions, worker, render, clear } = options;

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
        // It is a real case rather than a fault: the selection outlives one
        // working set, so after a move the worker legitimately no longer holds
        // the cell. Reported through the NON-FATAL channel for exactly that
        // reason — it says nothing about whether the map's data is still good.
        clear();
        store.dispatch(
          actions.nonFatalError(
            `details panel: the worker no longer holds ${cell}, so there is nothing to explain`,
          ),
        );
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
