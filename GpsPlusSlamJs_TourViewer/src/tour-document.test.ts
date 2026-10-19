/**
 * Why these tests matter: the tour document is the ONE copy of the tour a
 * page edits (D29-D31). Each rule here is one the pages used to keep in
 * their own variables and disagreed on: what is pending against the file
 * as last written (by content), what an undo goes back to after a save
 * (the history keeps views, so an undo is measured against the NEW file),
 * a station's frame moving its items rigidly (D17), a save landing while
 * edits continue (they stay pending), and a late save of a tour opened
 * since never landing in the new one.
 */

import { describe, expect, it } from "vitest";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { TOUR_ITEM_MAX_OFFSET_M } from "gps-plus-slam-app-framework/ar/tour-items";
import {
  canPlace,
  canStep,
  changeCount,
  documentObjects,
  effectiveDetails,
  framesOf,
  initialTourDocumentState,
  manifestNow,
  manifestToWrite,
  objectFits,
  objectMoveChange,
  picturesNeeded,
  pinTextChange,
  TOUR_HISTORY_LIMIT,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  unsavedEntries,
  viewOf,
  type TourDocumentState,
} from "./tour-document.js";
import { stationIdOf, tourOf } from "./test-support/v3-tour.js";

function pin(id: string, label = `pin ${id}`, lat = 48.52): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

function photo(id: string, lat = 48.5201): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

const OPENED: TourManifest = tourOf([
  pin("a"),
  pin("b", "pin b", 48.5202),
  photo("f"),
]);

function open(manifest: TourManifest = OPENED): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest }));
}

