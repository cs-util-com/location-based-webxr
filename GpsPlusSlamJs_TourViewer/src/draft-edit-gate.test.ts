/**
 * The edit gate a page's draft question runs on (`draft-edit-gate.ts`):
 * while a draft is undecided, an edit of the tour document waits for the
 * creator's answer instead of landing on top of it.
 *
 * Why this suite matters: "no edit ever lands on top of an undecided
 * draft" is what lets both drafts drop the rules that carried undecided
 * poses and stations through live writes. These rows pin the gate alone,
 * on the real store, so a page's rows can trust it: what is held, what
 * passes, the order a release replays in, and that a held edit is never
 * applied before the answer.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TourPin } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  DRAFT_EDIT_MAKE_AGAIN,
  DRAFT_EDIT_WAITS_IN_AR,
  DRAFT_GATE_PASSES,
  draftEditsMakeAgain,
  isHeldEdit,
  waitsForTheDraft,
} from "./draft-edit-gate.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  documentObjects,
  selectTourDocument,
  tourDocumentActions,
} from "./tour-document.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

function pin(id: string): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: `pin ${id}`,
    createdAtIso: "2026-11-21T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

function openStore() {
  const store = createTourViewerStore();
  store.dispatch(
    tourDocumentActions.opened({ manifest: tourOf([pin("a"), pin("b")]) }),
  );
  return store;
}

const objectOf = (
  state: ReturnType<ReturnType<typeof openStore>["getState"]>,
  id: string,
) =>
  documentObjects(selectTourDocument(state)).find((o) => o.object.id === id)
    ?.object;

const captionOf = (store: ReturnType<typeof openStore>, id: string) => {
  const object = objectOf(store.getState(), id);
  return object?.kind === "shortText" ? object.caption : null;
};

const editA = (caption: string) =>
  tourDocumentActions.edited({
    object: { ...pin("a"), caption },
    what: "the pin",
  });

describe("draft edit gate", () => {
  // Why: an open gate must be invisible, or every page would pay for it.
  it("lets every edit through while nothing is held", () => {
    const store = openStore();
    const out = store.dispatch(editA("The gate"));
    expect(isHeldEdit(out)).toBe(false);
    expect(captionOf(store, "a")).toBe("The gate");
  });

  // Why: the first edit of an undecided draft asks once and waits; a
  // second edit while that question stands waits behind it, unasked.
  it("holds an edit while holding, asks once per wait, and applies nothing", () => {
    const store = openStore();
    let asked = 0;
    store.draftGate.hold(() => {
      asked += 1;
    });
    const revision = selectTourDocument(store.getState()).revision;
    const first = store.dispatch(editA("The gate"));
    const second = store.dispatch(editA("The well"));
    expect(isHeldEdit(first)).toBe(true);
    expect(isHeldEdit(second)).toBe(true);
    expect(asked).toBe(1);
    expect(store.draftGate.waiting()).toBe(true);
    expect(selectTourDocument(store.getState()).revision).toBe(revision);
    expect(captionOf(store, "a")).toBe("pin a");
  });

  // Why: the answer's own steps (a Restore) and steps that change no
  // work (an undo with nothing done, a save's bookkeeping) are not edits
  // waiting for it; holding them would deadlock the answer itself.
  it("lets a restore, an undo and non-edit actions through while holding", () => {
    const store = openStore();
    store.draftGate.hold(() => undefined);
    expect(
      isHeldEdit(
        store.dispatch(
          tourDocumentActions.restored({
            objects: [{ ...pin("a"), caption: "Restored" }],
            deleted: [],
            what: "the restored draft",
          }),
        ),
      ),
    ).toBe(false);
    expect(captionOf(store, "a")).toBe("Restored");
    expect(isHeldEdit(store.dispatch(tourDocumentActions.undone()))).toBe(
      false,
    );
    expect(store.draftGate.waiting()).toBe(false);
  });

  // Why: Restore and "Delete it" apply the waiting edits after the
  // draft's own change, in the order they were made, each as its own
  // dispatch (so the draft's listener backs each one up).
  it("release replays the held edits in order and stops holding", async () => {
    const store = openStore();
    store.draftGate.hold(() => undefined);
    const first = store.dispatch(editA("The gate"));
    store.dispatch(editA("The well"));
    expect(store.draftGate.release()).toBe(2);
    expect(captionOf(store, "a")).toBe("The well");
    expect(store.draftGate.holding()).toBe(false);
    if (!isHeldEdit(first)) throw new Error("not held");
    const landed = await first.landed;
    expect(landed).not.toBeNull();
    expect(
      objectOf(
        (landed as { before: ReturnType<typeof store.getState> }).before,
        "a",
      ),
    ).toMatchObject({ caption: "pin a" });
    // From now on edits pass: no question comes again.
    expect(isHeldEdit(store.dispatch(editA("Later")))).toBe(false);
  });

  // Why: "Not now" on the question applies nothing; the draft is still
  // undecided, so the next edit asks again.
  it("drop forgets the held edits and keeps holding: the next edit asks again", async () => {
    const store = openStore();
    let asked = 0;
    store.draftGate.hold(() => {
      asked += 1;
    });
    const held = store.dispatch(editA("The gate"));
    expect(store.draftGate.drop()).toBe(1);
    if (!isHeldEdit(held)) throw new Error("not held");
    expect(await held.landed).toBeNull();
    expect(captionOf(store, "a")).toBe("pin a");
    expect(store.draftGate.holding()).toBe(true);
    store.dispatch(editA("The well"));
    expect(asked).toBe(2);
    expect(store.draftGate.release()).toBe(1);
    expect(captionOf(store, "a")).toBe("The well");
  });

  // Why: a tour that closes or another that opens ends the question with
  // it; an edit held for the closed tour must never land in the next.
  it("an open or a close of the document drops the held edits and stops holding", async () => {
    const store = openStore();
    store.draftGate.hold(() => undefined);
    const held = store.dispatch(editA("The gate"));
    store.dispatch(tourDocumentActions.closed());
    if (!isHeldEdit(held)) throw new Error("not held");
    expect(await held.landed).toBeNull();
    expect(store.draftGate.holding()).toBe(false);
    expect(store.draftGate.release()).toBe(0);
  });

  // Why: both pages say an edit waits from the store (`tourDraft`), not
  // from a flag of their own; the gate is the one place that knows, so it
  // reports its count there - before it asks, so the question already
  // reads it - and every way a wait ends puts it back to zero.
  it("reports how many edits wait in the store's draft question", () => {
    const store = openStore();
    const waiting = () => store.getState().tourDraft.editsWaiting;
    const seen: number[] = [];
    store.draftGate.hold(() => seen.push(waiting()));
    store.dispatch(editA("One"));
    store.dispatch(editA("Two"));
    expect(seen).toEqual([1]);
    expect(waiting()).toBe(2);
    store.draftGate.drop();
    expect(waiting()).toBe(0);
    store.dispatch(editA("Three"));
    expect(waiting()).toBe(1);
    store.draftGate.release();
    expect(waiting()).toBe(0);
    store.draftGate.hold(() => undefined);
    store.dispatch(editA("Four"));
    store.dispatch(tourDocumentActions.closed());
    expect(waiting()).toBe(0);
  });

  // Why: the property behind the pages' rule, on the gate alone: for any
  // interleaving of edits, put-offs and an answer, nothing is applied
  // before the answer, and after it the document is what the edits made
  // since the last put-off would make, in order.
  it("for random edits and put-offs, nothing lands before the answer and the last batch lands in order", () => {
    const step = fc.oneof(
      fc.record({
        kind: fc.constant("edit" as const),
        caption: fc.constantFrom("x", "y", "z"),
      }),
      fc.constant({ kind: "drop" as const }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 8 }), (steps) => {
        const store = openStore();
        store.draftGate.hold(() => undefined);
        const revision = selectTourDocument(store.getState()).revision;
        let batch: string[] = [];
        for (const s of steps) {
          if (s.kind === "drop") {
            store.draftGate.drop();
            batch = [];
          } else {
            store.dispatch(editA(s.caption));
            batch.push(s.caption);
          }
          expect(selectTourDocument(store.getState()).revision).toBe(revision);
        }
        expect(store.draftGate.release()).toBe(batch.length);
        expect(captionOf(store, "a")).toBe(batch.at(-1) ?? "pin a");
      }),
    );
  });
  // Why: the gate classifies by a DENYLIST, so an action added to the
  // document later waits by default. This row walks every action the
  // document has and fails on one nobody classified: a new action must be
  // named here as held, or in `DRAFT_GATE_PASSES` with a reason. Three
  // edits once slipped past an allowlist (a file use deleted, a file
  // replaced, an asset optimized) and landed on an undecided draft.
  it("classifies every action of the document: each is held, or named as passing", () => {
    const HELD = [
      "placed",
      "edited",
      "moved",
      "deleted",
      "stationMoved",
      "stationEdited",
      "storyAdded",
      "storyRenamed",
      "storyDuplicated",
      "storiesPasted",
      "storyDeleted",
      "storyChildAdded",
      "storyChildDeleted",
      "fileUsesDeleted",
      "fileReplaced",
      "childMoved",
      "childrenMoved",
      "stationAdded",
      "stationDeleted",
      "stationsReordered",
      "stationDuplicated",
      "stationsPasted",
      "objectDuplicated",
      "itemsGrounded",
      "blockNumberSet",
      "settleApplied",
      "settingsChanged",
      "detailsChanged",
      "narrationEdited",
      "assetOptimized",
      "folderMoved",
      "folderScaled",
      "folderPivotCentred",
      "folderGrouped",
      "folderUngrouped",
      "objectsFoldered",
      "folderRenamed",
      "folderDeleted",
      "folderDuplicated",
      "clipboardPasted",
      "folderReordered",
      "characterDeclared",
      "characterRemoved",
    ].map((name) => `tourDocument/${name}`);
    const all = Object.values(tourDocumentActions).map((a) => a.type);
    const passes = [...DRAFT_GATE_PASSES];
    expect(
      HELD.filter((t) => passes.includes(t)),
      "both held and passing",
    ).toEqual([]);
    expect(
      all.filter((t) => !HELD.includes(t) && !passes.includes(t)),
      "an action nobody classified",
    ).toEqual([]);
    expect(
      [...HELD, ...passes].filter((t) => !all.includes(t)),
      "a name the document does not have",
    ).toEqual([]);
    for (const type of all) {
      expect(waitsForTheDraft({ type }), type).toBe(HELD.includes(type));
    }
  });

  // Why: the edits an allowlist let through must wait too: dispatched on
  // a holding store, each is held, and the first asks.
  it("holds a file use deleted, a file replaced and an asset optimized", () => {
    const store = openStore();
    let asked = 0;
    store.draftGate.hold(() => {
      asked += 1;
    });
    for (const type of [
      tourDocumentActions.fileUsesDeleted.type,
      tourDocumentActions.fileReplaced.type,
      tourDocumentActions.assetOptimized.type,
    ]) {
      expect(isHeldEdit(store.dispatch({ type, payload: {} })), type).toBe(
        true,
      );
    }
    expect(asked).toBe(1);
    expect(store.draftGate.drop()).toBe(3);
  });

  // Why: an undo or a redo passes the gate. That is safe only because
  // nothing of this open is in the history while the draft is undecided:
  // the open clears it, every edit waits, and no passing action takes a
  // step. Pinned: an undo and a redo then change nothing, so the
  // document's listener writes nothing over the undecided record.
  it("an undo or a redo while undecided changes nothing", () => {
    const store = openStore();
    store.draftGate.hold(() => undefined);
    store.dispatch(editA("The gate"));
    store.dispatch({
      type: tourDocumentActions.fileReplaced.type,
      payload: {},
    });
    store.dispatch(tourDocumentActions.newStationArmed({ armed: true }));
    store.dispatch(tourDocumentActions.newStationArmed({ armed: false }));
    const before = selectTourDocument(store.getState());
    expect(isHeldEdit(store.dispatch(tourDocumentActions.undone()))).toBe(
      false,
    );
    expect(isHeldEdit(store.dispatch(tourDocumentActions.redone()))).toBe(
      false,
    );
    expect(selectTourDocument(store.getState())).toEqual(before);
    expect(store.draftGate.drop()).toBe(2);
  });
});

describe("the words after an answer dropped waiting edits", () => {
  // Why: Restore says the dropped work must be made again; with more than
  // one change dropped, "your last change" undersells the loss.
  it("says change for one and changes for more", () => {
    expect(draftEditsMakeAgain(1)).toBe(DRAFT_EDIT_MAKE_AGAIN);
    expect(draftEditsMakeAgain(3)).toBe(
      "Your last changes were not applied - make them again.",
    );
  });

  // Why: in AR the offer is out of sight, and a creator who leaves AR and
  // taps Restore loses what was made in AR; the line must say so first.
  it("tells the creator in AR that Restore drops what was made there", () => {
    expect(DRAFT_EDIT_WAITS_IN_AR).toMatch(/Restore/);
    expect(DRAFT_EDIT_WAITS_IN_AR).toMatch(/made in AR/);
  });
});
