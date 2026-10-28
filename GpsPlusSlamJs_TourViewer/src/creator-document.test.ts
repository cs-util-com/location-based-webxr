/**
 * The phone's handle on the shared tour document (`creator-document.ts`).
 *
 * Why these tests matter: the phone's creator kept the tour in three
 * session fields of its own, and the desktop in the slice - two copies of
 * one tour that meant different things (D29, D30). The handle is now the
 * phone's ONLY copy: each test pins one promise the creator path relies on
 * that the slice alone does not give - work made before a tour opened
 * coming along, the side tables (pictures, AR placements) staying beside
 * the state, the draft's writes reported to the change that caused them,
 * and a stable identity for the readers that memoize on it.
 */
import { describe, expect, it } from "vitest";
import type {
  TourObject,
  TourPicture,
  TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { createCreatorDocument } from "./creator-document.js";
import { stationsAsFinished } from "./creator-stations.js";
import { manifestToWrite, tourDocumentActions } from "./tour-document.js";
import {
  parseSettingsRecord,
  settingsRecordText,
  type TourDocumentDraft,
  type TourSettingsRecord,
} from "./tour-document-draft.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import { tourOf, withCaption } from "./test-support/tour-of.js";

function pin(id: string, lat = 48.52): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: `pin ${id}`,
    createdAtIso: "2026-10-19T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

function photo(id: string): TourPicture {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: id,
    widthM: 1,
    imageAsset: {
      id: id,
      path: `content/${id}.jpg`,
      kind: "image",
      width: 4,
      height: 3,
    },
    createdAtIso: "2026-10-19T00:00:00.000Z",
    geo: { lat: 48.5201, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

const PLACEMENT = {
  visit: 1,
  local: {
    position: [1, 0, 2] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  },
};

function fresh() {
  return createCreatorDocument(createTourViewerStore());
}

/** A draft that records its calls and answers as told. */
function recordingDraft(answer: (call: string) => boolean = () => true) {
  const calls: string[] = [];
  const say = (call: string): Promise<boolean> => {
    calls.push(call);
    return Promise.resolve(answer(call));
  };
  const draft: TourDocumentDraft = {
    saveObject: (object, blob) =>
      say(`save ${object.id}${blob === undefined ? "" : " +picture"}`),
    saveDeletion: (id) => say(`delete ${id}`),
    forgetDeletion: (id) => say(`undelete ${id}`),
    forgetObject: (id) => say(`forget ${id}`).then(() => undefined),
    saveSettings: (settings) =>
      say(`settings ${JSON.stringify(settings.stations?.map((s) => s.id))}`),
  };
  return { draft, calls };
}

describe("the creator's document: no tour, and a tour opening", () => {
  it("has no manifest before a tour opens, and takes placements anyway", () => {
    // The scan-to-open plan §9 #5: the creator may place before any tour
    // is open; the slice takes edits only into an open document.
    const doc = fresh();
    expect(doc.manifest()).toBeNull();
    expect(doc.place(pin("p"), {}, "a pin")).not.toBeNull();
    expect(doc.entries().map((e) => e.object.id)).toEqual(["p"]);
    expect(doc.manifest()).toBeNull();
  });

  it("carries work made with no tour open into the tour that opens", () => {
    const doc = fresh();
    doc.place(
      photo("q"),
      { blob: new Blob(["q"]), placement: PLACEMENT },
      "a photo",
    );
    doc.open(tourOf([pin("a")]));
    expect(doc.objects().map((o) => o.object.id)).toEqual(["a", "q"]);
    const carried = doc.entries().find((e) => e.object.id === "q");
    expect(carried?.blob).toBeInstanceOf(Blob);
    expect(carried?.placement).toEqual(PLACEMENT);
  });

  // Why this matters: work made before a tour opens stood in stations of
  // the empty "no tour" document. The tour that opens has its own: the
  // rule runs again against them, so a pin made next to one of its
  // stations joins it instead of keeping a station of its own there.
  it("seats carried work by the rule against the opened tour's stations", () => {
    const doc = fresh();
    const near = doc.place(pin("p"), {}, "a pin")?.object.station;
    const far = doc.place(pin("q", 48.53), {}, "a pin")?.object.station;
    doc.open(tourOf([pin("a")]));
    const stationOf = (id: string) =>
      doc.objects().find((o) => o.object.id === id)?.object.station;
    const hosted = stationOf("a");
    expect(stationOf("p")).toBe(hosted);
    expect(stationOf("q")).not.toBe(hosted);
    const ids = doc.manifest()?.stations.map((st) => st.id) ?? [];
    expect(ids).toEqual([hosted, stationOf("q")]);
    // None of the stations made before the tour opened comes along.
    expect(ids).not.toContain(near);
    expect(ids).not.toContain(far);
  });

  it("keeps a tour without tour.json as no manifest until a write lands", () => {
    const doc = fresh();
    doc.place(pin("p"), {}, "a pin");
    doc.open(null);
    expect(doc.manifest()).toBeNull();
    expect(doc.entries()).toHaveLength(1);
  });

  it("drops everything of a tour at its close, side tables included", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    doc.place(
      photo("q"),
      { blob: new Blob(["q"]), placement: PLACEMENT },
      "a photo",
    );
    doc.remove("a", "the delete");
    doc.close();
    expect(doc.manifest()).toBeNull();
    expect(doc.entries()).toEqual([]);
    expect(doc.deleted()).toEqual([]);
    expect(doc.pictureOf("q")).toBeUndefined();
    // A tour opened next does not inherit the closed one's work.
    doc.open(tourOf([pin("b")]));
    expect(doc.objects().map((o) => o.object.id)).toEqual(["b"]);
  });
});

describe("the creator's document: identities the readers memoize on", () => {
  it("returns the same manifest and entries until the document changes", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    const m = doc.manifest();
    const e = doc.entries();
    expect(doc.manifest()).toBe(m);
    expect(doc.entries()).toBe(e);
    doc.place(pin("p"), {}, "a pin");
    expect(doc.entries()).not.toBe(e);
  });

  // Why: the manifest depends on the tombstones too - a cover whose photo
  // is deleted is none (`effectiveDetails`). Every reducer that changes
  // `deleted` today also replaces `placed`, so a memo keyed without
  // `deleted` looks right; no reducer can produce the state below, so the
  // memo is driven directly through a store that serves it. A later
  // reducer that touches only the tombstones would otherwise serve the
  // manifest with the deleted photo still its cover.
  it("gives a new manifest when only the tombstones change", () => {
    const real = createTourViewerStore();
    let served: ReturnType<typeof real.getState> | null = null;
    const doc = createCreatorDocument({
      getState: () => served ?? real.getState(),
      dispatch: (action) => real.dispatch(action),
      listenToDocument: real.listenToDocument,
    });
    doc.open(tourOf([photo("q"), pin("b")], { cover: "q" }));
    const before = doc.manifest();
    expect(before?.cover).toBe("q");
    const s = real.getState();
    served = { ...s, tourDocument: { ...s.tourDocument, deleted: ["q"] } };
    expect(served.tourDocument.placed).toBe(s.tourDocument.placed);
    const after = doc.manifest();
    expect(after).not.toBe(before);
    expect(after?.cover).toBeUndefined();
  });

  it("joins a picture kept later into the entries", () => {
    const doc = fresh();
    doc.open(tourOf([]));
    doc.place(photo("q"), {}, "a photo");
    const before = doc.entries();
    doc.keepPicture("q", new Blob(["q"]));
    expect(doc.entries()).not.toBe(before);
    expect(doc.entries()[0]?.blob).toBeInstanceOf(Blob);
  });
});

describe("the creator's document: changes through the slice's guards", () => {
  it("refuses a placement of an id the tour carries", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    expect(doc.place(pin("a"), {}, "a pin")).toBeNull();
  });

  // Why: a move beyond its station's found radius re-runs the station
  // rule, so however far it goes the object stands in a station near it -
  // the format's 10 km bound between an item and its station cannot be
  // crossed by a move. A move of an id the document lacks is refused.
  it("seats a move far beyond its station in a station at the new spot, and refuses an unknown id", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    const a = doc.objects()[0]!.object;
    // About 110 km north: far beyond the format's bound.
    expect(
      doc.move({ ...a, geo: { ...a.geo, lat: 49.5 } }, "far"),
    ).not.toBeNull();
    const moved = doc.objects()[0]!.object;
    expect(moved.station).not.toBe(a.station);
    const home = doc.state().stations.find((f) => f.id === moved.station);
    expect(home?.geo.lat).toBe(49.5);
    expect(doc.move({ ...pin("nobody") }, "nobody")).toBeNull();
  });

  it("keeps an object's AR placement across an edit, replaces it on a move in AR", () => {
    const doc = fresh();
    doc.open(tourOf([]));
    doc.place(pin("p"), { placement: PLACEMENT }, "a pin");
    doc.edit({ ...pin("p"), caption: "New" }, "the text");
    expect(doc.entries()[0]?.placement).toEqual(PLACEMENT);
    const moved = { ...PLACEMENT, visit: 2 };
    doc.move({ ...pin("p"), caption: "New" }, "the move", moved);
    expect(doc.entries()[0]?.placement).toEqual(moved);
  });

  it("moves a station's frame with its items, and refuses an unknown one", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    const station = doc.state().stations[0]!;
    const geo = { ...station.geo, lat: station.geo.lat + 0.0001 };
    expect(doc.moveStation("nowhere", geo, "a move")).toBeNull();
    expect(doc.moveStation(station.id, geo, "a move")).not.toBeNull();
    expect(doc.manifest()?.stations[0]?.geo).toEqual(geo);
    expect(doc.objects()[0]?.object.geo.lat).toBeGreaterThan(48.52);
  });

  it("undoes a delete, and refuses while a write runs", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    doc.remove("a", "the delete");
    const generation = doc.saveStarted();
    expect(doc.undo()).toEqual({ kind: "refused", reason: "saving" });
    doc.saveEnded(generation);
    expect(doc.undo()).toMatchObject({ kind: "undone", what: "the delete" });
    expect(doc.objects().map((o) => o.object.id)).toEqual(["a"]);
    expect(doc.undo()).toEqual({ kind: "nothing" });
  });

  it("refuses an undo that brings back a photo whose picture it lacks", () => {
    const doc = fresh();
    const tour = tourOf([photo("f")]);
    doc.open(tour);
    doc.remove("f", "the delete");
    const generation = doc.saveStarted();
    const written = { ...tour, stations: [] };
    doc.saved({
      generation,
      written,
      appliedDeletions: ["f"],
      stationsAtStart: doc.state().stations,
    });
    doc.saveEnded(generation);
    expect(doc.undo()).toEqual({ kind: "refused", reason: "picture-gone" });
    doc.keepPicture("f", new Blob(["f"]));
    expect(doc.undo().kind).toBe("undone");
  });

  it("drops the AR placement of an entry a write took out", () => {
    const doc = fresh();
    doc.open(tourOf([]));
    doc.place(pin("p"), { placement: PLACEMENT }, "a pin");
    const generation = doc.saveStarted();
    const written = manifestToWrite(doc.state())!;
    doc.saved({
      generation,
      written,
      appliedDeletions: [],
      stationsAtStart: doc.state().stations,
    });
    doc.saveEnded(generation);
    expect(doc.entries()).toEqual([]);
    expect(doc.manifest()).not.toBeNull();
  });
});