function objectOf(state: TourDocumentState, id: string): TourObject {
  const found = documentObjects(state).find((o) => o.object.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found.object;
}

/** What a save that landed leaves: the manifest the state writes. */
function save(state: TourDocumentState): TourDocumentState {
  const written = manifestToWrite(state);
  if (written === null) throw new Error("nothing open");
  return reduce(
    state,
    act.saved({
      generation: state.generation,
      written,
      appliedDeletions: [...state.deleted],
      stationsAtStart: state.stations,
    }),
  );
}

describe("tour document: the open", () => {
  it("starts from the opened tour: its frames, setting and details, nothing pending", () => {
    const state = open(
      tourOf([pin("a")], { title: "Old town", needsNoGps: true }),
    );
    expect(state.generation).toBe(1);
    expect(state.stations.map((s) => s.id)).toEqual([stationIdOf("a")]);
    expect(state.needsNoGps).toBe(true);
    expect(state.details).toEqual({ title: "Old town" });
    expect(changeCount(state)).toBe(0);
    expect(manifestNow(state)).toEqual(state.opened);
  });

  it("forgets the previous tour entirely on a new open", () => {
    let state = open();
    state = reduce(
      state,
      act.edited({ object: { ...pin("a"), label: "x" }, what: "e" }),
    );
    state = reduce(state, act.opened({ manifest: tourOf([pin("z")]) }));
    expect(state.generation).toBe(2);
    expect(state.placed).toEqual([]);
    expect(state.past).toEqual([]);
    expect(documentObjects(state).map((o) => o.object.id)).toEqual(["z"]);
  });
});

describe("tour document: edits and their history", () => {
  it("an edit is pending by content: edited back to the file's own is no change", () => {
    let state = open();
    const a = objectOf(state, "a");
    state = reduce(
      state,
      act.edited({ object: { ...a, label: "new" }, what: "the text" }),
    );
    expect(changeCount(state)).toBe(1);
    state = reduce(state, act.edited({ object: a, what: "the text" }));
    expect(changeCount(state)).toBe(0);
    expect(state.past.map((s) => s.what)).toEqual(["the text", "the text"]);
  });

  it("putting a pending object again with the same content is no step (the review's LOW-2)", () => {
    // Why: the AR settle re-poses every object of a visit, moved or not; a
    // re-pose that changes nothing must not cost a step - it would withdraw
    // a delete's Undo and bury the creator's last change one step deeper.
    let state = open();
    const a = objectOf(state, "a");
    const moved = { ...a, label: "new" };
    state = reduce(state, act.edited({ object: moved, what: "the text" }));
    const before = state;
    state = reduce(
      state,
      act.moved({ object: { ...moved }, what: "a settle" }),
    );
    expect(state).toBe(before);
    expect(state.past.map((s) => s.what)).toEqual(["the text"]);
  });

  it("undo goes back to the view before the edit, redo comes forward again", () => {
    let state = open();
    const opened = viewOf(state);
    state = reduce(state, act.deleted({ id: "b", what: "the delete" }));
    expect(state.deleted).toEqual(["b"]);
    const after = viewOf(state);
    state = reduce(state, act.undone());
    expect(viewOf(state)).toEqual(opened);
    expect(state.deleted).toEqual([]);
    expect(state.future.map((s) => s.what)).toEqual(["the delete"]);
    state = reduce(state, act.redone());
    expect(viewOf(state)).toEqual(after);
    expect(state.revision).toBe(3);
  });

  it("a new edit drops what could be redone; the history keeps the newest 200", () => {
    let state = open();
    state = reduce(state, act.deleted({ id: "b", what: "d" }));
    state = reduce(state, act.undone());
    state = reduce(
      state,
      act.settingsChanged({ needsNoGps: true, what: "setting" }),
    );
    expect(state.future).toEqual([]);
    for (let i = 0; i < TOUR_HISTORY_LIMIT + 5; i += 1) {
      state = reduce(
        state,
        act.settingsChanged({ needsNoGps: i % 2 === 0, what: `s${String(i)}` }),
      );
    }
    expect(state.past).toHaveLength(TOUR_HISTORY_LIMIT);
  });

  it("an undo after a save is measured against the NEW file: the delete it wrote comes back as an edit, needing the photo's picture", () => {
    let state = open();
    state = reduce(state, act.deleted({ id: "f", what: "the delete" }));
    state = save(state);
    expect(changeCount(state)).toBe(0);
    expect(tourObjects(state.written!).map((o) => o.id)).toEqual(["a", "b"]);
    const step = state.past.at(-1)!;
    expect(picturesNeeded(state, step.view)).toEqual(["f"]);
    state = reduce(state, act.undone());
    expect(unsavedEntries(state).map((p) => p.object.id)).toEqual(["f"]);
    expect(changeCount(state)).toBe(1);
  });

  it("an undo after a save that dropped the emptied station brings it back where it stood", () => {
    let state = open();
    state = reduce(state, act.deleted({ id: "b", what: "the delete" }));
    state = save(state);
    expect(state.written!.stations.map((s) => s.id)).toEqual([
      stationIdOf("a"),
      stationIdOf("f"),
    ]);
    state = reduce(state, act.undone());
    state = save(state);
    // The tour's own order, as opened (the frames are in the history).
    expect(state.written!.stations.map((s) => s.id)).toEqual(
      OPENED.stations.map((s) => s.id),
    );
    expect(tourObjects(state.written!).map((o) => o.id)).toEqual([
      "a",
      "b",
      "f",
    ]);
  });
});

describe("tour document: a station's frame (D17)", () => {
  it("moves its items rigidly: each an edit at its new spot, its local pose kept in the written tour", () => {
    let state = open();
    const station = stationIdOf("a");
    const was = OPENED.stations.find((s) => s.id === station)!;
    state = reduce(
      state,
      act.stationMoved({
        stationId: station,
        geo: { ...was.geo, lat: was.geo.lat + 0.0001 },
        what: "the move of the station",
      }),
    );
    expect(objectOf(state, "a").geo.lat).toBeCloseTo(48.5201, 9);
    // The frame only: its item rides it unchanged inside its station (what
    // is pending is read through the document's frames, review extra).
    expect(changeCount(state)).toBe(1);
    expect(unsavedEntries(state)).toEqual([]);
    const written = manifestToWrite(state)!;
    const moved = written.stations.find((s) => s.id === station)!;
    expect(moved.geo.lat).toBeCloseTo(was.geo.lat + 0.0001, 12);
    expect(moved.items[0]!.pose).toEqual(was.items[0]!.pose);
    state = reduce(state, act.undone());
    expect(state.stations).toEqual(framesOf(OPENED));
    expect(changeCount(state)).toBe(0);
  });

  // Why: a frame was compared with the written one through JSON.stringify,
  // which depends on key order - so a station moved and moved back by a
  // writer that builds its geo keys in another order counted as a change,
  // and the leave guard asked about a tour with nothing to save.
  it("a station moved and moved back with its geo keys in another order is no change", () => {
    let state = open();
    const station = stationIdOf("a");
    const was = OPENED.stations.find((s) => s.id === station)!;
    state = reduce(
      state,
      act.stationMoved({
        stationId: station,
        geo: { ...was.geo, lat: was.geo.lat + 0.0001 },
        what: "the move of the station",
      }),
    );
    expect(changeCount(state)).toBe(1);
    const reordered = Object.fromEntries(
      Object.entries(was.geo).reverse(),
    ) as typeof was.geo;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(was.geo));
    state = reduce(
      state,
      act.stationMoved({
        stationId: station,
        geo: reordered,
        what: "the move of the station",
      }),
    );
    expect(changeCount(state)).toBe(0);
  });

  // Why (found by the "undoing everything" property, seed 1254187575): a
  // save can write an item at a local offset under a MOVED frame - here
  // the station moved down, its note back up to where it stood, then a
  // save. Undoing both brings the frame back, and the note's world spot is
  // then its opened one again - which the written file also gives it, but
  // only under the written frame. Measured against the file read through
  // the view's own frames, the note needs an entry; without it, it rides
  // the restored frame up by the offset.
  it("an undo that brings a frame back keeps its items where the view had them, though the written file holds them elsewhere in the frame", () => {
    let state = open();
    const station = stationIdOf("b");
    const was = OPENED.stations.find((s) => s.id === station)!;
    state = reduce(
      state,
      act.stationMoved({
        stationId: station,
        geo: { ...was.geo, lat: was.geo.lat - 0.00002 },
        what: "the move of the station",
      }),
    );
    const b = objectOf(state, "b");
    state = reduce(
      state,
      act.moved({
        object: { ...b, geo: { ...b.geo, lat: b.geo.lat + 0.00002 } },
        what: "the move of b",
      }),
    );
    state = save(state);
    state = reduce(reduce(state, act.undone()), act.undone());
    expect(objectOf(state, "b").geo.lat).toBeCloseTo(48.5202, 9);
    expect(state.stations).toEqual(framesOf(OPENED));
    const written = manifestToWrite(state)!;
    expect(
      written.stations.find((s) => s.id === station)!.items[0]!.pose,
    ).toEqual(was.items[0]!.pose);
  });

  it("refuses nothing for an unknown station, and changes nothing", () => {
    const state = open();
    const next = reduce(
      state,
      act.stationMoved({
        stationId: "nowhere",
        geo: OPENED.stations[0]!.geo,
        what: "m",
      }),
    );
    expect(next).toEqual(state);
  });
});

