/**
 * Why these tests matter: Copy and Paste read the selection and the
 * clipboard, both of which can name things a paste must not copy - a
 * station, a story or its entry, something deleted since the copy - and a
 * copied folder already carries what it holds, so a note picked with its
 * folder must not be pasted twice. These rules decide what the Edit menu
 * offers and what the keys do; the document reducer only ever sees what
 * `pasteOf` lets through.
 */
import {
  parseTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import {
  playableStory,
  stationContent,
} from "../test-support/station-content.js";
import { tourOf } from "../test-support/tour-of.js";
import {
  initialTourDocumentState,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
} from "../tour-document.js";
import {
  COPIED_GONE,
  COPY_ONE_KIND,
  copyOf,
  CUT_ONE_KIND,
  CUT_SAME_STATION,
  CUT_STATION_TARGET,
  CUT_STATIONS_IN_PLACE,
  cutGone,
  cutOf,
  FOLDER_STAYS,
  NOTHING_TO_CUT,
  FOLDER_SCALE_TOO_FAR,
  NOTE_IN_RESIZED_FOLDER,
  NOTHING_COPIED,
  NOT_COPYABLE,
  NOTHING_SELECTED,
  pasteOf,
  SELECT_A_TARGET,
} from "./clipboard.js";
import { PASTE_REPEAT_STEP_M } from "../station-geometry.js";
import { initialEditorViewState, type EditorViewState } from "./editor-view.js";

function pin(id: string) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    createdAtIso: "2026-11-02T00:00:00.000Z",
    pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
  } as const;
}

/** Station a: note n, folder f (note m in it, folder g in it with note k),
 *  story t; station b: note e. `scales` resize f and g. */
function opened(scales: { readonly f?: number; readonly g?: number } = {}) {
  const wire = tourOf([], {
    stations: ["a", "b"].map((id, i) => ({
      id,
      title: id,
      geo: {
        lat: 48.52,
        lon: 9.05 + i * 0.002,
        alt: 400,
        rotation: [0, 0, 0, 1],
      },
      activateRadiusM: 40,
      foundRadiusM: 20,
      hint: "arrow",
      ...stationContent(
        id === "a"
          ? [
              pin("n"),
              {
                id: "f",
                kind: "folder",
                title: "F",
                pose: { position: [3, 0, 3], rotation: [0, 0, 0, 1] },
                ...(scales.f === undefined ? {} : { scale: scales.f }),
                children: [
                  pin("m"),
                  {
                    id: "g",
                    kind: "folder",
                    title: "G",
                    pose: { position: [1, 0, 0], rotation: [0, 0, 0, 1] },
                    ...(scales.g === undefined ? {} : { scale: scales.g }),
                    children: [pin("k")],
                  },
                ],
              },
              playableStory("t"),
            ]
          : [pin("e")],
      ),
    })),
  });
  return reduce(
    initialTourDocumentState,
    act.opened({
      manifest: parseTourManifest(JSON.parse(serializeTourManifest(wire))),
    }),
  );
}

function view(
  selected: string | null,
  extra: Partial<EditorViewState> = {},
): EditorViewState {
  return { ...initialEditorViewState, selected, ...extra };
}

