import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { DEFAULT_TOAST_LINGER_MS } from "gps-plus-slam-app-framework/utils/toast-core";

import { SKIP_UNDO_MS as GUIDE_SKIP_UNDO_MS } from "./station-guide";
import { walkOffered, walkRoute, walkStatus } from "./station-run";
import { createTourViewerStore } from "./tour-viewer-session";
import { guideTourChanged } from "./visitor-guide-slice";
import {
  quickArmed,
  noteCleared,
  sheetSet,
  selectNote,
  selectUndoableSkip,
  SKIP_UNDO_MS,
  skipSettled,
  skipTaken,
  skipUndone,
  visitorWalkReducer,
  walkBatched,
  walkCleared,
  walkStarted,
  walkStepped,
  type VisitorWalkState,
} from "./visitor-walk-slice";

/**
 * Why these tests matter (visitor walk W4 build plan 2026-10-21-1105, M1,
 * §2.2): the visitor's walk - the run's statuses, the last skip, the note
 * and the skip's arm - lives in the page's store, so every view reads one
 * answer. Each reducer case guards the rule it applies (a station is
 * found only while offered and waiting, skipped only while offered and
 * not done, brought back only when skipped, its clock started once, a
 * skip settled once), returns the same state when it changes nothing
 * (the guide dispatches only events, never a frame), and a batch of them
 * is exactly their sequence.
 */

const step = {
  id: "t",
  block: { kind: "text", text: "Hi" },
  advance: { mode: "tap" },
} as const;

function station(id: string, extra: Partial<TourStation> = {}): TourStation {
  return {
    id,
    title: id.toUpperCase(),
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    items: [],
    activateRadiusM: 20,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [step],
    ...extra,
  };
}

const TOUR = [station("a"), station("b", { next: "a" }), station("c")];

function started(order: TourOrder, stations = TOUR): VisitorWalkState {
  return visitorWalkReducer(
    undefined,
    walkStarted({ order, route: walkRoute(stations) }),
  );
}

function progress(state: VisitorWalkState) {
  if (state.progress === null) throw new Error("no walk");
  return state.progress;
}

