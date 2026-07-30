/**
 * The explain cycle's two hazards: a stale answer, and a rejection.
 *
 * WHY THESE TESTS MATTER. Both failures are silent in the way that matters most —
 * they produce a panel that looks entirely plausible and describes the wrong thing,
 * or no panel at all with no explanation why.
 *
 * This logic previously lived inline in `main.ts`, which cannot be unit-tested, so
 * none of it was covered. Extracting it was the point: the staleness rule is four
 * lines and two of them are easy to get subtly wrong (comparing the category
 * against itself instead of against the captured one; checking the cell but not the
 * category).
 */

import { describe, expect, it, vi } from "vitest";
import type { CellExplanation } from "gps-plus-slam-osm";

import { createDemoStore, selectOsmView } from "./osm-store.js";
import { createExplainCycle } from "./explain-cycle.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

const explanationFor = (cell: string, category: string): CellExplanation =>
  ({ cell, category, score: 3, features: [] }) as unknown as CellExplanation;

/** A worker whose one call the test can hold open and answer by hand. */
function setup() {
  const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
  const calls: {
    cell: string;
    category: string;
    answer: (value: CellExplanation | undefined) => void;
    fail: (error: unknown) => void;
  }[] = [];
  const render = vi.fn();
  const clear = vi.fn();

  const explain = createExplainCycle({
    store: demo.store,
    actions: demo.actions,
    worker: {
      call: (_kind, payload) =>
        new Promise((resolve, reject) => {
          calls.push({
            cell: payload.cell,
            category: payload.category,
            answer: resolve,
            fail: reject,
          });
        }),
    },
    render,
    clear,
  });

  return { ...demo, explain, calls, render, clear };
}

describe("createExplainCycle", () => {
  it("renders an explanation for the cell that is still selected", async () => {
    const { store, actions, explain, calls, render } = setup();
    store.dispatch(actions.cellSelected("cell-a"));

    const pending = explain("cell-a");
    calls[0]?.answer(explanationFor("cell-a", "walkable"));
    await pending;

    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0]).toMatchObject({ cell: "cell-a" });
  });

  it("clears the panel for no selection, without asking the worker", async () => {
    const { explain, calls, clear } = setup();
    await explain(undefined);
    expect(clear).toHaveBeenCalledTimes(1);
    // An RPC for "nothing is selected" would be a round trip to learn nothing.
    expect(calls).toHaveLength(0);
  });

  it("DROPS an answer whose cell is no longer selected", async () => {
    // The user clicked another cell while this was in flight. Rendering now would
    // describe cell-a under a map highlighting cell-b.
    const { store, actions, explain, calls, render } = setup();
    store.dispatch(actions.cellSelected("cell-a"));
    const pending = explain("cell-a");

    store.dispatch(actions.cellSelected("cell-b"));
    calls[0]?.answer(explanationFor("cell-a", "walkable"));
    await pending;

    expect(render).not.toHaveBeenCalled();
  });

  it("DROPS an answer whose category has changed", async () => {
    // The subtler half, and the reason the category is captured at dispatch time
    // rather than read on arrival: this answer is for the RIGHT cell, so a
    // cell-only check would let it through and render the previous category's
    // arithmetic under a map showing the new one.
    const { store, actions, explain, calls, render } = setup();
    store.dispatch(actions.cellSelected("cell-a"));
    const pending = explain("cell-a");
    expect(calls[0]?.category).toBe("walkable");

    store.dispatch(actions.categoryChanged("battleArea"));
    calls[0]?.answer(explanationFor("cell-a", "walkable"));
    await pending;

    expect(render).not.toHaveBeenCalled();
  });

  it("clears the panel when the worker does not hold the cell", async () => {
    // `undefined` means the cell is not in the current snapshot — a real case
    // after the user moves, since the selection outlives one working set.
    const { store, actions, explain, calls, clear, render } = setup();
    store.dispatch(actions.cellSelected("cell-a"));
    const pending = explain("cell-a");
    calls[0]?.answer(undefined);
    await pending;

    expect(clear).toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("reports a rejection through the NON-FATAL channel and never rejects itself", async () => {
    // Two claims. A failed explanation says nothing about whether the map's data
    // is good, so it must not clear the snapshot — that is `fetchFailed`'s job.
    // And it must not become an unhandled rejection: the caller is a store
    // subscriber, and throwing there would skip every later subscriber.
    const { store, actions, explain, calls } = setup();
    store.dispatch(actions.cellSelected("cell-a"));
    store.dispatch(actions.snapshotReady({ cells: [] } as never));

    const pending = explain("cell-a");
    calls[0]?.fail(new Error("worker went away"));
    await expect(pending).resolves.toBeUndefined();

    const view = selectOsmView(store.getState());
    expect(view.loading).toEqual({
      phase: "error",
      message: "details panel: worker went away",
    });
    // The snapshot SURVIVES — that is the whole distinction.
    expect(view.snapshot).not.toBeUndefined();
  });

  it("survives a thrown non-Error", async () => {
    const { store, actions, explain, calls } = setup();
    store.dispatch(actions.cellSelected("cell-a"));
    const pending = explain("cell-a");
    calls[0]?.fail("a string, because anything can be thrown");
    await pending;

    expect(selectOsmView(store.getState()).loading.message).toContain(
      "a string",
    );
  });
});