describe("what Copy copies", () => {
  const doc = opened();

  it("copies the selected note or plain folder", () => {
    expect(copyOf(doc, view("n"))).toEqual({ kind: "copy", ids: ["n"] });
    expect(copyOf(doc, view("folder:g"))).toEqual({
      kind: "copy",
      ids: ["folder:g"],
    });
  });

  it("copies every picked row, in the order picked", () => {
    expect(copyOf(doc, view("e", { picked: ["folder:f", "e"] }))).toEqual({
      kind: "copy",
      ids: ["folder:f", "e"],
    });
  });

  it("refuses nothing selected", () => {
    expect(copyOf(doc, view(null))).toEqual({
      kind: "refused",
      reason: NOTHING_SELECTED,
    });
  });

  it("copies stations, or stories, alone or picked", () => {
    expect(copyOf(doc, view("station:a"))).toEqual({
      kind: "copy",
      ids: ["station:a"],
    });
    expect(
      copyOf(doc, view(null, { picked: ["station:b", "station:a"] })),
    ).toEqual({ kind: "copy", ids: ["station:b", "station:a"] });
    expect(copyOf(doc, view("story:t"))).toEqual({
      kind: "copy",
      ids: ["story:t"],
    });
  });

  // A story's entry belongs to its story, a code is read-only, and an
  // unknown id names nothing; one of them among picked rows refuses the
  // lot, rather than copying part of what the creator meant.
  it.each([
    ["a story's entry", "t-card"],
    ["an unknown id", "nope"],
    ["an unknown folder", "folder:nope"],
    ["an unknown station", "station:nope"],
    ["an unknown story", "story:nope"],
  ])("refuses %s", (_what, id) => {
    expect(copyOf(doc, view(id))).toEqual({
      kind: "refused",
      reason: NOT_COPYABLE,
    });
    expect(copyOf(doc, view(id, { picked: ["n", id] }))).toEqual({
      kind: "refused",
      reason: NOT_COPYABLE,
    });
  });

  // Why: each kind pastes somewhere else (a station after a station, a
  // story among stories, a note into a station), so one paste cannot
  // take a mix of them; notes and folders together are one kind.
  it.each([
    ["a station and a note", ["station:a", "n"]],
    ["a story and a folder", ["story:t", "folder:f"]],
    ["a station and a story", ["station:b", "story:t"]],
  ])("refuses %s together", (_what, picked) => {
    expect(copyOf(doc, view(null, { picked }))).toEqual({
      kind: "refused",
      reason: COPY_ONE_KIND,
    });
  });
});

describe("what a Paste of copied stations and stories does", () => {
  const doc = opened();
  const copied = (ids: string[]) => ({ mode: "copy" as const, ids });

  // D3: a station copy goes after the selected station in the tour's
  // order (and is placed beside it), whatever in that station is
  // selected.
  it("pastes stations after the station the selection names", () => {
    for (const [selected, after] of [
      ["station:b", "b"],
      ["e", "b"],
      ["story:t", "a"],
      ["folder:g", "a"],
    ] as const) {
      expect(
        pasteOf(doc, view(selected, { clipboard: copied(["station:a"]) })),
      ).toEqual({
        kind: "pasteStations",
        afterStationId: after,
        stations: ["a"],
      });
    }
  });

  // D3: a story copy goes after the selected story (or the story of the
  // selected entry), else at the end of the selected station's stories.
  it("pastes stories after the selected story, else at the end of the station's stories", () => {
    for (const selected of ["story:t", "t-card"]) {
      expect(
        pasteOf(doc, view(selected, { clipboard: copied(["story:t"]) })),
      ).toEqual({
        kind: "pasteStories",
        toStationId: "a",
        afterStory: "t",
        stories: ["t"],
      });
    }
    for (const selected of ["station:b", "e"]) {
      expect(
        pasteOf(doc, view(selected, { clipboard: copied(["story:t"]) })),
      ).toEqual({
        kind: "pasteStories",
        toStationId: "b",
        afterStory: null,
        stories: ["t"],
      });
    }
  });

  it("refuses no target, and a copied station or story gone since", () => {
    for (const ids of [["station:a"], ["story:t"]]) {
      for (const selected of [null, "level-1"]) {
        expect(
          pasteOf(doc, view(selected, { clipboard: copied(ids) })),
        ).toEqual({ kind: "refused", reason: SELECT_A_TARGET });
      }
    }
    for (const ids of [["station:nope"], ["story:nope"]]) {
      expect(
        pasteOf(doc, view("station:b", { clipboard: copied(ids) })),
      ).toEqual({ kind: "refused", reason: COPIED_GONE });
    }
  });
});