describe("tour document: settings and details", () => {
  it("the setting and each detail field are one change each while they differ from the file", () => {
    let state = open();
    state = reduce(
      state,
      act.settingsChanged({ needsNoGps: true, what: "setting" }),
    );
    state = reduce(
      state,
      act.detailsChanged({
        details: { title: "T", description: "D" },
        what: "details",
      }),
    );
    expect(changeCount(state)).toBe(3);
    expect(state.touched).toEqual({
      needsNoGps: true,
      details: true,
      stations: false,
    });
    expect(state.detailsRecorded).toBe(true);
    const written = manifestToWrite(state)!;
    expect(written.needsNoGps).toBe(true);
    expect(written.title).toBe("T");
    expect(written.description).toBe("D");
  });

  it("a cover follows its photo: gone with its delete, back with the undo", () => {
    let state = open();
    state = reduce(
      state,
      act.detailsChanged({ details: { cover: "f" }, what: "details" }),
    );
    state = reduce(state, act.deleted({ id: "f", what: "the delete" }));
    expect(effectiveDetails(state)).toEqual({});
    expect(manifestToWrite(state)).not.toHaveProperty("cover");
    state = reduce(state, act.undone());
    expect(effectiveDetails(state)).toEqual({ cover: "f" });
  });
});

describe("tour document: a restore", () => {
  it("puts a draft's work back as one step to undo", () => {
    let state = open();
    state = reduce(
      state,
      act.restored({
        objects: [{ ...objectOf(state, "a"), label: "restored" }],
        deleted: ["b"],
        needsNoGps: true,
        details: { title: "R" },
        what: "the restored changes",
      }),
    );
    expect(changeCount(state)).toBe(4);
    expect(state.detailsRecorded).toBe(true);
    // A restore is not live work: a later offer may still set them.
    expect(state.touched).toEqual({
      needsNoGps: false,
      details: false,
      stations: false,
    });
    state = reduce(state, act.undone());
    expect(changeCount(state)).toBe(0);
  });
});