describe("the creator's document: the AR anchors of the stations it starts", () => {
  // Why these tests matter: a station started in an AR visit is anchored
  // where its first item stood at the tap, through the tap's alignment;
  // the visit's settle then moves that item. Unless the settle can re-pose
  // the station too, its anchor drifts off the item it was started for.
  // The settle can only do that with the anchor's odometry pose in that
  // visit, which never enters the tour state: it is kept beside it, like
  // an object's AR placement.
  const ELSEWHERE = {
    visit: 2,
    local: {
      position: [40, 0, 9] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    },
  };
  const stationOf = (doc: ReturnType<typeof fresh>, id: string) =>
    doc.objects().find((o) => o.object.id === id)!.object.station!;

  it("anchors a station a placement starts at that item's AR placement; a later item changes nothing", () => {
    const doc = fresh();
    doc.open(tourOf([]));
    doc.place(pin("p"), { placement: PLACEMENT }, "a pin");
    doc.place(pin("q"), { placement: ELSEWHERE }, "a pin");
    const station = stationOf(doc, "p");
    expect(stationOf(doc, "q")).toBe(station);
    expect([...doc.stationPlacements()]).toEqual([
      [station, { ...PLACEMENT, item: "p" }],
    ]);
  });

  it("anchors nothing for an item placed without an AR placement, nor a station the tour carries", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    // 1.1 km from "a": a station of its own, with no AR placement.
    doc.place(pin("p", 48.53), {}, "a pin");
    // Next to "a": the tour's station takes it.
    doc.place(pin("q"), { placement: PLACEMENT }, "a pin");
    expect(stationOf(doc, "q")).toBe(stationOf(doc, "a"));
    expect(doc.stationPlacements().size).toBe(0);
  });

  it("anchors the station a move starts: in AR at the new placement, by a settle at the placement the item keeps", () => {
    const doc = fresh();
    doc.open(tourOf([]));
    doc.place(pin("p"), { placement: PLACEMENT }, "a pin");
    const first = stationOf(doc, "p");
    doc.move(pin("p", 48.53), "a move in AR", ELSEWHERE);
    const second = stationOf(doc, "p");
    expect(second).not.toBe(first);
    // The station it left emptied and went, and its anchor with it.
    expect([...doc.stationPlacements()]).toEqual([
      [second, { ...ELSEWHERE, item: "p" }],
    ]);
    doc.move(pin("p", 48.54), "the settle");
    const third = stationOf(doc, "p");
    expect([...doc.stationPlacements()]).toEqual([
      [third, { ...ELSEWHERE, item: "p" }],
    ]);
  });

  it("anchors the stations the rule starts for work carried into the tour that opens", () => {
    const doc = fresh();
    doc.place(pin("q", 48.53), { placement: PLACEMENT }, "a pin");
    doc.place(pin("r", 48.5301), { placement: ELSEWHERE }, "a pin");
    doc.open(tourOf([pin("a")]));
    const station = stationOf(doc, "q");
    expect(stationOf(doc, "r")).toBe(station);
    expect([...doc.stationPlacements()]).toEqual([
      [station, { ...PLACEMENT, item: "q" }],
    ]);
  });

  it("keeps an anchor through an undo and a redo of its station", () => {
    const store = createTourViewerStore();
    const doc = createCreatorDocument(store);
    doc.open(tourOf([]));
    doc.place(pin("p"), { placement: PLACEMENT }, "a pin");
    const station = stationOf(doc, "p");
    doc.undo();
    expect(doc.stationPlacements().size).toBe(0);
    store.dispatch(tourDocumentActions.redone());
    expect([...doc.stationPlacements()]).toEqual([
      [station, { ...PLACEMENT, item: "p" }],
    ]);
  });

  it("drops the anchors with the tour: a draft restored into it again brings none", () => {
    const doc = fresh();
    doc.open(tourOf([]));
    doc.place(pin("p"), { placement: PLACEMENT }, "a pin");
    const station = stationOf(doc, "p");
    const frame = doc.state().stations.find((f) => f.id === station)!;
    const object = doc.objects()[0]!.object;
    doc.close();
    doc.open(tourOf([]));
    doc.restore(
      {
        objects: [object],
        deleted: [],
        pictures: new Map(),
        createdStations: [frame],
      },
      "the draft",
    );
    expect(stationOf(doc, "p")).toBe(station);
    expect(doc.stationPlacements().size).toBe(0);
  });

  it("drops the anchor of a station a write carried, keeping one the write did not", () => {
    const doc = fresh();
    doc.open(tourOf([]));
    doc.place(pin("p"), { placement: PLACEMENT }, "a pin");
    const generation = doc.saveStarted();
    const written = manifestToWrite(doc.state())!;
    const stationsAtStart = doc.state().stations;
    // Placed while the write ran: its station is not in the write.
    doc.place(pin("q", 48.53), { placement: ELSEWHERE }, "a pin");
    doc.saved({ generation, written, appliedDeletions: [], stationsAtStart });
    doc.saveEnded(generation);
    expect([...doc.stationPlacements()]).toEqual([
      [stationOf(doc, "q"), { ...ELSEWHERE, item: "q" }],
    ]);
  });
});

