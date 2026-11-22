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
  copyOf,
  NOTHING_COPIED,
  NOTHING_SELECTED,
  ONLY_NOTES_AND_FOLDERS,
  pasteOf,
  SELECT_A_TARGET,
} from "./clipboard.js";
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
 *  story t; station b: note e. */
function opened() {
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
                children: [
                  pin("m"),
                  {
                    id: "g",
                    kind: "folder",
                    title: "G",
                    pose: { position: [1, 0, 0], rotation: [0, 0, 0, 1] },
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

  // A station, a story, a story's entry and an unknown id are not copied
  // yet; one of them among picked rows refuses the lot,
  // rather than copying part of what the creator meant.
  it.each([
    ["a station", "station:a"],
    ["a story", "story:t"],
    ["a story's entry", "t-card"],
    ["an unknown id", "nope"],
    ["an unknown folder", "folder:nope"],
  ])("refuses %s", (_what, id) => {
    expect(copyOf(doc, view(id))).toEqual({
      kind: "refused",
      reason: ONLY_NOTES_AND_FOLDERS,
    });
    expect(copyOf(doc, view(id, { picked: ["n", id] }))).toEqual({
      kind: "refused",
      reason: ONLY_NOTES_AND_FOLDERS,
    });
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

  it("pastes into the selected station, or the station of the selected row", () => {
    for (const selected of ["station:b", "e"]) {
      expect(
        pasteOf(doc, view(selected, { clipboard: copied(["n"]) })),
      ).toEqual({
        kind: "paste",
        toStationId: "b",
        objects: ["n"],
        folders: [],
      });
    }
    expect(
      pasteOf(doc, view("folder:g", { clipboard: copied(["e"]) })),
    ).toMatchObject({ kind: "paste", toStationId: "a" });
  });

  it("refuses a selection that names no station", () => {
    for (const selected of [null, "nope"]) {
      expect(
        pasteOf(doc, view(selected, { clipboard: copied(["n"]) })),
      ).toEqual({ kind: "refused", reason: SELECT_A_TARGET });
    }
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
    });
    expect(
      pasteOf(doc, view("station:b", { clipboard: copied(["k", "folder:g"]) })),
    ).toEqual({
      kind: "paste",
      toStationId: "b",
      objects: [],
      folders: [{ stationId: "a", folderId: "g" }],
    });
  });
});
