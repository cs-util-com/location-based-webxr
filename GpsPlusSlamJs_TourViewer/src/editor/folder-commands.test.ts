/**
 * Why these tests matter: the tree's Group, Ungroup and drag into or out
 * of a folder reach the tour only through these commands. Each must be
 * ONE undo step, say what it did in words a creator reads (the toast is
 * the outcome's sign when the station is folded), and on a refusal say
 * why and change nothing - never a silent no-op, never a half edit.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { UnknownAction } from "@reduxjs/toolkit";
import { describe, expect, it } from "vitest";

import { stationContent } from "../test-support/station-content.js";
import { tourOf } from "../test-support/tour-of.js";
import {
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "../tour-document.js";
import { folderRefusalLine } from "../tour-folder-edit.js";
import {
  createFolderCommands,
  FOLDER_NAME_TOO_LONG,
  groupRows,
  NOTHING_TO_GROUP,
  ONE_ITEM_LINE,
  selectionBarOf,
  nextFolderTitle,
  pickedGroupRefusal,
  plainFolderOf,
} from "./folder-commands.js";

const AT = { lat: 48.52, lon: 9.05, alt: 400 };

function pin(id: string, position: [number, number, number]) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: `Pin ${id}`,
    createdAtIso: "2026-11-09T00:00:00.000Z",
    pose: { position, rotation: [0, 0, 0, 1] },
  } as const;
}

/** Station "well": free pins p, q, r and folder "yard" ("Folder 1")
 *  holding pin a; station "gate": pin g. */
function tour(): TourManifest {
  const wire = tourOf([], {
    stations: [
      {
        id: "well",
        title: "The well",
        geo: { ...AT, rotation: [0, 0, 0, 1] },
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        ...stationContent([
          pin("p", [1, 0, 2]),
          pin("q", [3, 0, -2]),
          pin("r", [-4, 1, 0]),
          {
            id: "yard",
            kind: "folder",
            title: "Folder 1",
            pose: { position: [5, 0, 5], rotation: [0, 0, 0, 1] },
            children: [pin("a", [1, 0, 0])],
          },
        ]),
      },
      {
        id: "gate",
        title: "The gate",
        geo: { ...AT, lat: AT.lat + 0.001, rotation: [0, 0, 0, 1] },
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        ...stationContent([pin("g", [0, 0, 1])]),
      },
    ],
  });
  return parseTourManifest(JSON.parse(serializeTourManifest(wire)));
}

function setup(manifest: TourManifest = tour()) {
  let state: TourDocumentState = reduce(
    initialTourDocumentState,
    act.opened({ manifest }),
  );
  const said: string[] = [];
  let changed = 0;
  let before = 0;
  const commands = createFolderCommands({
    getState: () => state,
    dispatch: (action: UnknownAction) => {
      state = reduce(state, action);
    },
    before: () => {
      before += 1;
    },
    changed: () => {
      changed += 1;
    },
    say: (text) => {
      said.push(text);
    },
    mint: () => "made",
  });
  return {
    commands,
    said,
    state: () => state,
    changed: () => changed,
    before: () => before,
  };
}

function folderOfItem(state: TourDocumentState, id: string) {
  return documentObjects(state).find((o) => o.object.id === id)?.object.folder;
}

