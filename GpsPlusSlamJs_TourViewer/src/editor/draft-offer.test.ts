/**
 * The desktop editor's draft offer (`draft-offer.ts`): its three answers
 * on the store's real edit gate.
 *
 * Why this suite matters: the offer's answers decide what happens to an
 * edit that waited for them, and "Delete it" runs storage work the creator
 * expects to land (async-ui-feedback). These rows pin, without a DOM:
 * Restore drops a waiting edit and says so (replaying it would write its
 * old values over the restored draft); "Delete it" shows its progress,
 * reverts on failure with the question kept, and replays the waiting
 * edits on success; "Not now" drops a waiting edit and says so; and a
 * re-show while "Delete it" runs keeps the answers off.
 */
import { describe, expect, it } from "vitest";
import type { TourPin } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  DRAFT_EDIT_MAKE_AGAIN,
  DRAFT_EDIT_NOT_APPLIED,
  DRAFT_EDIT_WAITS,
  isHeldEdit,
} from "../draft-edit-gate.js";
import { tourOf } from "../test-support/tour-of.js";
import {
  documentObjects,
  selectTourDocument,
  tourDocumentActions,
} from "../tour-document.js";
import { selectTourDraft, tourDraftActions } from "../tour-draft-slice.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { createDraftOffer, type DraftOfferView } from "./draft-offer.js";

function pin(id: string, caption = `pin ${id}`): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption,
    createdAtIso: "2026-11-21T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

function setup(discard: () => Promise<boolean> = () => Promise.resolve(true)) {
  const store = createTourViewerStore();
  store.dispatch(tourDocumentActions.opened({ manifest: tourOf([pin("a")]) }));
  // The page starts the question when it reads the draft (`edit-main.ts`).
  store.dispatch(tourDraftActions.readStarted());
  const question = selectTourDraft(store.getState()).generation;
  const views: (DraftOfferView | null)[] = [];
  const said: { text: string; error: boolean }[] = [];
  const changes: { count: number; restored: boolean }[] = [];
  let current = true;
  const offer = createDraftOffer({
    store,
    question,
    text: "1 earlier change is on this device.",
    render: (view) => views.push(view),
    say: (text, error = false) => said.push({ text, error }),
    current: () => current,
    restore: () => {
      store.dispatch(
        tourDocumentActions.restored({
          objects: [pin("a", "From the draft")],
          deleted: [],
          what: "the restored draft",
        }),
      );
      return { count: 1, line: "1 earlier change is back - not saved yet." };
    },
    discard,
    discardFailed: "Could not delete it.",
    changed: (count, restored) => changes.push({ count, restored }),
  });
  const caption = () => {
    const o = documentObjects(selectTourDocument(store.getState())).find(
      (e) => e.object.id === "a",
    )?.object;
    return o?.kind === "shortText" ? o.caption : null;
  };
  const edit = (text: string) =>
    store.dispatch(
      tourDocumentActions.edited({ object: pin("a", text), what: "the pin" }),
    );
  return {
    store,
    question,
    offer,
    views,
    said,
    changes,
    caption,
    edit,
    leave: () => {
      current = false;
    },
  };
}

