/**
 * The geo-event cycle's four hazards: the busy state, a rejection, a stale
 * answer, and the republish.
 *
 * WHY THESE TESTS MATTER. All four were unreachable before this module existed.
 * The geo-event lived as a closure in `main.ts`, which cannot be unit-tested, so
 * the only covered part of a 5–10 s operation was the pure label arithmetic in
 * `event-label.ts`. The two that had already gone wrong in production are here:
 * a failure routed through `fetchFailed`, which blanks the whole map for an
 * outcome that says nothing about the data (DEC-W2a); and the missing republish,
 * which is why the probed cells and the fetched tiles never reached the map at
 * all (W1, G6/G7).
 */

import { describe, expect, it, vi } from "vitest";
import type { GeoEvent } from "gps-plus-slam-osm";

import {
  createGeoEventCycle,
  GEO_EVENT_BUSY_LABEL,
  GEO_EVENT_IDLE_LABEL,
} from "./geo-event-cycle.js";
import { createDemoStore, selectOsmView } from "./osm-store.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

/** An event with one pick, far enough away that the label names a direction. */
const eventWith = (picks: number): GeoEvent => ({
  eventTime: Date.UTC(2026, 7, 7, 16, 15),
  tilesSearched: 7,
  picks: Array.from({ length: picks }, () => ({
    candidate: { lat: 50.945, lng: 6.96 },
    cell: "8d1f",
    position: { lat: 50.945, lng: 6.96 },
    heat: 12,
    evaluated: [],
  })),
});

/** A worker whose one call the test holds open and answers by hand. */
function setup() {
  const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
  const calls: {
    payload: { position: { lat: number; lng: number }; category: string };
    answer: (value: GeoEvent) => void;
    fail: (error: unknown) => void;
  }[] = [];
  const render = vi.fn();
  const setLabel = vi.fn();
  const setBusy = vi.fn();
  const republish = vi.fn(() => Promise.resolve());

  const find = createGeoEventCycle({
    store: demo.store,
    actions: demo.actions,
    worker: {
      call: (_kind, payload) =>
        new Promise<GeoEvent>((resolve, reject) => {
          calls.push({ payload, answer: resolve, fail: reject });
        }),
    },
    render,
    setLabel,
    setBusy,
    republish,
    now: () => 1_700_000_000_000,
  });

  return { ...demo, find, calls, render, setLabel, setBusy, republish };
}

