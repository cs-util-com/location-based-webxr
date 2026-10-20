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
  parseSettingsRecord,
  settingsRecord,
  type TourDocumentDraft,
} from "./tour-document-draft.js";
import {
  documentObjects,
  initialTourDocumentState,
  isDocumentEdit,
  manifestToWrite,
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
    // (An object the written file lacks also forgets any tombstone of its
    // id - for a new one a no-op; see the undo across a save below.)
    expect(placed.calls).toEqual([
      "saveObject n",
      "forgetDeletion n",
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

  it("an undo of a delete a save already wrote forgets its tombstone after the record (review HIGH-1)", () => {
    // Why: the save takes the id out of the document's deletions but not
    // the draft's tombstone, so the undo that brings it back must forget
    // it - or a later restore deletes the object again.
    const { after: deleted } = writesFor(
      opened,
      act.deleted({ id: "a", what: "d" }),
    );
    // The save landing is not an edit: the draft does not follow it.
    expect(isDocumentEdit(act.saved({} as never))).toBe(false);
    const saved = reduce(
      deleted,
      act.saved({
        generation: deleted.generation,
        written: manifestToWrite(deleted)!,
        appliedDeletions: ["a"],
        stationsAtStart: deleted.stations,
      }),
    );
    expect(saved.deleted).toEqual([]);
    const { calls } = writesFor(saved, act.undone());
    // (The undo also brings back the station the save dropped with its
    // last item, so the settings record follows; not this test's point.)
    expect(calls.filter((c) => !c.startsWith("saveSettings"))).toEqual([
      "saveObject a",
      "forgetDeletion a",
    ]);
  });

  it("a redo of a delete a save already wrote writes its tombstone again", () => {
    // Why (the r880 fix re-review, L1): a download leaves the draft
    // standing (no in-place write landed), and the file a reload opens is
    // the OPENED one, which still holds the object. Delete, save, undo,
    // redo used to forget the undo's record and leave no tombstone, so the
    // reload brought the deleted object back.
    const { after: deleted } = writesFor(
      opened,
      act.deleted({ id: "a", what: "d" }),
    );
    const saved = reduce(
      deleted,
      act.saved({
        generation: deleted.generation,
        written: manifestToWrite(deleted)!,
        appliedDeletions: ["a"],
        stationsAtStart: deleted.stations,
      }),
    );
    const { calls } = writesFor(saved, act.undone(), act.redone());
    expect(calls.filter((c) => !c.startsWith("saveSettings"))).toEqual([
      "saveObject a",
      "forgetDeletion a",
      "saveDeletion a",
    ]);
  });

  it("a new object the written file lacks forgets its record when it goes", () => {
    // The other side of the rule above: an object the opened file never
    // held has nothing for a reload to bring back, so no tombstone.
    const { calls } = writesFor(
      opened,
      act.placed({ object: pin("n"), what: "p" }),
      act.undone(),
    );
    expect(calls).toEqual([
      "saveObject n",
      "forgetDeletion n",
      "forgetObject n",
    ]);
  });

  it("a first edit of a written object writes its record only", () => {
    const { calls } = writesFor(
      opened,
      act.edited({ object: pin("b", "new"), what: "e" }),
    );
    expect(calls).toEqual(["saveObject b"]);
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
    expect(calls).toEqual(["saveObject p +picture", "forgetDeletion p"]);
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

/**
 * Why (the r875 milestone review #1): the settings record is what brings
 * a moved station back after a reload, so a frame's move must write it -
 * with every station's pose - and a record that never saw a move carries
 * no opinion about the stations.
 */
describe("followDocument, the station poses (review #1)", () => {
  it("a station move writes the settings record with every station's pose; before any, it carries none", () => {
    expect(settingsRecord(opened)).toEqual({ needsNoGps: false });
    const station = opened.stations[0]!;
    const geo = { ...station.geo, lat: station.geo.lat + 0.0001 };
    const { after, calls } = writesFor(
      opened,
      act.stationMoved({ stationId: station.id, geo, what: "s" }),
    );
    expect(settingsRecord(after)).toEqual({
      needsNoGps: false,
      stations: after.stations.map(({ id, geo: pose }) => ({ id, geo: pose })),
    });
    expect(settingsRecord(after).stations?.[0]?.geo).toEqual(geo);
    expect(calls.filter((c) => c.startsWith("saveSettings"))).toHaveLength(1);
  });
});

/**
 * Why: a station the station rule started is the document's from that
 * moment, and the objects' records only name it. The settings record keeps
 * its whole frame, so a reload brings the station back where it stood -
 * and a record whose frames do not read loses only them (the objects that
 * named them are seated by the rule), never the setting beside them.
 */
describe("followDocument, the stations this page created", () => {
  const far: TourObject = {
    ...pin("far"),
    geo: { lat: 48.53, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };

  it("a placement that starts a station writes its whole frame; one that joins a station writes none", () => {
    const joined = writesFor(
      opened,
      act.placed({ object: pin("near"), what: "p", newStationId: "unused" }),
    );
    expect(settingsRecord(joined.after)).toEqual({ needsNoGps: false });
    expect(joined.calls.filter((c) => c.startsWith("saveSettings"))).toEqual(
      [],
    );
    const started = writesFor(
      opened,
      act.placed({ object: far, what: "p", newStationId: "made" }),
    );
    const record = settingsRecord(started.after);
    expect(record.createdStations).toEqual([
      started.after.stations.find((f) => f.id === "made"),
    ]);
    expect(
      started.calls.filter((c) => c.startsWith("saveSettings")),
    ).toHaveLength(1);
    // Read back from disk as the frame it was.
    expect(parseSettingsRecord(JSON.stringify(record))).toEqual(record);
  });

  // Why: the created frames were read as one list, so one broken frame
  // (a hand-edited record, a frame of a newer build) lost every station
  // this browser made, and the objects in them were seated anew.
  it("a broken created frame among good ones costs only itself; a repeated id keeps the first", () => {
    const started = writesFor(
      opened,
      act.placed({ object: far, what: "p", newStationId: "made" }),
    );
    const frame = settingsRecord(started.after).createdStations![0]!;
    const other = { ...frame, id: "made2", next: "made" };
    const record = {
      needsNoGps: false,
      createdStations: [
        frame,
        { ...frame, id: "broken", foundRadiusM: -1 },
        other,
        { ...frame, id: "made", title: "A second made" },
      ],
    };
    expect(parseSettingsRecord(JSON.stringify(record))).toEqual({
      needsNoGps: false,
      createdStations: [frame, other],
    });
  });

  it("a record whose created frames do not read keeps the rest", () => {
    const started = writesFor(
      opened,
      act.placed({ object: far, what: "p", newStationId: "made" }),
    );
    const record = settingsRecord(started.after);
    const broken = {
      ...record,
      createdStations: [{ ...record.createdStations![0]!, foundRadiusM: -1 }],
    };
    expect(parseSettingsRecord(JSON.stringify(broken))).toEqual({
      needsNoGps: false,
    });
    expect(
      parseSettingsRecord(
        JSON.stringify({ ...record, createdStations: "not a list" }),
      ),
    ).toEqual({ needsNoGps: false });
  });
});