describe("the creator's document: a settle's batch (plan M3b, Q-D)", () => {
  // Why these tests matter: a settle moves stations and objects, and each
  // move reads the document as the moves before it left it (the station
  // rule reads the frames as they stand). The batch must give it that
  // view while nothing reaches the store, take everything as ONE step at
  // its commit, and anchor a station a move started as a move outside a
  // batch does - or the settle's own anchors drift from their items.
  it("reads as its changes leave it, reaches the store only at its commit, as one step", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    const station = doc.state().stations[0]!;
    const geo = { ...station.geo, lat: station.geo.lat + 0.0001 };
    const revision = doc.revision();
    const batch = doc.settleBatch();
    expect(batch.moveStation("nowhere", geo)).toBe(false);
    expect(batch.move(pin("nobody"))).toBe(false);
    expect(batch.moveStation(station.id, geo)).toBe(true);
    expect(batch.state().stations[0]?.geo).toEqual(geo);
    expect(batch.objects()[0]?.object.geo.lat).toBeGreaterThan(48.52);
    expect(doc.revision(), "nothing in the store yet").toBe(revision);
    expect(doc.objects()[0]?.object.geo.lat).toBe(48.52);
    const past = doc.state().past.length;
    expect(
      batch.commit({ levels: [], hand: null }, "the settle"),
    ).not.toBeNull();
    expect(doc.state().past.length).toBe(past + 1);
    expect(doc.state().stations[0]?.geo).toEqual(geo);
    expect(doc.objects()[0]?.object).toEqual(batch.objects()[0]?.object);
    expect(
      batch.commit({ levels: [], hand: null }, "again"),
      "a batch commits once",
    ).toBeNull();
    expect(doc.state().past.length).toBe(past + 1);
  });

  it("takes no step for a batch that moved nothing and saved no code", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    const revision = doc.revision();
    expect(
      doc.settleBatch().commit({ levels: [], hand: null }, "the settle"),
    ).toBeNull();
    expect(doc.revision()).toBe(revision);
  });

  it("anchors the station a move in it starts at the placement the item keeps", () => {
    const doc = fresh();
    doc.open(tourOf([]));
    doc.place(pin("p"), { placement: PLACEMENT }, "a pin");
    const batch = doc.settleBatch();
    batch.move(pin("p", 48.53));
    batch.commit({ levels: [], hand: null }, "the settle");
    const station = doc.objects().find((o) => o.object.id === "p")!.object
      .station!;
    expect([...doc.stationPlacements()]).toEqual([
      [station, { ...PLACEMENT, item: "p" }],
    ]);
  });
});