describe("createGeoEventCycle", () => {
  it("asks for the CURRENT position and category, and renders the answer", async () => {
    const { find, calls, render, setLabel } = setup();

    const pending = find();
    expect(calls[0]?.payload).toMatchObject({
      position: COLOGNE,
      category: "walkable",
    });

    calls[0]?.answer(eventWith(1));
    await pending;

    expect(render).toHaveBeenCalledTimes(1);
    // The terminal label is the whole point of F56 — the winner is usually
    // outside the viewport, so "nothing happened" and "it worked" look alike.
    expect(setLabel).toHaveBeenLastCalledWith(expect.stringContaining("Event"));
  });

  it("shows the in-progress state for the duration and restores it after", async () => {
    // The root CLAUDE.md requires an async control to show one, and this
    // operation is 5–10 s. Asserted for BOTH edges: a busy state that is never
    // left is worse than none.
    const { find, calls, setBusy, setLabel } = setup();

    const pending = find();
    expect(setBusy).toHaveBeenLastCalledWith(true);
    expect(setLabel).toHaveBeenCalledWith(GEO_EVENT_BUSY_LABEL);

    calls[0]?.answer(eventWith(1));
    await pending;

    expect(setBusy).toHaveBeenLastCalledWith(false);
  });

  it("says 'no event nearby' rather than failing when nothing was found", async () => {
    // A tile that is all water genuinely has no event. This is the routine
    // outcome that must stay distinguishable from the failure below.
    const { find, calls, setLabel, render } = setup();

    const pending = find();
    calls[0]?.answer(eventWith(0));
    await pending;

    expect(setLabel).toHaveBeenLastCalledWith(
      expect.stringContaining("No event nearby"),
    );
    // Still rendered — `renderGeoEvent` clears the layer, which is how the
    // PREVIOUS search's markers stop claiming to be current.
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("reports a rejection WITHOUT blanking the map, and never rejects itself", async () => {
    // WHY THIS TEST MATTERS — this is DEC-W2a as a regression guard. The
    // original handler dispatched `fetchFailed`, which clears the snapshot and
    // all three selections (osm-view-slice.ts:359). A transient Overpass error
    // during a Find therefore destroyed a map the user was reading, to report a
    // fault that says nothing about whether that map's data is still good.
    //
    // It must also not become an unhandled rejection: the caller is a DOM
    // listener, and `void`-ing a rejecting promise is an unhandled rejection.
    const { store, actions, find, calls, setLabel } = setup();
    store.dispatch(actions.snapshotReady({ cells: [] } as never));

    const pending = find();
    calls[0]?.fail(new Error("worker went away"));
    await expect(pending).resolves.toBeUndefined();

    const view = selectOsmView(store.getState());
    expect(view.loading).toEqual({
      phase: "error",
      message: "geo-event failed: worker went away",
    });
    // The snapshot SURVIVES — that is the whole distinction.
    expect(view.snapshot).not.toBeUndefined();
    expect(setLabel).toHaveBeenLastCalledWith(GEO_EVENT_IDLE_LABEL);
  });

  it("survives a thrown non-Error", async () => {
    const { store, find, calls } = setup();
    const pending = find();
    calls[0]?.fail("a string, because anything can be thrown");
    await pending;

    expect(selectOsmView(store.getState()).loading.message).toContain(
      "a string",
    );
  });

  it("DROPS an answer whose category has changed while it was in flight", async () => {
    // The search takes 5–10 s, which is ample time to change the picker. The
    // event was computed against the old category's scores and threshold, so
    // drawing it over the new category's map is the cross-view disagreement the
    // store exists to prevent — and once W2 clears the markers on a category
    // change, a late arrival would silently put them back.
    const { store, actions, find, calls, render, setLabel } = setup();

    const pending = find();
    store.dispatch(actions.categoryChanged("battleArea"));
    calls[0]?.answer(eventWith(1));
    await pending;

    expect(render).not.toHaveBeenCalled();
    // The button must not be left saying "Finding…" for a search that resolved.
    expect(setLabel).toHaveBeenLastCalledWith(GEO_EVENT_IDLE_LABEL);
  });

  it("REPUBLISHES after a successful search, so the work it did becomes visible", async () => {
    // WHY THIS TEST MATTERS — this is W1, and it is the whole of G6 and G7.
    // `DemoPipeline.geoEvent` scores the cells around every candidate and adds
    // the tiles it fetched to `loaded`, both of which the NEXT snapshot would
    // carry. Nothing asked for a next snapshot, so the probed cells never
    // appeared and the red fetch rectangles never grew — leaving a winner
    // legitimately outside them.
    const { find, calls, republish } = setup();

    const pending = find();
    expect(republish).not.toHaveBeenCalled();

    calls[0]?.answer(eventWith(1));
    await pending;

    expect(republish).toHaveBeenCalledTimes(1);
  });

  it("does NOT republish after a failure or a dropped answer", async () => {
    // A failed search produced nothing to publish, and a superseded one belongs
    // to a category the store has left. Refreshing anyway would spend ~1.9 s
    // restating what is already on screen.
    const { store, actions, find, calls, republish } = setup();

    const failed = find();
    calls[0]?.fail(new Error("nope"));
    await failed;
    expect(republish).not.toHaveBeenCalled();

    const stale = find();
    store.dispatch(actions.categoryChanged("battleArea"));
    calls[1]?.answer(eventWith(1));
    await stale;
    expect(republish).not.toHaveBeenCalled();
  });

  it("keeps a failed republish distinct from a failed search", async () => {
    // WHY THIS TEST MATTERS. The republish is a second async step AFTER the
    // answer arrived, so folding it into the search's handler would report
    // "geo-event failed" for a search whose result is visibly on the map, and
    // reset the label over it. Unreachable with the real wiring — `refresh` is
    // `latestOnly`, which never rejects — which is exactly why it needs a test:
    // nothing else would notice if the two were merged.
    //
    // Also asserts the busy state is left. A button disabled forever because a
    // follow-up step threw is the worst outcome of the three.
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    const setBusy = vi.fn();
    const setLabel = vi.fn();
    let answer: (value: GeoEvent) => void = () => {};
    const find = createGeoEventCycle({
      store: demo.store,
      actions: demo.actions,
      worker: {
        call: () =>
          new Promise<GeoEvent>((resolve) => {
            answer = resolve;
          }),
      },
      render: vi.fn(),
      setLabel,
      setBusy,
      republish: () => Promise.reject(new Error("refresh blew up")),
      now: () => 1_700_000_000_000,
    });

    const pending = find();
    answer(eventWith(1));
    await expect(pending).resolves.toBeUndefined();

    expect(setBusy).toHaveBeenLastCalledWith(false);
    expect(selectOsmView(demo.store.getState()).loading.message).toBe(
      "geo-event republish failed: refresh blew up",
    );
    // The result stays described: the search succeeded and its markers are up.
    expect(setLabel).toHaveBeenLastCalledWith(expect.stringContaining("Event"));
  });
});