describe("what Paste pastes", () => {
  const doc = opened();
  const copied = (ids: string[]) => ({ mode: "copy" as const, ids });

  it("refuses an empty clipboard", () => {
    expect(pasteOf(doc, view("station:b"))).toEqual({
      kind: "refused",
      reason: NOTHING_COPIED,
    });
  });

  // Why: each further paste of the same copy into the same station
  // stands a little further east, so the copies never stack where they
  // cannot be told apart; a paste into another station keeps the copied
  // pose exactly until that station, too, is pasted into again.
  it("shifts a repeated paste into the same station by half a metre per earlier paste there", () => {
    const pastes = { b: 2, a: 1 };
    expect(PASTE_REPEAT_STEP_M).toBe(0.5);
    expect(
      pasteOf(
        doc,
        view("station:b", { clipboard: { ...copied(["n"]), pastes } }),
      ),
    ).toMatchObject({ kind: "paste", toStationId: "b", shiftM: 1 });
    expect(
      pasteOf(
        doc,
        view("e", { clipboard: { ...copied(["n"]), pastes: { a: 3 } } }),
      ),
    ).toMatchObject({ kind: "paste", toStationId: "b", shiftM: 0 });
  });

  it("pastes into the selected station, or the station of the selected row", () => {
    for (const selected of ["station:b", "e"]) {
      expect(
        pasteOf(doc, view(selected, { clipboard: copied(["n"]) })),
      ).toEqual({
        kind: "paste",
        toStationId: "b",
        objects: ["n"],
        folders: [],
        shiftM: 0,
      });
    }
    expect(
      pasteOf(doc, view("folder:g", { clipboard: copied(["e"]) })),
    ).toMatchObject({ kind: "paste", toStationId: "a" });
  });

  // A story and its entries are not where a note or a folder can go, so a
  // paste with one selected is refused rather than landing in the story's
  // station unasked; a code (its selection is its level id, which no
  // station holds) names no station at all.
  it("refuses a selection that names no station to paste into", () => {
    for (const selected of [null, "nope", "story:t", "t-card", "level-1"]) {
      expect(
        pasteOf(doc, view(selected, { clipboard: copied(["n"]) })),
      ).toEqual({ kind: "refused", reason: SELECT_A_TARGET });
    }
  });

  // Why: a note in a resized folder is drawn at that folder's scale, so in
  // another station, out of any folder, it would change size; a folder the
  // folders around it resize past the format's limits cannot carry that
  // scale. The reducer refuses both; the reason is said here.
  it("refuses, into another station, what would not keep its size there", () => {
    const resized = opened({ f: 2 });
    for (const id of ["m", "k"]) {
      expect(
        pasteOf(resized, view("station:b", { clipboard: copied([id]) })),
      ).toEqual({ kind: "refused", reason: NOTE_IN_RESIZED_FOLDER });
      expect(
        pasteOf(resized, view("station:a", { clipboard: copied([id]) })),
      ).toMatchObject({ kind: "paste", toStationId: "a" });
    }
    expect(
      pasteOf(resized, view("station:b", { clipboard: copied(["folder:g"]) })),
    ).toMatchObject({ kind: "paste", toStationId: "b" });
    // Folders that cancel out leave the note its own size.
    const even = opened({ f: 2, g: 0.5 });
    expect(
      pasteOf(even, view("station:b", { clipboard: copied(["k"]) })),
    ).toMatchObject({ kind: "paste" });
    // 10 x 2 = 20 is past the format's 10 (and 0.1 x 0.5 below its 0.1).
    for (const scales of [
      { f: 10, g: 2 },
      { f: 0.1, g: 0.5 },
    ]) {
      expect(
        pasteOf(
          opened(scales),
          view("station:b", { clipboard: copied(["folder:g"]) }),
        ),
      ).toEqual({ kind: "refused", reason: FOLDER_SCALE_TOO_FAR });
    }
    // At exactly a limit, it is pasted.
    expect(
      pasteOf(
        opened({ f: 5, g: 2 }),
        view("station:b", { clipboard: copied(["folder:g"]) }),
      ),
    ).toMatchObject({ kind: "paste" });
  });

  it("refuses what the tour no longer holds", () => {
    const gone = reduce(doc, act.deleted({ id: "n", what: "a note" }));
    expect(
      pasteOf(gone, view("station:b", { clipboard: copied(["n", "e"]) })),
    ).toEqual({ kind: "refused", reason: COPIED_GONE });
  });

  // A folder copy carries its notes and its folders, so a row picked with
  // a folder around it would otherwise land twice.
  it("pastes a row inside a copied folder only with that folder", () => {
    expect(
      pasteOf(
        doc,
        view("station:b", {
          clipboard: copied(["k", "folder:g", "folder:f", "m", "n"]),
        }),
      ),
    ).toEqual({
      kind: "paste",
      toStationId: "b",
      objects: ["n"],
      folders: [{ stationId: "a", folderId: "f" }],
      shiftM: 0,
    });
    expect(
      pasteOf(doc, view("station:b", { clipboard: copied(["k", "folder:g"]) })),
    ).toEqual({
      kind: "paste",
      toStationId: "b",
      objects: [],
      folders: [{ stationId: "a", folderId: "g" }],
      shiftM: 0,
    });
  });
});