describe("the creator's document: the draft follows it", () => {
  it("writes each change from the listener, with the photo's picture", async () => {
    const doc = fresh();
    const { draft, calls } = recordingDraft();
    doc.follow(draft);
    doc.open(tourOf([pin("a")]));
    const placed = doc.place(photo("q"), { blob: new Blob(["q"]) }, "a photo");
    // Issued inside the dispatch: the change knows its writes at once (a
    // new object also forgets any tombstone of its id, `followDocument`).
    expect(calls).toEqual(["save q +picture", "undelete q"]);
    await expect(placed?.backedUp).resolves.toBe(true);
    await doc.remove("a", "the delete")?.backedUp;
    expect(calls).toEqual(["save q +picture", "undelete q", "delete a"]);
  });

  // Why this test matters (plan M3b): the draft's codes record follows the
  // codes through the same listener, with the hand from the page's code
  // state - but a tour's close empties the book, and a write then would
  // wipe the closed tour's codes from its draft.
  it("writes the codes record when the codes change, with the hand, and nothing at a tour's close", () => {
    const store = createTourViewerStore();
    const doc = createCreatorDocument(store);
    const { draft, calls } = recordingDraft();
    doc.follow({
      ...draft,
      saveCodes: (codes) => {
        calls.push(`codes ${JSON.stringify(codes)}`);
        return Promise.resolve(true);
      },
    });
    doc.open(tourOf([]));
    const level = { id: "c", json: "c-1" };
    store.dispatch(tourDocumentActions.codeTaken({ level, measurement: null }));
    store.dispatch(tourDocumentActions.codesForgotten());
    expect(calls.filter((c) => c.startsWith("codes"))).toEqual([
      `codes ${JSON.stringify({ level, levels: [level] })}`,
    ]);
  });

  it("reports a write that did not land to the change that caused it", async () => {
    const doc = fresh();
    const { draft } = recordingDraft((call) => !call.startsWith("delete"));
    doc.follow(draft);
    doc.open(tourOf([pin("a"), pin("b", 48.5202)]));
    const a = doc.objects()[0]!.object;
    await expect(doc.edit(withCaption(a, "x"), "e")?.backedUp).resolves.toBe(
      true,
    );
    await expect(doc.remove("b", "the delete")?.backedUp).resolves.toBe(false);
  });

  it("writes the station poses when a frame moves (the settings record)", () => {
    const doc = fresh();
    const { draft, calls } = recordingDraft();
    doc.follow(draft);
    doc.open(tourOf([pin("a")]));
    const station = doc.state().stations[0]!;
    doc.moveStation(
      station.id,
      { ...station.geo, lat: station.geo.lat + 1e-4 },
      "m",
    );
    expect(calls).toContain(`settings ${JSON.stringify([station.id])}`);
  });

  it("writes nothing for an open, a close or a write landing", () => {
    const doc = fresh();
    const { draft, calls } = recordingDraft();
    doc.follow(draft);
    doc.open(tourOf([pin("a")]));
    doc.edit(withCaption(doc.objects()[0]!.object, "x"), "e");
    calls.length = 0;
    const generation = doc.saveStarted();
    doc.saved({
      generation,
      written: manifestToWrite(doc.state())!,
      appliedDeletions: [],
      stationsAtStart: doc.state().stations,
    });
    doc.saveEnded(generation);
    doc.close();
    expect(calls).toEqual([]);
  });
});

