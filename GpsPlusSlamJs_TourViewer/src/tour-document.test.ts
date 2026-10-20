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
  TourModel,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { serializeTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { TOUR_ITEM_MAX_OFFSET_M } from "gps-plus-slam-app-framework/ar/tour-items";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { horizontalM } from "./move-with-code.js";
import {
  canPlace,
  placeRefusal,
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

// --- every object belongs to a station -------------------------------------

/** A point `north` m north and `east` m east of (48.6, 9.1), at 400 m: the
 *  stations' tests build their own tour there, away from OPENED's. */
function spot(north: number, east = 0): TourObject["geo"] {
  const g = calcGpsCoords({ lat: 48.6, lon: 9.1 }, [north, 0, east]);
  return { lat: g.lat, lon: g.lon, alt: 400, rotation: [0, 0, 0, 1] };
}

/** An empty station anchored at `north`/`east`, found within `radiusM`. */
function stationAt(
  id: string,
  north: number,
  radiusM = 25,
  extra: Partial<TourStation> = {},
): TourStation {
  const { lat, lon, alt } = spot(north);
  return {
    id,
    geo: { lat, lon, alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: 50,
    foundRadiusM: radiusM,
    hint: "arrow",
    steps: [],
    items: [],
    ...extra,
  };
}

/** A tour of `stations` (no objects yet): one pin each keeps them from
 *  being automatic empties nobody placed into. */
function tourWith(...stations: TourStation[]): TourDocumentState {
  return open({ version: 3, minor: 0, order: "fixed", assets: [], stations });
}

function pinAt(id: string, geo: TourObject["geo"]): TourObject {
  return { ...pin(id), geo };
}

function stationOf(state: TourDocumentState, id: string): string | undefined {
  return objectOf(state, id).station;
}

function place(
  state: TourDocumentState,
  object: TourObject,
  newStationId = `new-${object.id}`,
  newStation = false,
): TourDocumentState {
  return reduce(
    state,
    act.placed({
      object,
      what: "p",
      newStationId,
      ...(newStation ? { newStation: true } : {}),
    }),
  );
}

function moveTo(
  state: TourDocumentState,
  id: string,
  geo: TourObject["geo"],
  newStationId = `moved-${id}`,
): TourDocumentState {
  return reduce(
    state,
    act.moved({
      object: { ...objectOf(state, id), geo },
      what: "m",
      newStationId,
    }),
  );
}

// Why (everything belongs to a station, from the moment it is placed): the
// station a pin or a photo is in is decided by the document's own reducer
// when it is placed or moved - never later by a write - so the phone's HUD,
// the settle, the desktop and the file all read one answer. These pin the
// rule's edges at the slice: the station's OWN found radius (25 m by
// default, a creator may change it), inclusive; a tie to the earlier
// station; the nearest of two; a new station otherwise.
describe("tour document: every object belongs to a station", () => {
  it("a new object joins the station whose own found radius holds it, the radius itself inside", () => {
    const at = spot(12, 5);
    const exact = horizontalM(spot(0), at);
    const holds = place(tourWith(stationAt("s", 0, exact)), pinAt("p", at));
    expect(stationOf(holds, "p")).toBe("s");
    expect(holds.stations.map((s) => s.id)).toEqual(["s"]);
    // A micrometre less: the radius no longer holds it, a new station does.
    const beyond = place(
      tourWith(stationAt("s", 0, exact - 1e-6)),
      pinAt("p", at),
    );
    expect(stationOf(beyond, "p")).toBe("new-p");
  });

  it("reads the station's own radius, not 25 m: 10 m from a 5 m station starts a new one, from a 40 m one 30 m away joins", () => {
    expect(
      stationOf(
        place(tourWith(stationAt("s", 0, 5)), pinAt("p", spot(10))),
        "p",
      ),
    ).toBe("new-p");
    expect(
      stationOf(
        place(tourWith(stationAt("s", 0, 40)), pinAt("p", spot(30))),
        "p",
      ),
    ).toBe("s");
  });

  it("a tie goes to the earlier station; of two that hold it, the nearer", () => {
    const two = tourWith(stationAt("south", -10), stationAt("north", 10));
    expect(stationOf(place(two, pinAt("p", spot(0))), "p")).toBe("south");
    expect(stationOf(place(two, pinAt("p", spot(1))), "p")).toBe("north");
    expect(stationOf(place(two, pinAt("p", spot(-1))), "p")).toBe("south");
  });

  it("beyond every radius it starts a station anchored at itself, with the automatic radii, in the document at once", () => {
    let state = tourWith(stationAt("s", 0));
    const at = spot(60, 3);
    state = place(state, pinAt("p", at), "fresh");
    expect(state.stations.at(-1)).toEqual({
      id: "fresh",
      geo: { lat: at.lat, lon: at.lon, alt: at.alt, rotation: [0, 0, 0, 1] },
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow",
      steps: [],
    });
    expect(manifestNow(state)!.stations.map((s) => s.id)).toEqual([
      "s",
      "fresh",
    ]);
    expect(stationOf(state, "p")).toBe("fresh");
    const written = manifestToWrite(state)!;
    expect(written.stations[1]!.items.map((i) => i.id)).toEqual(["p"]);
  });

  it("'New station here' starts its own station even within another's radius", () => {
    const state = place(
      tourWith(stationAt("s", 0)),
      pinAt("p", spot(3)),
      "own",
      true,
    );
    expect(stationOf(state, "p")).toBe("own");
    expect(state.stations.map((s) => s.id)).toEqual(["s", "own"]);
    expect(state.stations[1]!.geo.lat).toBe(spot(3).lat);
  });

  it("refuses a station id the document already uses, and an object naming a station it lacks", () => {
    const state = tourWith(stationAt("s", 0));
    // The rule needs a new station and is handed a taken id.
    expect(place(state, pinAt("p", spot(100)), "s")).toEqual(state);
    expect(place(state, pinAt("p", spot(1)), "s", true)).toEqual(state);
    const dangling = { ...pinAt("p", spot(1)), station: "gone" };
    expect(canPlace(state, dangling)).toBe(false);
    expect(objectFits(state, dangling)).toBe(false);
    expect(place(state, dangling)).toEqual(state);
  });

  it("an object naming a station the document carries is placed there", () => {
    const state = place(tourWith(stationAt("s", 0), stationAt("t", 100)), {
      ...pinAt("p", spot(1)),
      station: "t",
    });
    expect(stationOf(state, "p")).toBe("t");
  });

  it("a move within its station's radius keeps it, even nearer another's anchor; out of it, it joins the station holding its new spot or starts one", () => {
    let state = tourWith(stationAt("s", 0), stationAt("t", 30));
    state = place(state, pinAt("p", spot(0)));
    state = place(state, pinAt("q", spot(30)));
    // 20 m north: 10 m from t's anchor, but still inside s's 25 m.
    state = moveTo(state, "p", spot(20));
    expect(stationOf(state, "p")).toBe("s");
    // 26 m north: out of s (by 1 m), inside t.
    state = moveTo(state, "p", spot(26));
    expect(stationOf(state, "p")).toBe("t");
    // Far away: a new station anchored there.
    state = moveTo(state, "p", spot(200), "far");
    expect(stationOf(state, "p")).toBe("far");
    expect(state.stations.find((s) => s.id === "far")!.geo.lat).toBe(
      spot(200).lat,
    );
  });

  it("a move out of a station it alone held drops that station, and a move back joins the one holding the spot", () => {
    let state = tourWith(stationAt("s", 0));
    state = place(state, pinAt("q", spot(0)));
    state = place(state, pinAt("p", spot(100)), "auto");
    expect(state.stations.map((s) => s.id)).toEqual(["s", "auto"]);
    state = moveTo(state, "p", spot(5));
    expect(stationOf(state, "p")).toBe("s");
    expect(state.stations.map((s) => s.id)).toEqual(["s"]);
    state = moveTo(state, "p", spot(100), "again");
    expect(stationOf(state, "p")).toBe("again");
    expect(state.stations.map((s) => s.id)).toEqual(["s", "again"]);
  });

  // Why: a station's found radius has no upper bound (a hand-edited file
  // may carry 50 km), but the format keeps an item within 10 km of its
  // station per axis. Seated by the radius alone, the object stood beyond
  // the format's reach and every later save failed.
  it("never seats a new object in a station whose radius holds it beyond the format's reach: it starts its own", () => {
    const huge = tourWith(stationAt("huge", 0, 50_000));
    const state = place(huge, pinAt("p", spot(20_000)));
    expect(stationOf(state, "p")).toBe("new-p");
    expect(state.stations.map((s) => s.id)).toEqual(["huge", "new-p"]);
    expect(manifestToWrite(state)).not.toBeNull();
    // Within the reach, the same station still takes it (the control).
    expect(stationOf(place(huge, pinAt("p", spot(9_000))), "p")).toBe("huge");
  });

  // Why: a move inside the station's radius but beyond the format's reach
  // changed nothing, while the page reported the move as made.
  it("a move within a huge radius but beyond the format's reach re-seats the object rather than changing nothing", () => {
    let state = place(
      tourWith(stationAt("huge", 0, 50_000)),
      pinAt("p", spot(0)),
    );
    expect(stationOf(state, "p")).toBe("huge");
    state = moveTo(state, "p", spot(15_000));
    expect(objectOf(state, "p").geo.lat).toBe(spot(15_000).lat);
    expect(stationOf(state, "p")).toBe("moved-p");
  });

  // Why: an object can stand outside its own station's found radius (the
  // creator shrank the radius, or moved the station). A small nudge of it
  // must not start a station of its own: it keeps its station unless the
  // move takes it farther from the anchor than it was, or into another
  // station's radius. The rule is strict - any move farther out, however
  // small, re-seats it.
  it("an object outside its station's radius keeps its station when nudged no farther out; farther out, or into another station's radius, the rule seats it", () => {
    const outside = place(tourWith(stationAt("s", 0), stationAt("t", 60)), {
      ...pinAt("p", spot(-40)),
      station: "s",
    });
    expect(stationOf(outside, "p")).toBe("s");
    const nudged = moveTo(outside, "p", spot(-39, 1));
    expect(stationOf(nudged, "p")).toBe("s");
    expect(nudged.stations.map((s) => s.id)).toEqual(["s", "t"]);
    const sideways = moveTo(outside, "p", spot(-1, -39));
    expect(stationOf(sideways, "p")).toBe("s");
    const fartherOut = moveTo(outside, "p", spot(-41));
    expect(stationOf(fartherOut, "p")).toBe("moved-p");
    // Nearer s's anchor than before, and into t's radius: t holds it.
    const intoT = place(tourWith(stationAt("s", 0), stationAt("t", 60)), {
      ...pinAt("p", spot(45, 30)),
      station: "s",
    });
    expect(stationOf(moveTo(intoT, "p", spot(40)), "p")).toBe("t");
  });

  // Why: radii overlap. An object of s that already stood inside t's
  // radius (and outside s's) was re-seated into t by any nudge toward s:
  // t held the spot before the move as much as after it, so the move did
  // not take the object anywhere new.
  it("an object of one station standing inside another's radius keeps its station when nudged toward its own anchor", () => {
    const overlap = place(tourWith(stationAt("s", 0), stationAt("t", 60)), {
      ...pinAt("p", spot(40)),
      station: "s",
    });
    expect(stationOf(overlap, "p")).toBe("s");
    const nudged = moveTo(overlap, "p", spot(38));
    expect(stationOf(nudged, "p")).toBe("s");
    expect(nudged.stations.map((s) => s.id)).toEqual(["s", "t"]);
    // Farther from s's anchor it is the rule's again: t holds it.
    expect(stationOf(moveTo(overlap, "p", spot(42)), "p")).toBe("t");
  });

  it("a delete that empties an automatic station drops it in the same step; an undo brings both back as they were", () => {
    let state = tourWith(stationAt("s", 0));
    state = place(state, pinAt("q", spot(0)));
    state = place(state, pinAt("p", spot(100)), "auto");
    const before = state;
    state = reduce(state, act.deleted({ id: "p", what: "d" }));
    expect(state.stations.map((s) => s.id)).toEqual(["s"]);
    expect(manifestToWrite(state)!.stations.map((s) => s.id)).toEqual(["s"]);
    state = reduce(state, act.undone());
    expect(state.stations).toEqual(before.stations);
    expect(stationOf(state, "p")).toBe("auto");
  });

  it("a station with a title, a step, a route to it or a recorded photo stays when its last object goes", () => {
    const keeps: [string, TourDocumentState][] = [
      ["a title", tourWith(stationAt("k", 0, 25, { title: "Gate" }))],
      [
        "a step",
        tourWith(
          stationAt("k", 0, 25, {
            steps: [
              {
                id: "x",
                block: { kind: "text", text: "Hi" },
                advance: { mode: "tap" },
              },
            ],
          }),
        ),
      ],
      [
        "a route to it",
        tourWith(stationAt("k", 0), stationAt("r", 500, 25, { next: "k" })),
      ],
      [
        "a recorded photo",
        open({
          version: 3,
          minor: 0,
          order: "fixed",
          assets: [],
          stations: [stationAt("k", 0)],
          captureSpots: {
            fixes: 3,
            gpsAccuracyMedianM: 4,
            captures: [
              {
                image: "images/frame-0.png",
                station: "k",
                pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              },
            ],
          },
        }),
      ],
    ];
    for (const [why, opened] of keeps) {
      let state = place(opened, pinAt("p", spot(1)));
      expect(stationOf(state, "p"), why).toBe("k");
      state = reduce(state, act.deleted({ id: "p", what: "d" }));
      expect(
        state.stations.map((s) => s.id),
        why,
      ).toContain("k");
    }
    // ... and an automatic one does not (the control).
    let state = place(tourWith(stationAt("k", 0)), pinAt("p", spot(1)));
    state = reduce(state, act.deleted({ id: "p", what: "d" }));
    expect(state.stations).toEqual([]);
  });

  it("an undo of a placement that started a station gives the stations back deep-equal", () => {
    const opened = tourWith(stationAt("s", 0));
    const placed = place(opened, pinAt("p", spot(90)));
    expect(placed.stations).toHaveLength(2);
    const undone = reduce(placed, act.undone());
    expect(undone.stations).toEqual(opened.stations);
    expect(documentObjects(undone)).toEqual([]);
  });

  // Why: a Finish snapshots the station frames when it starts; a pin placed
  // while it runs starts a station the write does not carry. Read as a
  // moved frame, the landing would throw that station away (the written
  // frames replace the document's) and leave the pin naming nothing.
  it("a placement while a save runs keeps the station it started when the save lands", () => {
    let state = tourWith(stationAt("s", 0));
    state = place(state, pinAt("q", spot(0)));
    const written = manifestToWrite(state)!;
    const stationsAtStart = state.stations;
    state = place(state, pinAt("p", spot(300)), "late");
    state = reduce(
      state,
      act.saved({
        generation: state.generation,
        written,
        appliedDeletions: [],
        stationsAtStart,
      }),
    );
    expect(state.stations.map((s) => s.id)).toEqual(["s", "late"]);
    expect(stationOf(state, "p")).toBe("late");
    expect(unsavedEntries(state).map((p) => p.object.id)).toEqual(["p"]);
    expect(manifestToWrite(state)!.stations.map((s) => s.id)).toEqual([
      "s",
      "late",
    ]);
  });

  it("a restored object naming a station the document lacks joins by the rule, and a draft's created station comes back first", () => {
    const state = tourWith(stationAt("s", 0));
    const created = stationAt("made", 400);
    const { items: _items, ...frame } = created;
    const restored = reduce(
      state,
      act.restored({
        objects: [
          { ...pinAt("near", spot(2)), station: "gone" },
          { ...pinAt("there", spot(401)), station: "made" },
          { ...pinAt("lost", spot(800)), station: "gone2" },
        ],
        deleted: [],
        createdStations: [frame],
        newStationIds: ["m1", "m2", "m3"],
        what: "r",
      }),
    );
    expect(stationOf(restored, "near")).toBe("s");
    expect(stationOf(restored, "there")).toBe("made");
    expect(stationOf(restored, "lost")).toBe("m3");
    expect(restored.stations.map((s) => s.id)).toEqual(["s", "made", "m3"]);
  });

  it("work carried into a newly opened tour re-runs the rule against its stations", () => {
    const state = tourWith(stationAt("s", 0));
    const restored = reduce(
      state,
      act.restored({
        objects: [
          { ...pinAt("a1", spot(3)), station: "pre-open" },
          { ...pinAt("a2", spot(500)), station: "pre-open" },
        ],
        deleted: [],
        rerun: true,
        newStationIds: ["n1", "n2"],
        what: "carried",
      }),
    );
    expect(stationOf(restored, "a1")).toBe("s");
    expect(stationOf(restored, "a2")).toBe("n2");
    expect(restored.stations.map((s) => s.id)).toEqual(["s", "n2"]);
  });

  // Why: the rule reads the stations of the tour as the next write starts
  // from it, and that includes a station the file carries which the
  // document dropped since (emptied after the save that wrote it). An
  // object seated there must bring the frame back into the document, or it
  // would name a station the document does not carry - one an edit, a
  // move and a reload could not find. Found by the station-rule property.
  it("an object the rule seats in a written station the document dropped brings that station back", () => {
    let state = tourWith(stationAt("s", 0));
    state = reduce(
      state,
      act.restored({
        objects: [{ ...pinAt("r", spot(100)), station: "gone" }],
        deleted: [],
        newStationIds: ["far"],
        what: "r",
      }),
    );
    state = save(state);
    // Back into "s": "far" is emptied and goes from the document, while the
    // file still carries it.
    state = moveTo(state, "r", spot(3));
    expect(state.stations.map((s) => s.id)).toEqual(["s"]);
    expect(manifestNow(state)!.stations.map((s) => s.id)).toContain("far");
    state = place(state, pinAt("q", spot(101)));
    expect(stationOf(state, "q")).toBe("far");
    expect(state.stations.map((s) => s.id)).toEqual(["s", "far"]);
  });

  // Why: as for a placement, the deletion of an id hides every object of
  // that id, so restoring one over it would put back an object nobody
  // sees - and a station started for it would stand empty. The pages give
  // live deletions the win already; the reducer keeps the same rule.
  it("a restore leaves out an object of an id the document deleted, starting no station for it", () => {
    let state = tourWith(stationAt("s", 0));
    state = place(state, pinAt("r", spot(3)));
    state = save(state);
    state = reduce(state, act.deleted({ id: "r", what: "d" }));
    const after = reduce(
      state,
      act.restored({
        objects: [{ ...pinAt("r", spot(200)), station: "gone" }],
        deleted: [],
        newStationIds: ["far"],
        what: "r",
      }),
    );
    expect(after.stations).toEqual(state.stations);
    expect(after.placed).toEqual(state.placed);
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
    // Each refusal named, so a page says the actual reason.
    expect(placeRefusal(state, a)).toBe("exists");
    const tooFar: TourObject = {
      ...pin("n"),
      station: stationIdOf("a"),
      geo: { ...a.geo, lat: a.geo.lat + far },
    };
    expect(canPlace(state, tooFar)).toBe(false);
    expect(placeRefusal(state, tooFar)).toBe("too-far");
    expect(reduce(state, act.placed({ object: tooFar, what: "p" }))).toEqual(
      state,
    );
    const near: TourObject = { ...tooFar, geo: a.geo };
    expect(canPlace(state, near)).toBe(true);
    expect(placeRefusal(state, near)).toBeNull();
    expect(
      documentObjects(reduce(state, act.placed({ object: near, what: "p" })))
        .map((o) => o.object.id)
        .sort(),
    ).toEqual(["a", "b", "f", "n"]);
  });

  it("placing the id of an object the file holds but the document deleted changes nothing", () => {
    // Why: the deletion hides every object of that id, so the placement
    // would be invisible - and a station started for it would stand empty.
    // Pages mint fresh ids, so only a stale or replayed id comes here.
    const state = reduce(open(), act.deleted({ id: "a", what: "d" }));
    const again: TourObject = { ...pin("a"), geo: spot(200) };
    expect(canPlace(state, again)).toBe(false);
    expect(placeRefusal(state, again)).toBe("deleted");
    expect(reduce(state, act.placed({ object: again, what: "p" }))).toEqual(
      state,
    );
  });

  // Why: an edit keeps its object's station, so a spot that station cannot
  // carry would make every save fail; a MOVE that far re-runs the station
  // rule instead (the object leaves its station's radius long before the
  // format's bound), so it is never refused for its distance.
  it("an edit to a spot too far from its station changes nothing; a move there starts a station at its new spot", () => {
    const state = open();
    const a = objectOf(state, "a");
    const moved = { ...a, geo: { ...a.geo, lat: a.geo.lat + far } };
    expect(objectFits(state, moved)).toBe(false);
    expect(reduce(state, act.edited({ object: moved, what: "e" }))).toEqual(
      state,
    );
    const after = reduce(
      state,
      act.moved({ object: moved, what: "m", newStationId: "far" }),
    );
    expect(objectOf(after, "a").station).toBe("far");
    // The station it left held it alone, and goes with it.
    expect(after.stations.map((s) => s.id)).toEqual([
      stationIdOf("b"),
      stationIdOf("f"),
      "far",
    ]);
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

  // Why (the M5a milestone review L1, kept): a draft object its station
  // cannot carry would make every save fail. It is no longer skipped: it
  // is seated by the station rule, as a move there would be.
  it("a restore seats an object its station cannot carry by the station rule", () => {
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
        newStationIds: ["far", "unused"],
        what: "r",
      }),
    );
    expect(restored.placed.map((p) => p.object.id)).toEqual(["a", "b"]);
    expect(objectOf(restored, "a").station).toBe("far");
    expect(objectOf(restored, "b").station).toBe(stationIdOf("b"));
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

  it("a move on the map: height and facing kept, never too far (the station rule seats it), an unknown id missing", () => {
    const state = open();
    const a = objectOf(state, "a");
    expect(objectMoveChange(state, "a", 48.5205, 9.051)).toEqual({
      kind: "moved",
      before: a,
      after: { ...a, geo: { ...a.geo, lat: 48.5205, lon: 9.051 } },
    });
    const far = (TOUR_ITEM_MAX_OFFSET_M * 2) / 111_320;
    expect(objectMoveChange(state, "a", a.geo.lat + far, 9.05)).toMatchObject({
      kind: "moved",
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

// Why: a placed 3D model (format minor 1) carries its size in metres, a
// number no page can edit yet. The document must carry it through every
// edit, station move and save untouched - a page that dropped it, or
// rounded it, would rewrite the creator's file without a word.
describe("tour document: a placed 3D model rides along unchanged", () => {
  const model: TourModel = {
    id: "m",
    kind: "model",
    asset: "statue",
    sizeM: 12.345678901234,
    label: "The fountain",
    createdAtIso: "2026-10-19T12:00:00.000Z",
    geo: { lat: 48.5203, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
  const withModel = tourOf([pin("a"), model], {
    assets: [{ id: "statue", path: "content/statue.glb", kind: "model" }],
  });

  it("keeps the model, its asset and its size exactly through an edit, a station move and a save", () => {
    let state = open(withModel);
    const { geo: _geo, ...fields } = model;
    expect(objectOf(state, "m")).toMatchObject({
      ...fields,
      station: stationIdOf("m"),
    });
    state = reduce(
      state,
      act.edited({ object: { ...pin("a"), label: "x" }, what: "e" }),
    );
    const station = stationIdOf("m");
    const was = withModel.stations.find((s) => s.id === station)!;
    state = reduce(
      state,
      act.stationMoved({
        stationId: station,
        geo: { ...was.geo, lat: was.geo.lat + 0.0001 },
        what: "the move of the station",
      }),
    );
    const written = manifestToWrite(state)!;
    const item = written.stations.find((s) => s.id === station)!.items[0]!;
    expect(item).toEqual(was.items[0]);
    // The file the save writes carries it at minor 1, readable again.
    const json = JSON.parse(serializeTourManifest(written)) as {
      minor: number;
    };
    expect(json.minor).toBe(1);
    const saved = save(state);
    expect(objectOf(saved, "m")).toMatchObject({
      kind: "model",
      asset: "statue",
      sizeM: model.sizeM,
    });
    expect(changeCount(saved)).toBe(0);
  });
});