describe("createFolderCommands - group", () => {
  it("groups two items in a new folder as one step, named and said", () => {
    const t = setup();
    const past = t.state().past.length;
    expect(t.commands.group(["p", "q"])).toBe("made");
    expect(t.state().past.length).toBe(past + 1);
    expect(folderOfItem(t.state(), "p")).toEqual(["made"]);
    expect(folderOfItem(t.state(), "q")).toEqual(["made"]);
    expect(folderOfItem(t.state(), "r")).toBeUndefined();
    const place = plainFolderOf(t.state(), "made");
    expect(place?.stationId).toBe("well");
    // "Folder 1" is taken by the station's folder already.
    expect(place?.folder.title).toBe("Folder 2");
    expect(place?.itemIds).toEqual(["p", "q"]);
    expect(t.said).toEqual(["Grouped 2 items into a folder - type its name"]);
    expect(t.changed()).toBe(1);
  });

  it("refuses, says why and changes nothing", () => {
    const cases: [string[], Parameters<typeof folderRefusalLine>[0]][] = [
      [["a", "p"], "oneLevel"],
      [["folder:yard", "p"], "oneLevel"],
      [["p", "g"], "notHere"],
      [["nope"], "notHere"],
    ];
    for (const [picked, reason] of cases) {
      const t = setup();
      const before = t.state();
      expect(t.commands.group(picked)).toBeNull();
      expect(t.state()).toBe(before);
      expect(t.said).toEqual([folderRefusalLine(reason)]);
      expect(t.changed()).toBe(0);
      expect(pickedGroupRefusal(before, picked)).toBe(reason);
    }
  });

  // Why: Ctrl+G with nothing picked is no refusal of a folder rule, so
  // "a folder holds items of one station" would send the creator looking
  // for a wrong reason; it says what to do instead.
  it("says to pick items first when nothing is picked, and changes nothing", () => {
    const t = setup();
    const before = t.state();
    expect(t.commands.group([])).toBeNull();
    expect(t.state()).toBe(before);
    expect(t.said).toEqual([NOTHING_TO_GROUP]);
    expect(t.before()).toBe(0);
  });

  it("takes the next free number for a new folder's name", () => {
    const t = setup();
    expect(nextFolderTitle(t.state(), "well")).toBe("Folder 2");
    expect(nextFolderTitle(t.state(), "gate")).toBe("Folder 1");
  });
});

describe("createFolderCommands - ungroup, move, rename", () => {
  it("ungroups a folder, its items staying, said with the count", () => {
    const t = setup();
    expect(t.commands.ungroup("yard")).toEqual(["a"]);
    expect(plainFolderOf(t.state(), "yard")).toBeNull();
    expect(folderOfItem(t.state(), "a")).toBeUndefined();
    expect(t.said).toEqual(["Ungrouped - 1 item stays where it is"]);
    t.commands.group(["p", "q"]);
    t.said.length = 0;
    expect(t.commands.ungroup("made")).toEqual(["p", "q"]);
    expect(t.said).toEqual(["Ungrouped - 2 items stay where they are"]);
  });

  // Why: a folder gone from the tour (an undo since the pick) is no
  // matter of stations; the line names what happened.
  it("refuses to ungroup a folder the tour lacks, saying it is gone", () => {
    const t = setup();
    expect(t.commands.ungroup("nope")).toBeNull();
    expect(t.said).toEqual([folderRefusalLine("gone")]);
  });

  it("moves an item into a folder and out again, each said", () => {
    const t = setup();
    expect(t.commands.moveInto("p", "yard")).toBe(true);
    expect(folderOfItem(t.state(), "p")).toEqual(["yard"]);
    expect(t.commands.moveInto("p", null)).toBe(true);
    expect(folderOfItem(t.state(), "p")).toBeUndefined();
    expect(t.said).toEqual([
      '"Pin p" now in "Folder 1" - kept its place in the scene',
      '"Pin p" left the folder - kept its place in the scene',
    ]);
    expect(t.changed()).toBe(2);
  });

  it("refuses an item into another station's folder", () => {
    const t = setup();
    const before = t.state();
    expect(t.commands.moveInto("g", "yard")).toBe(false);
    expect(t.state()).toBe(before);
    expect(t.said).toEqual([folderRefusalLine("notHere")]);
  });

  // Why: the store refuses a pose past the format's 10 km bound in a
  // folder; the page must say that reason, not a generic "one station".
  it("refuses an item that would stand past the 10 km bound in the folder, saying so", () => {
    const wire = tourOf([], {
      stations: [
        {
          id: "wide",
          title: "The wide field",
          geo: { ...AT, rotation: [0, 0, 0, 1] },
          activateRadiusM: 50,
          foundRadiusM: 25,
          hint: "arrow",
          ...stationContent([
            pin("w", [-6000, 0, 0]),
            {
              id: "east",
              kind: "folder",
              title: "East",
              pose: { position: [6000, 0, 0], rotation: [0, 0, 0, 1] },
              children: [pin("e", [1, 0, 0])],
            },
          ]),
        },
      ],
    });
    const t = setup(parseTourManifest(JSON.parse(serializeTourManifest(wire))));
    const before = t.state();
    expect(t.commands.moveInto("w", "east")).toBe(false);
    expect(t.state()).toBe(before);
    expect(t.said).toEqual([folderRefusalLine("tooFar")]);
  });

  // Why: dropping an item into the folder it is in already changes
  // nothing; a "Not possible here" for it would call a no-op a failure.
  it("says nothing when an item is moved into the folder it is in", () => {
    const t = setup();
    expect(t.commands.moveInto("a", "yard")).toBe(false);
    expect(t.said).toEqual([]);
    expect(t.changed()).toBe(0);
  });

  it("says nothing when an item outside any folder is moved out", () => {
    const t = setup();
    expect(t.commands.moveInto("p", null)).toBe(false);
    expect(t.said).toEqual([]);
    expect(t.changed()).toBe(0);
  });

  it("renames a folder; a blank or unchanged name changes nothing, quietly", () => {
    const t = setup();
    expect(t.commands.rename("yard", "  ")).toBe(false);
    expect(t.before()).toBe(0);
    // The name field left as it was: no undo step that changes nothing.
    const past = t.state().past.length;
    expect(t.commands.rename("yard", " Folder 1 ")).toBe(false);
    expect(t.state().past.length).toBe(past);
    expect(t.commands.rename("yard", " Benches ")).toBe(true);
    expect(plainFolderOf(t.state(), "yard")?.folder.title).toBe("Benches");
    expect(t.commands.rename("yard", "x".repeat(500))).toBe(false);
    // The cap is said, so the creator knows how far to shorten it.
    expect(t.said).toEqual([FOLDER_NAME_TOO_LONG]);
    expect(FOLDER_NAME_TOO_LONG).toContain("80 characters");
  });

  // Why: a folder row dragged among the station's folders reaches the
  // tour only here; a drop on its own place is no undo step, and a folder
  // gone since the drag began says so.
  it("puts a folder at a place among its station's folders, as one step", () => {
    const t = setup();
    t.commands.group(["p", "q"]);
    const folders = () =>
      manifestToWrite(t.state())
        ?.stations[0]?.children.filter((c) => c.kind === "folder")
        .map((c) => c.id);
    expect(folders()).toEqual(["yard", "made"]);
    const past = t.state().past.length;
    t.said.length = 0;
    expect(t.commands.reorder("made", 0)).toBe(true);
    expect(folders()).toEqual(["made", "yard"]);
    expect(t.state().past.length).toBe(past + 1);
    expect(t.commands.reorder("made", 0)).toBe(false);
    expect(t.state().past.length).toBe(past + 1);
    expect(t.said).toEqual([]);
    expect(t.commands.reorder("nope", 0)).toBe(false);
    expect(t.said).toEqual([folderRefusalLine("gone")]);
  });
});