describe("tour document: the save status", () => {
  it("is saving while rebuilds are queued, idle after, error after a failure", () => {
    let state = open();
    const g = { generation: state.generation };
    state = reduce(state, act.saveStarted(g));
    state = reduce(state, act.saveStarted(g));
    expect(state.save).toMatchObject({
      status: "saving",
      rebuilds: 2,
      error: null,
    });
    state = reduce(state, act.saveEnded(g));
    expect(state.save.status).toBe("saving");
    state = reduce(state, act.saveEnded({ ...g, error: "disk" }));
    expect(state.save).toMatchObject({
      status: "error",
      rebuilds: 0,
      error: "disk",
    });
    state = reduce(state, act.saveStarted(g));
    state = reduce(state, act.saveEnded(g));
    expect(state.save).toMatchObject({ status: "idle", error: null });
  });

  it("holds a page's save slot, its queue, and where the last save arrived; a new open forgets them", () => {
    let state = open();
    state = reduce(state, act.saveClaimed({ by: "auto" }));
    expect(state.save).toMatchObject({ status: "saving", by: "auto" });
    state = reduce(state, act.saveQueued({ queued: true }));
    state = reduce(state, act.saveBuilt());
    state = reduce(state, act.saveDelivered({ inPlace: true, name: "t.zip" }));
    state = reduce(state, act.saveReleased({}));
    expect(state.save).toMatchObject({
      status: "idle",
      by: null,
      queued: true,
      built: true,
      delivered: { inPlace: true, name: "t.zip" },
    });
    state = reduce(state, act.saveClaimed({ by: "explicit" }));
    state = reduce(state, act.saveReleased({ error: "Not saved: disk" }));
    expect(state.save).toMatchObject({
      status: "error",
      error: "Not saved: disk",
    });
    state = reduce(state, act.saveLimited({ largeTour: true }));
    expect(state.save).toMatchObject({ largeTour: true, cannotSave: false });
    state = reduce(state, act.saveClaimed({ by: "auto" }));
    state = reduce(state, act.opened({ manifest: OPENED }));
    // The slot is the page's: the save holding it lets it go itself.
    expect(state.save).toEqual({
      ...initialTourDocumentState.save,
      status: "saving",
      by: "auto",
    });
    state = reduce(state, act.saveReleased({}));
    expect(state.save).toEqual(initialTourDocumentState.save);
  });

  it("a close forgets the tour, and disowns its sessions' late answers", () => {
    const state = open();
    const closed = reduce(state, act.closed());
    expect(closed).toEqual({
      ...initialTourDocumentState,
      generation: state.generation + 1,
    });
    expect(reduce(closed, act.saveStarted({ generation: 1 }))).toEqual(closed);
  });

  it("an edit made while a save ran stays pending after it lands", () => {
    let state = open();
    const start = state;
    state = reduce(
      state,
      act.edited({
        object: { ...objectOf(state, "a"), label: "during" },
        what: "e",
      }),
    );
    state = reduce(
      state,
      act.saved({
        generation: start.generation,
        written: manifestToWrite(start)!,
        appliedDeletions: [],
        stationsAtStart: start.stations,
      }),
    );
    expect(unsavedEntries(state).map((p) => p.object.id)).toEqual(["a"]);
  });

  // Why: the same frame rule as an undo's, for a save that lands. While it
  // ran, a station moved and its note was moved back to the spot the
  // written file gives it. The written file "holds" that note only under
  // its OWN frame; the document keeps the moved one, so the note's entry
  // must stay, or the note rides the moved frame away.
  it("a save that lands after a frame moved keeps the entries that frame needs", () => {
    let state = open();
    const start = state;
    const station = stationIdOf("b");
    const was = OPENED.stations.find((s) => s.id === station)!;
    state = reduce(
      state,
      act.stationMoved({
        stationId: station,
        geo: { ...was.geo, lat: was.geo.lat - 0.00002 },
        what: "s",
      }),
    );
    const b = objectOf(state, "b");
    state = reduce(
      state,
      act.moved({
        object: { ...b, geo: { ...b.geo, lat: b.geo.lat + 0.00002 } },
        what: "m",
      }),
    );
    state = reduce(
      state,
      act.saved({
        generation: start.generation,
        written: manifestToWrite(start)!,
        appliedDeletions: [],
        stationsAtStart: start.stations,
      }),
    );
    expect(objectOf(state, "b").geo.lat).toBeCloseTo(48.5202, 9);
  });

  it("a save of a tour opened since never lands in the new one", () => {
    const first = open();
    const second = reduce(first, act.opened({ manifest: tourOf([pin("z")]) }));
    const late = reduce(
      second,
      act.saved({
        generation: first.generation,
        written: OPENED,
        appliedDeletions: [],
        stationsAtStart: first.stations,
      }),
    );
    expect(late).toEqual(second);
    expect(
      reduce(second, act.saveEnded({ generation: first.generation })),
    ).toEqual(second);
  });
});

