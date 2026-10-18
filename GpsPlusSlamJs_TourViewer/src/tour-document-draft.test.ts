/**
 * Why these tests matter: a page's draft is what brings a creator's work
 * back after a closed tab, and it now follows the tour document's STATE
 * rather than each gesture. These pin that the state-diff writes exactly
 * what the gestures' own writes did (`draft-actions.ts`): a tombstone for
 * a written object, a forgotten record for one only this page had, and on
 * an undo the record BEFORE its tombstone goes - so an undo cut short
 * leaves the object deleted, never half restored. Nothing is written for
 * a save, and nothing across an open.
 */

import { describe, expect, it } from "vitest";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  followDocument,
  settingsRecord,
  type TourDocumentDraft,
} from "./tour-document-draft.js";
import {
  documentObjects,
  initialTourDocumentState,
  isDocumentEdit,
  selectTourDocument,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";
import { tourOf } from "./test-support/v3-tour.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

function pin(id: string, label = `pin ${id}`): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

/** A draft that records the writes in the order they were issued. */
function recordingDraft(): { draft: TourDocumentDraft; calls: string[] } {
  const calls: string[] = [];
  const ok = (call: string) => {
    calls.push(call);
    return Promise.resolve(true);
  };
  return {
    calls,
    draft: {
      saveObject: (object, blob) =>
        ok(`saveObject ${object.id}${blob === undefined ? "" : " +picture"}`),
      saveDeletion: (id) => ok(`saveDeletion ${id}`),
      forgetDeletion: (id) => ok(`forgetDeletion ${id}`),
      forgetObject: (id) => {
        calls.push(`forgetObject ${id}`);
        return Promise.resolve();
      },
      saveSettings: (settings) =>
        ok(`saveSettings ${JSON.stringify(settings)}`),
    },
  };
}

const opened = reduce(
  initialTourDocumentState,
  act.opened({ manifest: tourOf([pin("a"), pin("b")]) }),
);

/** The writes the draft gets for the step from `before` by `actions`. */
function writesFor(
  before: TourDocumentState,
  ...actions: Parameters<typeof reduce>[1][]
): { after: TourDocumentState; calls: string[] } {
  const { draft, calls } = recordingDraft();
  let state = before;
  for (const action of actions) {
    const next = reduce(state, action);
    followDocument(draft, state, next, (id) =>
      id === "p" ? new Blob(["p"]) : undefined,
    );
    state = next;
  }
  return { after: state, calls };
}

describe("followDocument", () => {
  it("an edit writes the record; the same content again writes nothing", () => {
    const edit = act.edited({ object: pin("a", "new"), what: "e" });
    const { after, calls } = writesFor(opened, edit, edit);
    expect(calls).toEqual(["saveObject a"]);
    expect(after.placed).toHaveLength(1);
  });

  it("a written object's delete is a tombstone; a new one's forgets its record", () => {
    const placed = writesFor(
      opened,
      act.placed({ object: pin("n"), what: "p" }),
      act.deleted({ id: "n", what: "d" }),
      act.deleted({ id: "a", what: "d" }),
    );
    expect(placed.calls).toEqual([
      "saveObject n",
      "forgetObject n",
      "saveDeletion a",
    ]);
  });

  it("an undo of an edited object's delete writes the record before the tombstone goes", () => {
    const { after: edited } = writesFor(
      opened,
      act.edited({ object: pin("a", "new"), what: "e" }),
    );
    const { calls } = writesFor(
      edited,
      act.deleted({ id: "a", what: "d" }),
      act.undone(),
    );
    expect(calls).toEqual([
      "saveDeletion a",
      "saveObject a",
      "forgetDeletion a",
    ]);
  });

  it("a photo's picture the page holds goes with its record", () => {
    const photo: TourObject = {
      id: "p",
      kind: "photo",
      image: "content/p.jpg",
      imageWidth: 4,
      imageHeight: 3,
      createdAtIso: "2026-10-18T00:00:00.000Z",
      geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
    };
    const { calls } = writesFor(
      opened,
      act.placed({ object: photo, what: "p" }),
    );
    expect(calls).toEqual(["saveObject p +picture"]);
  });

  it("the settings record follows the setting and, once set, the details", () => {
    const { calls } = writesFor(
      opened,
      act.settingsChanged({ needsNoGps: true, what: "s" }),
      act.detailsChanged({ details: { title: "T" }, what: "d" }),
      act.undone(),
    );
    expect(calls).toEqual([
      'saveSettings {"needsNoGps":true}',
      'saveSettings {"needsNoGps":true,"details":{"title":"T"}}',
      'saveSettings {"needsNoGps":true,"details":{}}',
    ]);
  });

  it("follows the edits only: a save landing or an open is not one, and nothing is written across an open", () => {
    expect(isDocumentEdit(act.edited({ object: pin("a"), what: "e" }))).toBe(
      true,
    );
    expect(isDocumentEdit(act.undone())).toBe(true);
    // A landed save takes entries off the pending list: read as an edit,
    // that would forget their records.
    expect(
      isDocumentEdit(
        act.saved({
          generation: 1,
          written: opened.written!,
          appliedDeletions: [],
          stationsAtStart: [],
        }),
      ),
    ).toBe(false);
    expect(isDocumentEdit(act.opened({ manifest: opened.written! }))).toBe(
      false,
    );
    const { after } = writesFor(
      opened,
      act.edited({ object: pin("a", "new"), what: "e" }),
    );
    const { draft, calls } = recordingDraft();
    followDocument(
      draft,
      after,
      reduce(after, act.opened({ manifest: tourOf([pin("z")]) })),
      () => undefined,
    );
    expect(calls).toEqual([]);
  });

  it("names the settings record's shape", () => {
    expect(settingsRecord(opened)).toEqual({ needsNoGps: false });
    expect(documentObjects(opened).map((o) => o.object.id)).toEqual(["a", "b"]);
  });
});

describe("the Tour Viewer store and the document", () => {
  // The store every page builds holds the document, and its listener runs
  // after the reducer with both states at hand - what a page's draft needs
  // to follow it; nothing of it reaches the phone's recording.
  it("mounts the document and lets a page follow its edits", () => {
    const store = createTourViewerStore();
    expect(selectTourDocument(store.getState())).toEqual(
      initialTourDocumentState,
    );
    const { draft, calls } = recordingDraft();
    const stop = store.listenToDocument({
      predicate: isDocumentEdit,
      effect: (_action, api) => {
        followDocument(
          draft,
          selectTourDocument(api.getOriginalState()),
          selectTourDocument(api.getState()),
          () => undefined,
        );
      },
    });
    store.dispatch(act.opened({ manifest: tourOf([pin("a")]) }));
    store.dispatch(act.edited({ object: pin("a", "new"), what: "e" }));
    expect(calls).toEqual(["saveObject a"]);
    stop();
    store.dispatch(act.deleted({ id: "a", what: "d" }));
    expect(calls).toEqual(["saveObject a"]);
  });
});
