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
import {
  changeCount,
  documentObjects,
  effectiveDetails,
  framesOf,
  initialTourDocumentState,
  manifestNow,
  manifestToWrite,
  picturesNeeded,
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
    expect(changeCount(state)).toBe(2); // the item and the frame
    const written = manifestToWrite(state)!;
    const moved = written.stations.find((s) => s.id === station)!;
    expect(moved.geo.lat).toBeCloseTo(was.geo.lat + 0.0001, 12);
    expect(moved.items[0]!.pose).toEqual(was.items[0]!.pose);
    state = reduce(state, act.undone());
    expect(state.stations).toEqual(framesOf(OPENED));
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
    expect(state.touched).toEqual({ needsNoGps: true, details: true });
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
    expect(state.touched).toEqual({ needsNoGps: false, details: false });
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