describe("visitorWalkReducer", () => {
  it("starts with no walk, and a walk starts with every station waiting and the order's offer", () => {
    const empty = visitorWalkReducer(undefined, { type: "@@init" });
    expect(empty).toEqual({
      progress: null,
      lastSkip: null,
      note: null,
      quickArmedId: null,
      sheet: "peek",
      completionSeen: false,
    });
    expect(walkOffered(progress(started("any")))).toEqual(["a", "b", "c"]);
    expect(walkOffered(progress(started("fixed")))).toEqual(["a"]);
    expect(walkOffered(progress(started("branch")))).toEqual(["a"]);
    expect(walkStatus(progress(started("any")), "b")).toEqual({
      id: "b",
      state: "waiting",
      skipped: false,
      focusedAtMs: null,
      focusDistanceM: null,
    });
  });

  it("finds a station only while it is offered and waiting", () => {
    const fixed = started("fixed");
    // Not offered under fixed order: walking past it finds nothing.
    expect(
      visitorWalkReducer(fixed, walkStepped({ kind: "found", id: "b" })),
    ).toBe(fixed);
    const found = visitorWalkReducer(
      fixed,
      walkStepped({ kind: "found", id: "a" }),
    );
    expect(walkStatus(progress(found), "a")?.state).toBe("found");
    // A latch: found again changes nothing.
    expect(
      visitorWalkReducer(found, walkStepped({ kind: "found", id: "a" })),
    ).toBe(found);
    // An id the tour does not have changes nothing.
    expect(
      visitorWalkReducer(found, walkStepped({ kind: "found", id: "nowhere" })),
    ).toBe(found);
  });

  it("a station without steps is done the moment it is found, and the order moves on", () => {
    const state = started("fixed", [station("a", { steps: [] }), station("b")]);
    const next = visitorWalkReducer(
      state,
      walkStepped({ kind: "found", id: "a" }),
    );
    expect(walkStatus(progress(next), "a")?.state).toBe("done");
    expect(walkOffered(progress(next))).toEqual(["b"]);
  });

  it("finishes only a found station", () => {
    const state = started("any");
    expect(
      visitorWalkReducer(state, walkStepped({ kind: "finish", id: "a" })),
    ).toBe(state);
    const found = visitorWalkReducer(
      state,
      walkStepped({ kind: "found", id: "a" }),
    );
    const done = visitorWalkReducer(
      found,
      walkStepped({ kind: "finish", id: "a" }),
    );
    expect(walkStatus(progress(done), "a")).toMatchObject({
      state: "done",
      skipped: false,
    });
    expect(walkOffered(progress(done))).toEqual(["b", "c"]);
  });

  it("skips only an offered station not yet done, and brings back only a skipped one", () => {
    const fixed = started("fixed");
    expect(
      visitorWalkReducer(fixed, walkStepped({ kind: "skip", id: "b" })),
    ).toBe(fixed);
    const skipped = visitorWalkReducer(
      fixed,
      walkStepped({ kind: "skip", id: "a" }),
    );
    expect(walkStatus(progress(skipped), "a")).toMatchObject({
      state: "done",
      skipped: true,
    });
    expect(walkOffered(progress(skipped))).toEqual(["b"]);
    // Done already: no second skip.
    expect(
      visitorWalkReducer(skipped, walkStepped({ kind: "skip", id: "a" })),
    ).toBe(skipped);
    // Not skipped: no bring back.
    expect(
      visitorWalkReducer(skipped, walkStepped({ kind: "unskip", id: "b" })),
    ).toBe(skipped);
    const back = visitorWalkReducer(
      skipped,
      walkStepped({ kind: "unskip", id: "a" }),
    );
    expect(walkStatus(progress(back), "a")).toEqual({
      id: "a",
      state: "waiting",
      skipped: false,
      focusedAtMs: null,
      focusDistanceM: null,
    });
    expect(walkOffered(progress(back))).toEqual(["a"]);
  });

  it("starts a station's skip clock once, and only while it is offered", () => {
    const fixed = started("fixed");
    expect(
      visitorWalkReducer(
        fixed,
        walkStepped({ kind: "focus", id: "b", atMs: 5, distanceM: 30 }),
      ),
    ).toBe(fixed);
    const focused = visitorWalkReducer(
      fixed,
      walkStepped({ kind: "focus", id: "a", atMs: 5, distanceM: 30 }),
    );
    expect(walkStatus(progress(focused), "a")).toMatchObject({
      focusedAtMs: 5,
      focusDistanceM: 30,
    });
    expect(
      visitorWalkReducer(
        focused,
        walkStepped({ kind: "focus", id: "a", atMs: 9, distanceM: 10 }),
      ),
    ).toBe(focused);
  });

  it("notes the first distance of a clock started without one, once", () => {
    const focused = visitorWalkReducer(
      started("fixed"),
      walkStepped({ kind: "focus", id: "a", atMs: 5, distanceM: null }),
    );
    const noted = visitorWalkReducer(
      focused,
      walkStepped({ kind: "focus-distance", id: "a", distanceM: 12 }),
    );
    expect(walkStatus(progress(noted), "a")?.focusDistanceM).toBe(12);
    expect(
      visitorWalkReducer(
        noted,
        walkStepped({ kind: "focus-distance", id: "a", distanceM: 3 }),
      ),
    ).toBe(noted);
  });

  it("holds the last skip until it settles, once; an undo drops it and notes the bring back", () => {
    const taken = visitorWalkReducer(
      started("any"),
      skipTaken({ id: "a", atMs: 100 }),
    );
    expect(taken.lastSkip).toEqual({ id: "a", atMs: 100, settled: false });
    expect(taken.note).toEqual({ kind: "skipped", id: "a", atMs: 100 });
    const settled = visitorWalkReducer(taken, skipSettled());
    expect(settled.lastSkip).toEqual({ id: "a", atMs: 100, settled: true });
    expect(visitorWalkReducer(settled, skipSettled())).toBe(settled);
    expect(visitorWalkReducer(started("any"), skipSettled()).lastSkip).toBe(
      null,
    );
    const undone = visitorWalkReducer(
      taken,
      skipUndone({ id: "a", atMs: 900 }),
    );
    expect(undone.lastSkip).toBeNull();
    expect(undone.note).toEqual({ kind: "brought-back", id: "a", atMs: 900 });
    expect(visitorWalkReducer(undone, noteCleared()).note).toBeNull();
  });

  it("arms the quick action for one station, and disarms it", () => {
    const armed = visitorWalkReducer(started("any"), quickArmed("b"));
    expect(armed.quickArmedId).toBe("b");
    expect(visitorWalkReducer(armed, quickArmed("b"))).toBe(armed);
    expect(visitorWalkReducer(armed, quickArmed(null)).quickArmedId).toBeNull();
  });

  it("a new walk, no tour and another tour reset everything", () => {
    let state = started("any");
    state = visitorWalkReducer(state, quickArmed("a"));
    state = visitorWalkReducer(state, skipTaken({ id: "b", atMs: 1 }));
    expect(started("fixed")).toEqual(
      visitorWalkReducer(
        state,
        walkStarted({ order: "fixed", route: walkRoute(TOUR) }),
      ),
    );
    const initial = visitorWalkReducer(undefined, { type: "@@init" });
    expect(visitorWalkReducer(state, walkCleared())).toEqual(initial);
    expect(visitorWalkReducer(state, guideTourChanged())).toEqual(initial);
  });

  it("a batch is exactly its actions in sequence, and an empty one changes nothing", () => {
    const actions = [
      quickArmed("a"),
      walkStepped({ kind: "found", id: "a" }),
      walkStepped({ kind: "finish", id: "a" }),
      skipTaken({ id: "b", atMs: 3 }),
      walkStepped({ kind: "skip", id: "b" }),
    ];
    const start = started("any");
    const sequential = actions.reduce(visitorWalkReducer, start);
    expect(visitorWalkReducer(start, walkBatched(actions))).toEqual(sequential);
    expect(visitorWalkReducer(start, walkBatched([]))).toBe(start);
  });

  it("changes nothing on any other action, and without a walk no step applies", () => {
    const state = started("any");
    expect(visitorWalkReducer(state, { type: "other/thing" })).toBe(state);
    const none = visitorWalkReducer(undefined, { type: "@@init" });
    expect(
      visitorWalkReducer(none, walkStepped({ kind: "found", id: "a" })),
    ).toBe(none);
  });
});

