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
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { createCreatorDocument } from "./creator-document.js";
import { manifestToWrite } from "./tour-document.js";
import type { TourDocumentDraft } from "./tour-document-draft.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import { tourOf } from "./test-support/v3-tour.js";

function pin(id: string, lat = 48.52): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-10-19T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
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

  it("refuses a move beyond its station's reach", () => {
    const doc = fresh();
    doc.open(tourOf([pin("a")]));
    const a = doc.objects()[0]!.object;
    // Far beyond the format's per-axis bound (TOUR_ITEM_MAX_OFFSET_M).
    expect(doc.move({ ...a, geo: { ...a.geo, lat: 49.5 } }, "far")).toBeNull();
    expect(doc.entries()).toEqual([]);
  });

  it("keeps an object's AR placement across an edit, replaces it on a move in AR", () => {
    const doc = fresh();
    doc.open(tourOf([]));
    doc.place(pin("p"), { placement: PLACEMENT }, "a pin");
    doc.edit({ ...pin("p"), label: "New" }, "the text");
    expect(doc.entries()[0]?.placement).toEqual(PLACEMENT);
    const moved = { ...PLACEMENT, visit: 2 };
    doc.move({ ...pin("p"), label: "New" }, "the move", moved);
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

  it("reports a write that did not land to the change that caused it", async () => {
    const doc = fresh();
    const { draft } = recordingDraft((call) => !call.startsWith("delete"));
    doc.follow(draft);
    doc.open(tourOf([pin("a"), pin("b", 48.5202)]));
    const a = doc.objects()[0]!.object;
    await expect(doc.edit({ ...a, label: "x" }, "e")?.backedUp).resolves.toBe(
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
    doc.edit({ ...doc.objects()[0]!.object, label: "x" }, "e");
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
            items: [],
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