/**
 * Why (the r875 milestone review #3, root rule "reducers enforce the
 * rules"): the document's own rules held only in the desktop session, so
 * a second page dispatching the same actions - the phone, next - could
 * break them. The reducers now refuse by doing nothing; the session
 * keeps its words by calling the same guards.
 */
describe("tour document: the rules its reducers keep", () => {
  const far = (TOUR_ITEM_MAX_OFFSET_M * 2) / 111_320;

  // Why (PR #644 review): every other edit refuses before an open, but the
  // setting and the details recorded a history step there - one no undo
  // can take back (a step needs a written file) - counted by `revision`
  // and followed by a page's draft as an edit.
  it("the setting and the details change nothing before a tour is open", () => {
    const setting = reduce(
      initialTourDocumentState,
      act.settingsChanged({ needsNoGps: true, what: "s" }),
    );
    expect(setting).toEqual(initialTourDocumentState);
    const details = reduce(
      initialTourDocumentState,
      act.detailsChanged({ details: { title: "Early" }, what: "d" }),
    );
    expect(details).toEqual(initialTourDocumentState);
    // ... and the same after a close.
    const closed = reduce(open(), act.closed());
    expect(
      reduce(
        closed,
        act.detailsChanged({ details: { title: "x" }, what: "d" }),
      ),
    ).toEqual(closed);
  });

  it("placing an id the tour carries, or a spot too far from its station, changes nothing", () => {
    const state = open();
    const a = objectOf(state, "a");
    const again = reduce(
      state,
      act.placed({ object: { ...a, label: "twice" }, what: "p" }),
    );
    expect(again).toEqual(state);
    expect(canPlace(state, a)).toBe(false);
    const tooFar: TourObject = {
      ...pin("n"),
      station: stationIdOf("a"),
      geo: { ...a.geo, lat: a.geo.lat + far },
    };
    expect(canPlace(state, tooFar)).toBe(false);
    expect(reduce(state, act.placed({ object: tooFar, what: "p" }))).toEqual(
      state,
    );
    const near: TourObject = { ...tooFar, geo: a.geo };
    expect(canPlace(state, near)).toBe(true);
    expect(
      documentObjects(reduce(state, act.placed({ object: near, what: "p" })))
        .map((o) => o.object.id)
        .sort(),
    ).toEqual(["a", "b", "f", "n"]);
  });

  it("a move or an edit to a spot too far from its station changes nothing", () => {
    const state = open();
    const a = objectOf(state, "a");
    const moved = { ...a, geo: { ...a.geo, lat: a.geo.lat + far } };
    expect(objectFits(state, moved)).toBe(false);
    expect(reduce(state, act.moved({ object: moved, what: "m" }))).toEqual(
      state,
    );
    expect(reduce(state, act.edited({ object: moved, what: "e" }))).toEqual(
      state,
    );
  });

  it("no undo or redo while a save is queued or runs", () => {
    let state = open();
    state = reduce(state, act.deleted({ id: "b", what: "d" }));
    const running = reduce(
      state,
      act.saveStarted({ generation: state.generation }),
    );
    expect(canStep(running)).toBe(false);
    expect(reduce(running, act.undone())).toEqual(running);
    const ended = reduce(
      running,
      act.saveEnded({ generation: state.generation }),
    );
    expect(canStep(ended)).toBe(true);
    const undone = reduce(ended, act.undone());
    expect(undone.deleted).toEqual([]);
    const again = reduce(
      undone,
      act.saveStarted({ generation: state.generation }),
    );
    expect(reduce(again, act.redone())).toEqual(again);
  });

  it("a restore skips an object whose spot its station cannot carry", () => {
    const state = open();
    const a = objectOf(state, "a");
    const restored = reduce(
      state,
      act.restored({
        objects: [
          { ...a, geo: { ...a.geo, lat: a.geo.lat + far } },
          { ...objectOf(state, "b"), label: "kept" },
        ],
        deleted: [],
        what: "r",
      }),
    );
    expect(restored.placed.map((p) => p.object.id)).toEqual(["b"]);
  });

  // Why (the a9368add class, the review's extra finding): what is pending
  // is measured through the document's frames, as everything else is. A
  // station moved and its note moved back to where the file has it: the
  // note's local pose in its moved station changes, so it is pending.
  it("counts a note pending after its station moved and it was moved back", () => {
    let state = open();
    const station = stationIdOf("b");
    const was = OPENED.stations.find((s) => s.id === station)!;
    state = reduce(
      state,
      act.stationMoved({
        stationId: station,
        geo: { ...was.geo, lat: was.geo.lat - 0.00002 },
        what: "s",
      }),
    );
    const b = objectOf(state, "b");
    state = reduce(
      state,
      act.moved({
        object: { ...b, geo: { ...b.geo, lat: b.geo.lat + 0.00002 } },
        what: "m",
      }),
    );
    expect(unsavedEntries(state).map((p) => p.object.id)).toEqual(["b"]);
    expect(changeCount(state)).toBe(2); // the note and the frame
  });
});