describe("the sheet (W4 build plan M2, §1.5, §1.6)", () => {
  // Why these tests matter: the sheet's peek / list is UI state in the
  // store (root CLAUDE.md, the Redux rule), and two of its changes follow
  // the walk rather than a tap - a story starting closes the list, and the
  // tour's completion opens it once (W4). Done in the reducer, they hold
  // for every writer of the walk, and a repeated completion does not open
  // the list again over the visitor's own close.
  it("opens and closes on a tap, and the same state when it is already so", () => {
    const peek = started("any");
    const list = visitorWalkReducer(peek, sheetSet("list"));
    expect(list.sheet).toBe("list");
    expect(visitorWalkReducer(list, sheetSet("list"))).toBe(list);
    expect(visitorWalkReducer(list, sheetSet("peek")).sheet).toBe("peek");
    expect(visitorWalkReducer(peek, sheetSet("peek"))).toBe(peek);
  });

  it("a story starting (a station found) closes the list; a station without steps does not", () => {
    const list = visitorWalkReducer(started("any"), sheetSet("list"));
    expect(
      visitorWalkReducer(list, walkStepped({ kind: "found", id: "a" })).sheet,
    ).toBe("peek");
    const stepless = visitorWalkReducer(
      visitorWalkReducer(
        undefined,
        walkStarted({
          order: "any",
          route: walkRoute([station("a", { steps: [] }), station("b")]),
        }),
      ),
      sheetSet("list"),
    );
    expect(
      visitorWalkReducer(stepless, walkStepped({ kind: "found", id: "a" }))
        .sheet,
    ).toBe("list");
    // A find the rule refuses changes nothing, the sheet included.
    expect(
      visitorWalkReducer(list, walkStepped({ kind: "found", id: "zz" })),
    ).toBe(list);
  });

  it("the completion opens the list once; closed by the visitor it stays closed", () => {
    let state = started("fixed", [station("a"), station("b")]);
    state = visitorWalkReducer(state, walkStepped({ kind: "found", id: "a" }));
    state = visitorWalkReducer(state, walkStepped({ kind: "finish", id: "a" }));
    expect(state.sheet).toBe("peek");
    expect(state.completionSeen).toBe(false);
    state = visitorWalkReducer(state, walkStepped({ kind: "skip", id: "b" }));
    expect(state.sheet).toBe("list");
    expect(state.completionSeen).toBe(true);
    state = visitorWalkReducer(state, sheetSet("peek"));
    // Another change to a complete walk (a clock, a settle) opens nothing.
    state = visitorWalkReducer(state, skipSettled());
    expect(state.sheet).toBe("peek");
  });

  it("a completion undone and reached again opens the list again (once per completion)", () => {
    let state = started("any", [station("a")]);
    state = visitorWalkReducer(state, walkStepped({ kind: "skip", id: "a" }));
    expect(state.sheet).toBe("list");
    state = visitorWalkReducer(state, sheetSet("peek"));
    state = visitorWalkReducer(state, walkStepped({ kind: "unskip", id: "a" }));
    expect(state.completionSeen).toBe(false);
    expect(state.sheet).toBe("peek");
    state = visitorWalkReducer(state, walkStepped({ kind: "skip", id: "a" }));
    expect(state.sheet).toBe("list");
  });

  it("a new walk starts on the peek", () => {
    const list = visitorWalkReducer(started("any"), sheetSet("list"));
    expect(
      visitorWalkReducer(
        list,
        walkStarted({ order: "any", route: walkRoute(TOUR) }),
      ).sheet,
    ).toBe("peek");
  });

  it("over any sequence of steps the list is open after a completion unless closed since", () => {
    const steps = fc.constantFrom(
      ...["a", "b", "c"].flatMap((id) => [
        walkStepped({ kind: "found", id }),
        walkStepped({ kind: "finish", id }),
        walkStepped({ kind: "skip", id }),
        walkStepped({ kind: "unskip", id }),
      ]),
    );
    fc.assert(
      fc.property(
        fc.constantFrom<TourOrder>("any", "fixed", "branch"),
        fc.array(steps, { maxLength: 14 }),
        (order, actions) => {
          let state = started(order);
          for (const action of actions) {
            const before = state;
            state = visitorWalkReducer(state, action);
            const complete = walkOffered(progress(state)).length === 0;
            const wasComplete = walkOffered(progress(before)).length === 0;
            expect(state.completionSeen).toBe(complete);
            // A completion just reached opens the list.
            expect(complete && !wasComplete && state.sheet !== "list").toBe(
              false,
            );
          }
        },
      ),
    );
  });
});