describe("the desktop draft offer", () => {
  // Why: the offer shows at once, and the first edit shows it again with
  // words saying the edit waits; nothing of the edit is applied.
  it("shows the offer, and again with the waiting words at the first edit", () => {
    const { views, edit, caption } = setup();
    expect(views.at(-1)).toEqual({
      text: "1 earlier change is on this device.",
      deleting: false,
    });
    expect(isHeldEdit(edit("The gate"))).toBe(true);
    expect(views.at(-1)).toEqual({
      text: `1 earlier change is on this device. ${DRAFT_EDIT_WAITS}`,
      deleting: false,
    });
    expect(caption()).toBe("pin a");
  });

  // Why: a waiting edit was built from the document before the draft
  // came back; replayed after Restore it would put its old values over
  // the draft's. Restore drops it and says plainly that it was not
  // applied.
  it("Restore puts the draft back, drops the waiting edit and says so", () => {
    const { offer, views, said, changes, edit, caption, store } = setup();
    edit("The gate");
    offer.restore();
    expect(caption()).toBe("From the draft");
    expect(views.at(-1)).toBeNull();
    expect(said).toEqual([
      {
        text: `1 earlier change is back - not saved yet. ${DRAFT_EDIT_MAKE_AGAIN}`,
        error: false,
      },
    ]);
    expect(changes).toEqual([{ count: 1, restored: true }]);
    expect(store.draftGate.holding()).toBe(false);
    // Made again, it lands.
    expect(isHeldEdit(edit("The gate"))).toBe(false);
    expect(caption()).toBe("The gate");
  });

  // Why: with nothing waiting, Restore says only what came back.
  it("Restore with nothing waiting says only what came back", () => {
    const { offer, said } = setup();
    offer.restore();
    expect(said.map((s) => s.text)).toEqual([
      "1 earlier change is back - not saved yet.",
    ]);
  });

  // Why: "Not now" applies nothing; a waiting edit is cancelled and the
  // page says so, and the next edit asks again.
  it("Not now drops the waiting edit, says so, and the next edit asks again", () => {
    const { offer, views, said, edit, caption } = setup();
    offer.notNow();
    expect(said).toEqual([]);
    edit("The gate");
    offer.notNow();
    expect(views.at(-1)).toBeNull();
    expect(said.map((s) => s.text)).toEqual([DRAFT_EDIT_NOT_APPLIED]);
    expect(caption()).toBe("pin a");
    edit("The well");
    expect(views.at(-1)?.text).toContain(DRAFT_EDIT_WAITS);
  });

  // Why (async-ui-feedback): "Delete it" shows its progress (every answer
  // off) until the removal says how it went; a landed one hides the offer
  // and lets the waiting edit through, built from the state that stays.
  it("Delete it shows its progress, then replays the waiting edit", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const { offer, views, changes, edit, caption } = setup(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    edit("The gate");
    const running = offer.deleteIt();
    expect(views.at(-1)?.deleting).toBe(true);
    // A second answer meanwhile does nothing.
    offer.restore();
    offer.notNow();
    expect(views.at(-1)?.deleting).toBe(true);
    finish(true);
    await running;
    expect(views.at(-1)).toBeNull();
    expect(caption()).toBe("The gate");
    expect(changes).toEqual([{ count: 1, restored: false }]);
  });

  // Why (async-ui-feedback): a removal that did not land reverts the
  // progress, is said as an error, and keeps the question: the edit still
  // waits, unapplied.
  it("a Delete it that fails turns the answers back on, says so, and keeps the edit waiting", async () => {
    const { offer, views, said, edit, caption, store } = setup(() =>
      Promise.resolve(false),
    );
    edit("The gate");
    await offer.deleteIt();
    expect(views.at(-1)).toEqual({
      text: `1 earlier change is on this device. ${DRAFT_EDIT_WAITS}`,
      deleting: false,
    });
    expect(said).toEqual([{ text: "Could not delete it.", error: true }]);
    expect(caption()).toBe("pin a");
    expect(store.draftGate.waiting()).toBe(true);
  });

  // Why: an edit made while "Delete it" runs shows the offer again; that
  // re-show must keep the answers off, or a second answer could race the
  // first.
  it("a re-show while Delete it runs keeps the answers off", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const { offer, views, edit } = setup(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const running = offer.deleteIt();
    edit("The gate");
    expect(views.at(-1)).toEqual({
      text: `1 earlier change is on this device. ${DRAFT_EDIT_WAITS}`,
      deleting: true,
    });
    finish(true);
    await running;
  });

  // Why: the offer IS the store's draft question (the store plan's
  // `tourDraft`): its status moves with each answer, and the view is
  // drawn from it - a put-off offer asked about again elsewhere (the phone
  // page's AR start, an edit) shows here without this module's help.
  it("is the store's draft question: each answer moves its status, and the view follows it", () => {
    const { store, question, offer, views } = setup();
    const draft = () => selectTourDraft(store.getState());
    expect(draft()).toMatchObject({
      status: "offered",
      text: "1 earlier change is on this device.",
    });
    offer.notNow();
    expect(draft().status).toBe("declined");
    expect(views.at(-1)).toBeNull();
    store.dispatch(tourDraftActions.reshown({ generation: question }));
    expect(views.at(-1)).toEqual({
      text: "1 earlier change is on this device.",
      deleting: false,
    });
    offer.restore();
    expect(draft().status).toBe("restored");
  });

  // Why: a read of the next tour starts a new question; the old offer goes
  // from the screen, and its answers change nothing any more.
  it("goes when the next tour's draft is read, and its answers do nothing then", async () => {
    const { store, offer, views, changes, edit } = setup();
    edit("The gate");
    store.dispatch(tourDraftActions.readStarted());
    expect(views.at(-1)).toBeNull();
    offer.restore();
    offer.notNow();
    await offer.deleteIt();
    expect(views.at(-1)).toBeNull();
    expect(changes).toEqual([]);
    expect(selectTourDraft(store.getState()).status).toBe("reading");
  });

  // Why: an answer for a tour the page has left does nothing to the one
  // open now.
  it("an answer after the tour was left only hides the offer", async () => {
    const { offer, views, changes, leave } = setup();
    leave();
    offer.restore();
    await offer.deleteIt();
    expect(views.at(-1)).toBeNull();
    expect(changes).toEqual([]);
  });
});
