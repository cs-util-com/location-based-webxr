/**
 * Why these tests matter: in the document a free item is an object of the
 * world (its own record, a tombstone when it goes) while a story's entries
 * live in the station's frame. A move between the two is a delete on one
 * side and an add on the other, so a move that forgot either half would
 * write an id twice (the format refuses the file) or lose the item, and an
 * undo that restored only one half would do the same a step later. Each
 * test writes the tour through the format's own reader and compares the
 * undo with the state before.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { stationContent, storyOf } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  childMoveChange,
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";
import {
  parseSettingsRecord,
  settingsRecord,
  settingsRecordText,
} from "./tour-document-draft.js";

const AT = { lat: 48.52, lon: 9.05, alt: 400 };
const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

function line(id: string, caption: string) {
  return { id, kind: "shortText", view: "card", caption, pose: POSE } as const;
}

const FREE_PIN = {
  id: "well-sign",
  kind: "shortText",
  view: "pin",
  caption: "The well",
  createdAtIso: "2026-11-06T00:00:00.000Z",
  pose: POSE,
} as const;

const OPENED: TourManifest = parseTourManifest(
  JSON.parse(
    serializeTourManifest(
      tourOf([], {
        stations: [
          {
            id: "well",
            title: "The well",
            geo: { ...AT, rotation: [0, 0, 0, 1] },
            activateRadiusM: 50,
            foundRadiusM: 25,
            hint: "arrow",
            ...stationContent([
              storyOf("miller", [line("m1", "The miller")], "The miller"),
              storyOf("baker", [line("b1", "The baker")], "The baker"),
              FREE_PIN,
            ]),
          },
        ],
      }),
    ),
  ),
);

function open(): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest: OPENED }));
}

/** What the next write carries, read back by the format (it refuses an id
 *  twice and a free item that cannot stand in the world). */
function written(state: TourDocumentState): TourManifest {
  const manifest = manifestToWrite(state);
  if (manifest === null) throw new Error("nothing open");
  return parseTourManifest(JSON.parse(serializeTourManifest(manifest)));
}

function storyIds(state: TourDocumentState, story: string): string[] {
  const found = tourStories(written(state).stations[0]!).find(
    (s) => s.id === story,
  );
  return found?.children.map((c) => c.id) ?? [];
}

function freeIds(state: TourDocumentState): string[] {
  return tourFreeBlocks(written(state).stations[0]!).map((b) => b.id);
}

/** The document a reload rebuilds from what the draft stores: the object
 *  records, the tombstones and the settings record's frames. */
function reloaded(state: TourDocumentState): TourDocumentState {
  const record = parseSettingsRecord(
    settingsRecordText(settingsRecord(state)),
    OPENED,
  );
  if (record === undefined) throw new Error("the record did not read");
  return reduce(
    open(),
    act.restored({
      objects: state.placed.map((p) => p.object),
      deleted: state.deleted,
      ...(record.frames === undefined ? {} : { frames: record.frames }),
      what: "restore",
    }),
  );
}

const move = (
  id: string,
  to: Parameters<typeof act.childMoved>[0]["to"],
): ReturnType<typeof act.childMoved> =>
  act.childMoved({ id, to, what: `the move of ${id}` });