/** A storage backend that keeps the action types it was asked to write. */
class CapturingBackend extends NullStorageBackend {
  readonly written: string[] = [];
  override writeAction(action: unknown, index: number): Promise<void> {
    this.written.push((action as { type: string }).type);
    return super.writeAction(action, index);
  }
}

describe("the page's store and the walk", () => {
  // Why (plan §2.2): `visitorWalk/*` is dispatched from inside the store's
  // subscriber (the guide ticks there); a persisted action dispatched
  // there would be recorded out of order (lessons-learned), so none is.
  it("mounts the walk as visitorWalk and never writes its actions into a recording", async () => {
    const backend = new CapturingBackend();
    const store = createTourViewerStore({
      storageBackend: backend,
      persistWhile: () => true,
    });
    expect(store.getState().visitorWalk.progress).toBeNull();
    store.dispatch(
      walkBatched([
        walkStarted({ order: "any", route: walkRoute(TOUR) }),
        walkStepped({ kind: "found", id: "a" }),
      ]),
    );
    store.dispatch(skipTaken({ id: "b", atMs: 1 }));
    // A persisted action as the control: the recording does write.
    store.dispatch({ type: "tourAuthoring/probe" });
    await store.flushPendingActionWrites();
    expect(walkStatus(progress(store.getState().visitorWalk), "a")?.state).toBe(
      "found",
    );
    expect(backend.written).toContain("tourAuthoring/probe");
    expect(backend.written.filter((t) => t.startsWith("visitorWalk/"))).toEqual(
      [],
    );
  });
});