describe("the creator's document: the tour as opened", () => {
  // Why (the r880 milestone review LOW-5): the phone's draft compares its
  // records with the tour as HOSTED - the file opened, not what a Finish
  // wrote since nor this page's changes - and reads it from here rather
  // than keeping a copy of its own.
  it("is the file opened, through changes and a Finish; none without a tour", () => {
    const doc = fresh();
    expect(doc.opened()).toBeNull();
    const file = tourOf([pin("a")]);
    doc.open(file);
    doc.edit(withCaption(doc.objects()[0]!.object, "x"), "e");
    const generation = doc.saveStarted();
    doc.saved({
      generation,
      written: manifestToWrite(doc.state())!,
      appliedDeletions: [],
      stationsAtStart: doc.state().stations,
    });
    doc.saveEnded(generation);
    expect(doc.manifest()).not.toBe(file);
    expect(doc.opened()).toBe(file);
    doc.close();
    expect(doc.opened()).toBeNull();
  });
});

describe("the creator's document: the tour's name (plan W2, §23 #8)", () => {
  // Why these tests matter: the phone's name used to reach only its
  // Finish, unchecked - a name alone was never saved, and a name over the
  // format's 80 characters was written. It is a document change now,
  // checked by the desktop's own rule, and counted as work.
  it("renames the tour as a change of the document, and counts it as work", async () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")], { title: "Old" }));
    expect(doc.tourChanged()).toBe(false);
    const renamed = doc.rename("  Castle walk ");
    expect(renamed.kind).toBe("renamed");
    const backedUp = renamed.kind === "renamed" ? await renamed.backedUp : null;
    expect(backedUp).toBe(true);
    expect(doc.manifest()?.title).toBe("Castle walk");
    expect(doc.tourChanged()).toBe(true);
  });

  it("removes the title for an emptied name, and says nothing changed for the same one", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")], { title: "Old" }));
    expect(doc.rename("Old").kind).toBe("unchanged");
    expect(doc.rename("   ").kind).toBe("renamed");
    expect(doc.manifest()?.title).toBeUndefined();
  });

  it("refuses a name over 80 characters, counted as a reader counts them", () => {
    // §23 #8: characters are code points, not UTF-16 units - 80 emoji are
    // 160 units and still a valid name.
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    const refused = doc.rename("x".repeat(81));
    expect(refused).toEqual({
      kind: "refused",
      reason: "The name is longer than 80 characters.",
    });
    expect(doc.manifest()?.title).toBeUndefined();
    expect(doc.rename("\u{1F3F0}".repeat(80)).kind).toBe("renamed");
  });

  it("keeps the tour's other details when it renames", () => {
    const doc = fresh();
    doc.open(
      tourOf([pin("a")], {
        title: "Old",
        description: "A walk around the castle.",
        contact: "https://example.org",
      }),
    );
    doc.rename("New");
    expect(doc.manifest()).toMatchObject({
      title: "New",
      description: "A walk around the castle.",
      contact: "https://example.org",
    });
  });

  it("counts a station moved with no items as work too", () => {
    const doc = fresh();
    doc.open(
      tourOf([], {
        stations: [
          {
            id: "empty",
            geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
            activateRadiusM: 50,
            foundRadiusM: 25,
            hint: "arrow",
            steps: [],
            blocks: [],
          },
        ],
      }),
    );
    doc.moveStation(
      "empty",
      { lat: 48.5201, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
      "a station",
    );
    expect(doc.entries()).toEqual([]);
    expect(doc.tourChanged()).toBe(true);
  });
});