describe("the selection bar", () => {
  // Why this matters: the bar is the phone's only way to Group and
  // Ungroup, and the desktop's visible one; it must show exactly when it
  // can act and say why Group is off, as the chosen prototype does.
  it("acts only on the tour's free items and plain folders", () => {
    const t = setup();
    expect(
      groupRows(t.state(), {
        selected: "q",
        picked: ["p", "folder:yard", "station:well", "story:x", "nope", "q"],
      }),
    ).toEqual(["p", "folder:yard", "q"]);
    expect(groupRows(t.state(), { selected: "p", picked: [] })).toEqual(["p"]);
    expect(groupRows(t.state(), { selected: null, picked: [] })).toEqual([]);
  });

  it("shows for two rows, a folder or the Select mode, and says why", () => {
    const bar = (rows: string[], selectMode = false) => {
      const t = setup();
      return selectionBarOf({
        rows,
        selectMode,
        refusal: pickedGroupRefusal(t.state(), rows),
      });
    };
    expect(bar(["p"])).toMatchObject({
      show: false,
      group: true,
      why: ONE_ITEM_LINE,
    });
    expect(bar(["p", "q"])).toMatchObject({
      show: true,
      count: 2,
      group: true,
      ungroup: false,
      done: false,
      why: null,
    });
    expect(bar(["folder:yard"])).toMatchObject({
      show: true,
      group: false,
      ungroup: true,
      why: null,
    });
    expect(bar(["p", "g"])).toMatchObject({
      show: true,
      group: false,
      why: folderRefusalLine("notHere"),
    });
    expect(bar([], true)).toMatchObject({
      show: true,
      count: 0,
      group: false,
      done: true,
      why: null,
    });
  });
});
