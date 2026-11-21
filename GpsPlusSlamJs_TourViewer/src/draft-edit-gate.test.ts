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

import { isHeldEdit } from "./draft-edit-gate.js";
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
    store.draftGate.drop();
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
});