// Why: Cut marks, Paste moves - through the move paths the tree's drag
// already takes, so a cut pastes only where those paths go. A folder (and
// what is in one) stays in its station, a cut into the station it is in
// does nothing and says so, and a station cut is a new place in the
// tour's order.
describe("what Cut cuts", () => {
  const doc = opened();

  it.each([
    ["a note", "n"],
    ["a plain folder", "folder:f"],
    ["a note in a folder", "m"],
    ["a story", "story:t"],
    ["a story's entry", "t-card"],
    ["a station", "station:a"],
  ])("cuts %s", (_name, id) => {
    expect(cutOf(doc, view(id))).toEqual({ kind: "cut", ids: [id] });
  });

  it("refuses nothing selected, an unknown id, and stations mixed with what is in them", () => {
    expect(cutOf(doc, view(null))).toEqual({
      kind: "refused",
      reason: NOTHING_TO_CUT,
    });
    expect(cutOf(doc, view("nope"))).toEqual({
      kind: "refused",
      reason: NOTHING_TO_CUT,
    });
    expect(cutOf(doc, view("n", { picked: ["n", "station:b"] }))).toEqual({
      kind: "refused",
      reason: CUT_ONE_KIND,
    });
  });
});

describe("what a Paste of a cut does", () => {
  const doc = opened();
  const cut = (ids: readonly string[], selected: string | null) =>
    pasteOf(doc, view(selected, { clipboard: { mode: "cut", ids } }));
  const onto = (station: string) => ({ place: "station", station }) as const;

  it("moves notes, stories and story entries onto the station the selection names", () => {
    expect(cut(["n", "story:t", "t-card"], "station:b")).toEqual({
      kind: "move",
      toStationId: "b",
      moves: [
        { id: "n", to: onto("b") },
        { id: "t", to: onto("b") },
        { id: "t-card", to: onto("b") },
      ],
    });
    // A note selected in the other station names that station.
    expect(cut(["n"], "e")).toMatchObject({ kind: "move", toStationId: "b" });
  });

  it("does nothing, saying so, for a cut into its own station", () => {
    for (const ids of [["n"], ["story:t"], ["folder:f"], ["m"]]) {
      expect(cut(ids, "station:a")).toEqual({
        kind: "refused",
        reason: CUT_SAME_STATION,
      });
    }
  });

  it("refuses a folder, or what is in one, cut to another station", () => {
    for (const ids of [["folder:f"], ["m"], ["n", "folder:g"]]) {
      expect(cut(ids, "station:b")).toEqual({
        kind: "refused",
        reason: FOLDER_STAYS,
      });
    }
  });

  it("refuses a cut whose source is gone, and one with no target", () => {
    expect(cut(["nope"], "station:b")).toEqual({
      kind: "refused",
      reason: COPIED_GONE,
    });
    expect(cut(["n"], null)).toEqual({
      kind: "refused",
      reason: SELECT_A_TARGET,
    });
  });

  it("puts cut stations after the station the selection names", () => {
    expect(cut(["station:a"], "station:b")).toEqual({
      kind: "reorder",
      afterStationId: "b",
      order: ["b", "a"],
    });
    expect(cut(["station:a"], "e")).toMatchObject({ order: ["b", "a"] });
    expect(cut(["station:a"], "station:a")).toEqual({
      kind: "refused",
      reason: CUT_STATION_TARGET,
    });
    expect(cut(["station:b"], "station:a")).toEqual({
      kind: "refused",
      reason: CUT_STATIONS_IN_PLACE,
    });
  });

  // Why: a pending cut whose source is gone (deleted, or undone away)
  // must clear itself, or the tree would dim nothing and Paste refuse.
  it("knows a cut whose source is gone, never a copy", () => {
    const with_ = (mode: "copy" | "cut", ids: readonly string[]) =>
      view(null, { clipboard: { mode, ids } });
    expect(cutGone(doc, with_("cut", ["n", "nope"]))).toBe(true);
    expect(cutGone(doc, with_("cut", ["n", "station:b", "t-card"]))).toBe(
      false,
    );
    expect(cutGone(doc, with_("copy", ["nope"]))).toBe(false);
    expect(cutGone(doc, view(null))).toBe(false);
  });
});
