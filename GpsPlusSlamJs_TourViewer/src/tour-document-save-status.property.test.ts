/**
 * Why these tests matter: the phone's Finish keeps its running state, its
 * progress line, its failure and "Done waits for a measurement" in the
 * document's save status, which the desktop editor's saves share. Whatever
 * mix of claims, progress, rebuilds, failures, releases, opens and closes
 * the two pages dispatch, the status must stay derived from the slot and
 * the rebuilds alone, a progress line must never outlive the slot it
 * belongs to, and the slot, its progress and a waiting Done must survive a
 * tour opened or closed under them (the save holding the slot lets it go).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  initialTourDocumentState,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
  type TourSaveHolder,
  type TourSaveProgress,
  type TourSaveStatus,
} from "./tour-document.js";
import { tourOf } from "./test-support/tour-of.js";

const MANIFEST = tourOf([]);

function open(): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest: MANIFEST }));
}

const READING: TourSaveProgress = { kind: "reading", bytes: 4096 };
const HALF: TourSaveProgress = { kind: "rebuilding", done: 1, total: 2 };

describe("tour document: the slot holder's progress", () => {
  // Why: the phone's Finish line reads this; a value arriving while nobody
  // holds the slot (a late callback of a Finish already ended) must not
  // put a stale progress line on the panel.
  it("is held only while the slot is, and cleared by the next claim and the release", () => {
    let state = open();
    state = reduce(state, act.saveProgressed({ progress: READING }));
    expect(state.save.progress).toBeNull();
    state = reduce(state, act.saveClaimed({ by: "explicit" }));
    state = reduce(state, act.saveProgressed({ progress: READING }));
    expect(state.save).toMatchObject({ status: "saving", progress: READING });
    state = reduce(state, act.saveProgressed({ progress: HALF }));
    expect(state.save.progress).toEqual(HALF);
    state = reduce(state, act.saveReleased({}));
    expect(state.save).toMatchObject({ status: "idle", progress: null });
    state = reduce(state, act.saveClaimed({ by: "explicit" }));
    state = reduce(state, act.saveProgressed({ progress: HALF }));
    state = reduce(state, act.saveClaimed({ by: "auto" }));
    expect(state.save.progress).toBeNull();
  });

  // Why: the rebuild reports its last entry twice (once as an entry, once
  // as the end); the same value keeps the same state object, so selectors
  // and views see no change. (Redux still calls every subscriber on the
  // dispatch: the Finish's whole-percent gate saves those wake-ups.)
  it("returns the same state for the value already held", () => {
    let state = reduce(open(), act.saveClaimed({ by: "explicit" }));
    state = reduce(state, act.saveProgressed({ progress: HALF }));
    const again = reduce(
      state,
      act.saveProgressed({
        progress: { kind: "rebuilding", done: 1, total: 2 },
      }),
    );
    expect(again).toBe(state);
  });

  // Why: a tour closed while its Finish runs keeps the Finish running on
  // the panel until it ends, as the session's own flags did.
  it("survives a tour closed and another opened while the slot is held", () => {
    let state = reduce(open(), act.saveClaimed({ by: "explicit" }));
    state = reduce(state, act.saveProgressed({ progress: READING }));
    state = reduce(state, act.closed());
    expect(state.save).toMatchObject({
      status: "saving",
      by: "explicit",
      progress: READING,
    });
    state = reduce(state, act.opened({ manifest: MANIFEST }));
    expect(state.save).toMatchObject({ by: "explicit", progress: READING });
  });
});

describe("tour document: Done waits for a measurement", () => {
  // Why: it is its own field, not the desktop's queued Save; it neither
  // makes the tour read as saving nor touches the save's other fields.
  it("is set and cleared alone, without changing the status", () => {
    const before = open();
    const waiting = reduce(before, act.finishWaitsChanged({ waits: true }));
    expect(waiting.save).toEqual({ ...before.save, finishWaits: true });
    expect(reduce(waiting, act.finishWaitsChanged({ waits: true }))).toBe(
      waiting,
    );
    const cleared = reduce(waiting, act.finishWaitsChanged({ waits: false }));
    expect(cleared.save).toEqual(before.save);
  });

  // Why: the waiting Done is the page's, like the slot: a manifest settle
  // (an opened of the same tour) while a code is measured must not drop it.
  it("survives opened and closed", () => {
    let state = reduce(open(), act.finishWaitsChanged({ waits: true }));
    state = reduce(state, act.opened({ manifest: MANIFEST }));
    expect(state.save.finishWaits).toBe(true);
    state = reduce(state, act.closed());
    expect(state.save.finishWaits).toBe(true);
  });
});

type Step =
  | { kind: "claimed"; by: TourSaveHolder }
  | { kind: "progressed"; progress: TourSaveProgress }
  | { kind: "started"; stale: boolean }
  | { kind: "ended"; stale: boolean; error: string | undefined }
  | { kind: "released"; error: string | undefined }
  | { kind: "waits"; waits: boolean }
  | { kind: "opened" }
  | { kind: "closed" };

const holder = fc.constantFrom<TourSaveHolder>(
  "explicit",
  "auto",
  "walk",
  "copy",
  "open",
);
const progress: fc.Arbitrary<TourSaveProgress> = fc.oneof(
  fc.record({ kind: fc.constant("reading" as const), bytes: fc.nat(1e9) }),
  fc.tuple(fc.nat(300), fc.nat(300)).map(([a, b]) => ({
    kind: "rebuilding" as const,
    done: Math.min(a, b),
    total: Math.max(a, b),
  })),
);
const error = fc.option(fc.constantFrom("disk", "quota", "gone"), {
  nil: undefined,
});
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("claimed" as const), by: holder }),
  fc.record({ kind: fc.constant("progressed" as const), progress }),
  fc.record({ kind: fc.constant("started" as const), stale: fc.boolean() }),
  fc.record({
    kind: fc.constant("ended" as const),
    stale: fc.boolean(),
    error,
  }),
  fc.record({ kind: fc.constant("released" as const), error }),
  fc.record({ kind: fc.constant("waits" as const), waits: fc.boolean() }),
  fc.constant({ kind: "opened" as const }),
  fc.constant({ kind: "closed" as const }),
);

function apply(state: TourDocumentState, s: Step): TourDocumentState {
  const generation = (stale: boolean): number =>
    stale ? state.generation - 1 : state.generation;
  switch (s.kind) {
    case "claimed":
      return reduce(state, act.saveClaimed({ by: s.by }));
    case "progressed":
      return reduce(state, act.saveProgressed({ progress: s.progress }));
    case "started":
      return reduce(
        state,
        act.saveStarted({ generation: generation(s.stale) }),
      );
    case "ended":
      return reduce(
        state,
        act.saveEnded({
          generation: generation(s.stale),
          ...(s.error === undefined ? {} : { error: s.error }),
        }),
      );
    case "released":
      return reduce(
        state,
        act.saveReleased(s.error === undefined ? {} : { error: s.error }),
      );
    case "waits":
      return reduce(state, act.finishWaitsChanged({ waits: s.waits }));
    case "opened":
      return reduce(state, act.opened({ manifest: MANIFEST }));
    case "closed":
      return reduce(state, act.closed());
  }
}

describe("tour document: the save status under any mix of the pages' save actions", () => {
  // Why: the phone's Finish and the desktop's saves share these fields; a
  // single sequence that breaks one invariant is a status line that lies.
  it("keeps its invariants step by step", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        let state = open();
        for (const s of steps) {
          const before = state.save;
          state = apply(state, s);
          expect(broken(s, before, state.save)).toEqual([]);
        }
      }),
    );
  });
});

/** The invariants one step broke, by name (none: an empty list). */
function broken(
  s: Step,
  before: TourSaveStatus,
  save: TourSaveStatus,
): string[] {
  const out: string[] = [];
  const check = (name: string, holds: boolean): void => {
    if (!holds) out.push(name);
  };
  // The status is derived: saving exactly while the slot is held or a
  // rebuild is queued or runs, else error while one is said.
  check(
    "status derived",
    save.status ===
      (save.by !== null || save.rebuilds > 0
        ? "saving"
        : save.error === null
          ? "idle"
          : "error"),
  );
  // A progress line belongs to the slot holder.
  check(
    "no progress without the slot",
    save.by !== null || save.progress === null,
  );
  if (s.kind === "opened" || s.kind === "closed") {
    // The slot, its progress and a waiting Done are the page's.
    check("slot kept", save.by === before.by);
    check("progress kept", save.progress === before.progress);
    check("wait kept", save.finishWaits === before.finishWaits);
    check("error reset", save.error === null);
    check("rebuilds reset", save.rebuilds === 0);
  }
  if (s.kind === "claimed") {
    check("claimed by", save.by === s.by);
    check("claim clears progress", save.progress === null);
    // A save of the tour itself starts with no failure said. The
    // exception: a copy, or a linked tour's write ("open"), writes another
    // file, so the tour's last error stays said.
    check(
      "claim and the error",
      s.by === "copy" || s.by === "open"
        ? save.error === before.error
        : save.error === null,
    );
  }
  if (s.kind === "released") {
    check("released", save.by === null);
    check("release error", save.error === (s.error ?? before.error));
  }
  if (s.kind === "waits") {
    check(
      "waits alone",
      JSON.stringify(save) ===
        JSON.stringify({ ...before, finishWaits: s.waits }),
    );
  }
  if (s.kind === "progressed") {
    // Progress never changes whether or why the tour is saving.
    check("progress keeps status", save.status === before.status);
    check("progress keeps error", save.error === before.error);
  }
  if (s.kind !== "waits" && s.kind !== "opened" && s.kind !== "closed") {
    check("wait untouched", save.finishWaits === before.finishWaits);
  }
  return out;
}