// Why: both pages shape an edit's payload by these, through the document
// (the boundary rule keeps them from importing `object-edits.ts`): the
// phone's object list and the desktop session must refuse and accept the
// same text and the same moves.
describe("tour document: what an edit would change", () => {
  it("a pin's text: trimmed, the same text no change, an empty one refused, an unknown id missing", () => {
    const state = open();
    expect(pinTextChange(state, "a", "  New  ")).toEqual({
      kind: "edited",
      after: { ...objectOf(state, "a"), label: "New" },
    });
    expect(pinTextChange(state, "a", "pin a")).toEqual({ kind: "unchanged" });
    expect(pinTextChange(state, "a", "   ")).toMatchObject({
      kind: "refused",
    });
    // A photo has no text to edit.
    expect(pinTextChange(state, "f", "x")).toEqual({ kind: "unchanged" });
    expect(pinTextChange(state, "gone", "x")).toEqual({ kind: "missing" });
  });

  it("a move on the map: height and facing kept, too far from its station refused, an unknown id missing", () => {
    const state = open();
    const a = objectOf(state, "a");
    expect(objectMoveChange(state, "a", 48.5205, 9.051)).toEqual({
      kind: "moved",
      before: a,
      after: { ...a, geo: { ...a.geo, lat: 48.5205, lon: 9.051 } },
    });
    const far = (TOUR_ITEM_MAX_OFFSET_M * 2) / 111_320;
    expect(objectMoveChange(state, "a", a.geo.lat + far, 9.05)).toEqual({
      kind: "too-far",
    });
    expect(objectMoveChange(state, "gone", 48.52, 9.05)).toEqual({
      kind: "missing",
    });
    expect(() => objectMoveChange(state, "a", 91, 9.05)).toThrow(RangeError);
  });
});

/** A save built to go over the opened file (the desktop's in place): it
 *  names the history position of the view it writes; the write has not
 *  arrived yet. */
function builtInPlace(state: TourDocumentState): TourDocumentState {
  const written = manifestToWrite(state);
  if (written === null) throw new Error("nothing open");
  return reduce(
    state,
    act.saved({
      generation: state.generation,
      written,
      appliedDeletions: [...state.deleted],
      stationsAtStart: state.stations,
      inPlaceAt: state.position,
    }),
  );
}