describe("a station item moved in the document", () => {
  it("moves a free pin into a story as one step, and undoes it whole", () => {
    const before = open();
    const after = reduce(
      before,
      move("well-sign", { place: "story", story: "baker", index: 0 }),
    );
    expect(storyIds(after, "baker")).toEqual(["well-sign", "b1"]);
    expect(freeIds(after)).toEqual([]);
    expect(documentObjects(after).map((o) => o.object.id)).toEqual([]);
    expect(after.past.length).toBe(before.past.length + 1);
    const undone = reduce(after, act.undone());
    expect(manifestToWrite(undone)).toEqual(manifestToWrite(before));
    const redone = reduce(undone, act.redone());
    expect(manifestToWrite(redone)).toEqual(manifestToWrite(after));
  });

  it("moves a story card out: it stands free as a pin at its pose", () => {
    const before = open();
    const after = reduce(before, move("m1", { place: "free" }));
    expect(storyIds(after, "miller")).toEqual([]);
    expect(freeIds(after)).toEqual(["well-sign", "m1"]);
    const m1 = tourFreeBlocks(written(after).stations[0]!).find(
      (b) => b.id === "m1",
    );
    expect(m1).toMatchObject({ view: "pin", pose: POSE });
    expect(Object.hasOwn(m1 ?? {}, "advance")).toBe(false);
    const undone = reduce(after, act.undone());
    expect(manifestToWrite(undone)).toEqual(manifestToWrite(before));
  });

  // Why: the written pin leaving is a tombstone, its return a re-add of the
  // same id; the object changes must give the pin back, not drop it.
  it("brings a written free pin back out after moving it in", () => {
    let state = open();
    state = reduce(
      state,
      move("well-sign", { place: "story", story: "miller", index: 1 }),
    );
    state = reduce(state, move("well-sign", { place: "free" }));
    expect(freeIds(state)).toEqual(["well-sign"]);
    expect(storyIds(state, "miller")).toEqual(["m1"]);
    expect(state.deleted).toEqual([]);
  });

  it("moves an entry between stories and keeps the rest of the station", () => {
    const after = reduce(
      open(),
      move("b1", { place: "story", story: "miller", index: 0 }),
    );
    expect(storyIds(after, "miller")).toEqual(["b1", "m1"]);
    expect(storyIds(after, "baker")).toEqual([]);
    expect(freeIds(after)).toEqual(["well-sign"]);
  });

  it("reorders the stories", () => {
    const after = reduce(open(), move("baker", { place: "stories", index: 0 }));
    expect(tourStories(written(after).stations[0]!).map((s) => s.id)).toEqual([
      "baker",
      "miller",
    ]);
  });

  it("comes back the same from the draft after moves in, across and out", () => {
    let state = open();
    state = reduce(
      state,
      move("well-sign", { place: "story", story: "baker", index: 1 }),
    );
    state = reduce(state, move("m1", { place: "free" }));
    state = reduce(
      state,
      move("b1", { place: "story", story: "miller", index: 0 }),
    );
    expect(manifestToWrite(reloaded(state))).toEqual(manifestToWrite(state));
    const undone = reduce(state, act.undone());
    expect(manifestToWrite(reloaded(undone))).toEqual(manifestToWrite(undone));
  });

  it("changes nothing for a refused or an empty move", () => {
    const before = open();
    expect(reduce(before, move("well-sign", { place: "free" }))).toBe(before);
    expect(
      reduce(
        before,
        move("miller", { place: "story", story: "baker", index: 0 }),
      ),
    ).toBe(before);
    expect(reduce(before, move("nobody", { place: "free" }))).toBe(before);
  });

  // Why: a picture made here and not yet saved names a file only its own
  // record carries; a story entry is drafted in the station's frame, which
  // a reload reads against the tour's files, so the frame would be lost.
  it("refuses a picture whose file the tour on disk does not hold yet", () => {
    const state = open();
    const picture = {
      id: "snap",
      kind: "picture",
      view: "plane",
      image: "snap",
      imageAsset: { id: "snap", path: "content/snap.jpg" },
      station: "well",
      geo: { ...AT, rotation: [0, 0, 0, 1] },
      widthM: 1,
    };
    const held = {
      ...state,
      placed: [{ object: picture }],
    } as unknown as TourDocumentState;
    expect(
      childMoveChange(held, "snap", {
        place: "story",
        story: "baker",
        index: 0,
      }),
    ).toEqual({ kind: "refused", reason: "unsaved" });
    expect(
      childMoveChange(state, "well-sign", {
        place: "story",
        story: "baker",
        index: 0,
      }),
    ).toMatchObject({ kind: "moved", answers: 0, floored: false });
  });
});