// Why (owner decision D8 of the editor round-2 plan, 2026-10-18): places
// closer than about 40 m cannot be separated by any automatic radius, so
// the phone's "New station here" makes the NEXT placed item start its own
// station even within the radius. The arm is a flag of the shared slice,
// not the page's module scope; the placement goes through the document's
// own path (an object naming a station the tour lacks), so the HUD, the
// draft, the undo and the Finish all see the same station. The document
// starts the station when its caller ASKS (`ownStation`): the caller takes
// the arm when the item is committed (a photo's shutter tap, not its
// encode's end), so the document never reads the arm itself.
describe("the creator's document: 'New station here' (D8)", () => {
  /** About 5 m north of `pin("a")`'s station anchor: within R (25 m). */
  const NEAR = 48.52 + 5 / 111_320;
  const OWN = { ownStation: true } as const;

  function opened() {
    const store = createTourViewerStore();
    const doc = createCreatorDocument(store);
    doc.open(tourOf([pin("a")]));
    return { doc, store };
  }

  it("is off until armed; arming and disarming are no edit of the tour", () => {
    const doc = fresh();
    const { draft, calls } = recordingDraft();
    doc.follow(draft);
    doc.open(tourOf([pin("a")]));
    expect(doc.newStationArmed()).toBe(false);
    const revision = doc.revision();
    doc.armNewStation(true);
    expect(doc.newStationArmed()).toBe(true);
    doc.armNewStation(false);
    expect(doc.newStationArmed()).toBe(false);
    expect(doc.revision()).toBe(revision);
    expect(calls).toEqual([]);
    expect(doc.undo()).toEqual({ kind: "nothing" });
  });

  it("without it, a pin 5 m from a station joins it (the rule D8 overrides)", () => {
    const { doc } = opened();
    expect(doc.place(pin("b", NEAR), {}, "a pin")?.ownStation).toBe(false);
    const stations = stationsAsFinished({ state: doc.state() });
    expect(stations.map((s) => s.itemIds)).toEqual([["a", "b"]]);
  });

  it("starts the placement's own station, anchored at it, within the radius", () => {
    const { doc } = opened();
    const change = doc.place(pin("b", NEAR), OWN, "a pin");
    expect(change?.ownStation).toBe(true);
    const stations = stationsAsFinished({ state: doc.state() });
    expect(stations.map((s) => s.itemIds)).toEqual([["a"], ["b"]]);
    expect(stations[1]).toMatchObject({
      started: true,
      anchor: { lat: NEAR, lon: 9.05, alt: 340 },
    });
    // What the Finish writes is what the HUD says.
    const written = manifestToWrite(doc.state());
    expect(written?.stations.map((s) => s.blocks.map((i) => i.id))).toEqual([
      ["a"],
      ["b"],
    ]);
  });

  it("follows its caller, never the arm: the caller takes the arm when the item is committed", () => {
    // A photo armed at its shutter tap lands after the visit ended (and
    // its arm with it); a photo shot BEFORE the creator armed lands while
    // the arm waits for the next item. Both are decided by the caller.
    const { doc } = opened();
    doc.armNewStation(true);
    expect(doc.place(pin("b", NEAR), {}, "a pin")?.ownStation).toBe(false);
    expect(doc.newStationArmed()).toBe(true);
    doc.armNewStation(false);
    expect(doc.place(pin("c", NEAR), OWN, "a pin")?.ownStation).toBe(true);
    expect(doc.newStationArmed()).toBe(false);
    expect(
      stationsAsFinished({ state: doc.state() }).map((s) => s.itemIds),
    ).toEqual([["a", "b"], ["c"]]);
  });

  it("a placement after it follows the rule again", () => {
    const { doc } = opened();
    doc.place(pin("b", NEAR), OWN, "a pin");
    // 1 m past "b": nearer b's new station than a's, so it joins b's.
    const after = doc.place(pin("c", NEAR + 1 / 111_320), {}, "a pin");
    expect(after?.ownStation).toBe(false);
    const stations = stationsAsFinished({ state: doc.state() });
    expect(stations.map((s) => s.itemIds)).toEqual([["a"], ["b", "c"]]);
  });

  it("two such placements in a row start two stations, even 1 m apart", () => {
    const { doc } = opened();
    const first = doc.place(pin("b", NEAR), OWN, "a pin");
    const second = doc.place(pin("c", NEAR + 1 / 111_320), OWN, "a pin");
    expect(first?.object.station).toBeDefined();
    expect(second?.object.station).toBeDefined();
    expect(second?.object.station).not.toBe(first?.object.station);
    expect(
      stationsAsFinished({ state: doc.state() }).map((s) => s.itemIds),
    ).toEqual([["a"], ["b"], ["c"]]);
  });

  it("a refused placement starts nothing", () => {
    const { doc } = opened();
    // An id the tour carries: refused by the slice's guard.
    expect(doc.place(pin("a"), OWN, "a pin")).toBeNull();
    expect(stationsAsFinished({ state: doc.state() })).toHaveLength(1);
  });

  it("an undo removes the new station and a redo brings the same station back; neither re-arms", () => {
    const { doc, store } = opened();
    const placed = doc.place(pin("b", NEAR), OWN, "a pin");
    const own = placed?.object.station;
    expect(own).toBeDefined();
    expect(doc.undo()).toMatchObject({ kind: "undone", what: "a pin" });
    expect(
      stationsAsFinished({ state: doc.state() }).map((s) => s.itemIds),
    ).toEqual([["a"]]);
    expect(doc.newStationArmed()).toBe(false);
    store.dispatch(tourDocumentActions.redone());
    expect(doc.entries().find((e) => e.object.id === "b")?.object.station).toBe(
      own,
    );
    expect(
      stationsAsFinished({ state: doc.state() }).map((s) => s.itemIds),
    ).toEqual([["a"], ["b"]]);
    expect(manifestToWrite(doc.state())?.stations.map((s) => s.id)).toContain(
      own,
    );
    expect(doc.newStationArmed()).toBe(false);
  });

  it("writes the placement into the draft naming its own station, so a reload keeps it apart", () => {
    // Why: the station is the document's from the placement on, so the
    // draft keeps its whole frame (the settings record's created
    // stations) beside the object naming it. Without the frame a reload
    // would seat "b" by the rule - into a's station, 5 m away.
    const doc = fresh();
    const saved: TourObject[] = [];
    let settings: TourSettingsRecord | null = null;
    const { draft } = recordingDraft();
    doc.follow({
      ...draft,
      saveObject: (object) => {
        saved.push(object);
        return Promise.resolve(true);
      },
      saveSettings: (record) => {
        settings = record;
        return Promise.resolve(true);
      },
    });
    doc.open(tourOf([pin("a")]));
    doc.place(pin("b", NEAR), OWN, "a pin");
    const own = saved.find((o) => o.id === "b")?.station;
    expect(own).toBeDefined();
    expect(own).not.toBe(doc.state().stations[0]!.id);
    // The record as a later open reads it back from disk.
    const read = parseSettingsRecord(settingsRecordText(settings!));
    expect(read?.createdStations?.map((f) => f.id)).toEqual([own]);
    // A later page restoring those records starts the same separate
    // station, anchored where it stood.
    const reloaded = fresh();
    reloaded.open(tourOf([pin("a")]));
    reloaded.restore(
      {
        objects: saved,
        deleted: [],
        pictures: new Map(),
        createdStations: read?.createdStations ?? [],
      },
      "the draft",
    );
    expect(
      stationsAsFinished({ state: reloaded.state() }).map((s) => s.itemIds),
    ).toEqual([["a"], ["b"]]);
    expect(reloaded.state().stations[1]).toEqual(doc.state().stations[1]);
    // The control: the objects alone come back by the rule, into a's.
    const bare = fresh();
    bare.open(tourOf([pin("a")]));
    bare.restore(
      { objects: saved, deleted: [], pictures: new Map() },
      "the draft",
    );
    expect(
      stationsAsFinished({ state: bare.state() }).map((s) => s.itemIds),
    ).toEqual([["a", "b"]]);
  });

  it("is disarmed by a tour opening or closing", () => {
    const { doc } = opened();
    doc.armNewStation(true);
    doc.open(tourOf([pin("x")]));
    expect(doc.newStationArmed()).toBe(false);
    doc.armNewStation(true);
    doc.close();
    expect(doc.newStationArmed()).toBe(false);
  });
});