describe("the walk's windows (selectUndoableSkip, selectNote)", () => {
  // Why (W4 M1 review): the undo's and the note's 6 s are read by more
  // than the guide - the sheet of M2 reads the same windows - so they are
  // selectors of the slice, over the page's time, with no timer.
  it("offers the last skip's undo until it settles or its window ends", () => {
    const at = 10_000;
    const skipped = visitorWalkReducer(
      started("any"),
      skipTaken({ id: "a", atMs: at }),
    );
    const root = (visitorWalk: VisitorWalkState) => ({ visitorWalk });
    expect(selectUndoableSkip(root(started("any")), at)).toBeNull();
    expect(selectUndoableSkip(root(skipped), at)).toEqual({
      id: "a",
      atMs: at,
    });
    expect(
      selectUndoableSkip(root(skipped), at + SKIP_UNDO_MS - 1),
    ).toMatchObject({ id: "a" });
    expect(selectUndoableSkip(root(skipped), at + SKIP_UNDO_MS)).toBeNull();
    const settled = visitorWalkReducer(skipped, skipSettled());
    expect(selectUndoableSkip(root(settled), at)).toBeNull();
    const undone = visitorWalkReducer(
      skipped,
      skipUndone({ id: "a", atMs: at + 1 }),
    );
    expect(selectUndoableSkip(root(undone), at + 1)).toBeNull();
  });

  it("shows the note inside its window only, for a skip and a bring back alike", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e9 }),
        fc.integer({ min: -1_000, max: 2 * SKIP_UNDO_MS }),
        fc.boolean(),
        (atMs, sinceMs, undo) => {
          const skipped = visitorWalkReducer(
            started("any"),
            skipTaken({ id: "a", atMs }),
          );
          const state = undo
            ? visitorWalkReducer(skipped, skipUndone({ id: "a", atMs }))
            : skipped;
          const note = selectNote({ visitorWalk: state }, atMs + sinceMs);
          expect(note).toEqual(
            sinceMs >= SKIP_UNDO_MS
              ? null
              : { kind: undo ? "brought-back" : "skipped", id: "a", atMs },
          );
        },
      ),
    );
    const cleared = visitorWalkReducer(
      visitorWalkReducer(started("any"), skipTaken({ id: "a", atMs: 0 })),
      noteCleared(),
    );
    expect(selectNote({ visitorWalk: cleared }, 0)).toBeNull();
  });

  // Why: the window is the framework's toast linger (6 s), one value for
  // the guide, which still names it, and the slice.
  it("is the toast linger, the one value the guide names too", () => {
    expect(SKIP_UNDO_MS).toBe(DEFAULT_TOAST_LINGER_MS);
    expect(GUIDE_SKIP_UNDO_MS).toBe(SKIP_UNDO_MS);
  });
});