/** A save written over the opened file whose write arrived. */
function saveInPlace(state: TourDocumentState): TourDocumentState {
  return reduce(
    builtInPlace(state),
    act.saveDelivered({ inPlace: true, name: "tour.zip" }),
  );
}

/** A resave of the document as it stands, built in place, whose write was
 *  refused or failed: the slot let go without the write arriving. */
function failedResave(state: TourDocumentState): TourDocumentState {
  const claimed = reduce(state, act.saveClaimed({ by: "auto" }));
  return reduce(
    builtInPlace(claimed),
    act.saveReleased({ error: "the disk is full" }),
  );
}

function del(state: TourDocumentState, id: string): TourDocumentState {
  return reduce(state, act.deleted({ id, what: `the delete of ${id}` }));
}

function relabel(state: TourDocumentState, id: string): TourDocumentState {
  const object = objectOf(state, id);
  if (object.kind !== "pin") throw new Error(`${id} is no pin`);
  return reduce(
    state,
    act.edited({ object: { ...object, label: `${object.label}!` }, what: id }),
  );
}

const undo = (s: TourDocumentState) => reduce(s, act.undone());
const redo = (s: TourDocumentState) => reduce(s, act.redone());

describe("tour document: a step across an in-place save (D33)", () => {
  // Why: the desktop's open drops every draft record of an id the file on
  // disk lacks, so a delete written in place and then undone was lost on a
  // reload. The owner's fix (D33): an undo or redo that crosses an in-place
  // save writes the file again at once. The slice says when that is due
  // (`save.resave`); these pin the rule - which steps cross, which do not.

  it("an undo of a delete an in-place save wrote is due a resave", () => {
    const state = undo(saveInPlace(del(open(), "b")));
    expect(state.save.resave).toBe(true);
    expect(documentObjects(state).map((o) => o.object.id)).toContain("b");
  });

  it("an undo of an edit no save wrote is not, nor of one after the save", () => {
    expect(undo(del(open(), "b")).save.resave).toBe(false);
    // The file was written before the delete: the undo moves back to it.
    expect(undo(del(saveInPlace(open()), "b")).save.resave).toBe(false);
    // Two edits after the save: undoing the newer crosses nothing either.
    const after = del(relabel(saveInPlace(open()), "a"), "b");
    expect(undo(after).save.resave).toBe(false);
    expect(undo(undo(after)).save.resave).toBe(false);
  });

  it("the second undo below the save crosses it, the first does not", () => {
    // a, b written in place; c after it.
    const written = saveInPlace(relabel(del(open(), "b"), "a"));
    const later = relabel(written, "a");
    expect(undo(later).save.resave).toBe(false);
    expect(undo(undo(later)).save.resave).toBe(true);
  });

  it("a download is no in-place save: an undo across it is not due", () => {
    expect(undo(save(del(open(), "b"))).save.resave).toBe(false);
    // A download after an in-place save: the page writes downloads now.
    const both = save(saveInPlace(del(open(), "b")));
    expect(undo(both).save.resave).toBe(false);
  });

  it("a redo across an in-place save is due; one with no save between is not", () => {
    // The delete undone, then the file written holding b: the redo takes b
    // away from what the file holds.
    const written = saveInPlace(undo(del(open(), "b")));
    expect(redo(written).save.resave).toBe(true);
    expect(redo(undo(del(open(), "b"))).save.resave).toBe(false);
    // Written before the delete was made, then the delete undone and
    // redone: the redo takes b away from what the file holds, so it is due
    // too (the rule reads positions, not when the edit was first made).
    expect(redo(undo(del(saveInPlace(open()), "b"))).save.resave).toBe(true);
  });

  it("a new edit past an undone save leaves the file off the history: every step crosses it", () => {
    // Written with b deleted; the delete undone (the resave not landed);
    // a new edit drops the redo, so no view on the history is the file's.
    let state = undo(saveInPlace(del(open(), "b")));
    state = reduce(state, act.saveClaimed({ by: "auto" }));
    state = reduce(state, act.saveReleased({}));
    expect(state.save.resave).toBe(false);
    state = relabel(state, "a");
    expect(state.save.inPlaceAt).toBe("elsewhere");
    expect(undo(state).save.resave).toBe(true);
    const back = reduce(
      reduce(undo(state), act.saveClaimed({ by: "auto" })),
      act.saveReleased({}),
    );
    expect(redo(back).save.resave).toBe(true);
    // A landed in-place save puts the file back on the history.
    expect(saveInPlace(state).save.inPlaceAt).toBe(state.position);
  });

  it("a claimed save takes the resave on; an open forgets it; a refused undo sets nothing", () => {
    const due = undo(saveInPlace(del(open(), "b")));
    expect(reduce(due, act.saveClaimed({ by: "auto" })).save.resave).toBe(
      false,
    );
    expect(reduce(due, act.opened({ manifest: OPENED })).save).toMatchObject({
      resave: false,
      inPlaceAt: null,
    });
    const running = reduce(
      saveInPlace(del(open(), "b")),
      act.saveStarted({ generation: 1 }),
    );
    expect(undo(running).save.resave).toBe(false);
  });

  // Why: the file's view was named when the save was BUILT,
  // so a write that was refused or failed left the slice believing the disk
  // held a view it never received, and a later step could then miss the
  // real file. The view is named when the write arrives; until then the
  // disk keeps the view it had.
  it("names the file's view only once the in-place write arrives; a failed write leaves the disk's view", () => {
    const built = builtInPlace(del(open(), "b"));
    expect(built.save.inPlaceAt).toBeNull();
    expect(
      reduce(built, act.saveDelivered({ inPlace: true, name: "t.zip" })).save
        .inPlaceAt,
    ).toBe(built.position);
    // The disk holds b deleted (position 1); the undo crosses it, and its
    // resave fails: the disk still holds position 1.
    const failed = failedResave(undo(saveInPlace(del(open(), "b"))));
    expect(failed.save.inPlaceAt).toBe(1);
  });

  // Why: "tap Save again" re-delivers the build that did not arrive, with
  // no new build (the page's `undelivered`). Its view must still be named
  // when that write arrives, or the slice keeps the view the disk no
  // longer holds and a later step misses the real file.
  it("a retried write of the build that did not arrive names its view when it arrives", () => {
    const failed = failedResave(undo(saveInPlace(del(open(), "b"))));
    const retried = reduce(
      reduce(failed, act.saveClaimed({ by: "explicit" })),
      act.saveDelivered({ inPlace: true, name: "t.zip" }),
    );
    expect(retried.save.inPlaceAt).toBe(0);
    // The disk holds 0 now: a redo to 1 leaves it and must write.
    expect(redo(reduce(retried, act.saveReleased({}))).save.resave).toBe(true);
  });

  it("after a failed resave a later step still crosses the real file (the counter-traces)", () => {
    // The disk at 1 (b deleted); undo to 0 crosses; its resave fails.
    const failed = failedResave(undo(saveInPlace(del(open(), "b"))));
    // A redo to 1 comes back to what the disk holds: nothing to write.
    expect(redo(failed).save.resave).toBe(false);
    // Then an undo back to 0 (a save attempted between, taking any resave
    // on): the disk still holds 1, so the undo leaves it and must write.
    const attempted = (x: TourDocumentState) =>
      reduce(reduce(x, act.saveClaimed({ by: "auto" })), act.saveReleased({}));
    expect(undo(attempted(redo(failed))).save.resave).toBe(true);
    // A new edit at 1 and its undo back to 0: the edit dropped the disk's
    // view from the history, so the undo crosses it.
    expect(undo(relabel(failed, "a")).save.resave).toBe(true);
  });

  it("a step while an in-place write runs is measured against the view it writes too", () => {
    // Written at 1 (b deleted), the write not arrived: an undo already
    // takes the document off what the disk will hold.
    const writing = builtInPlace(
      reduce(del(open(), "b"), act.saveClaimed({ by: "auto" })),
    );
    expect(undo(writing).save.resave).toBe(true);
  });

  it("counts its position: an edit and a redo forward, an undo back, an open from zero", () => {
    let state = relabel(del(open(), "b"), "a");
    expect(state.position).toBe(2);
    state = undo(undo(state));
    expect(state.position).toBe(0);
    expect(redo(state).position).toBe(1);
    expect(reduce(state, act.opened({ manifest: OPENED })).position).toBe(0);
  });
});
