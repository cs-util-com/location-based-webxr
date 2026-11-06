/**
 * Why these tests matter: a station with one story passes every place that
 * only ever looks at the first one. The picker lets a visitor choose among
 * several, so an edit, a save, a copy or a new id that forgets the others
 * would lose a creator's work without a word. Each test here works on the
 * second story and looks at both.
 */
import { parseTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { stationContent, storyOf } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import { withTourContent } from "./tour-content.js";
import {
  initialTourDocumentState,
  manifestNow,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

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

function frame(state: TourDocumentState, id = "well") {
  const found = state.stations.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no station ${id}`);
  return found;
}

/** Each story of `station` as [its id, its first child's caption]. */
function told(station: Parameters<typeof tourStories>[0]) {
  return tourStories(station).map((story) => [
    story.id,
    (story.children[0] as { caption?: string } | undefined)?.caption,
  ]);
}

function written(state: TourDocumentState): TourManifest {
  const manifest = manifestToWrite(state);
  if (manifest === null) throw new Error("nothing open");
  return parseTourManifest(JSON.parse(serializeTourManifest(manifest)));
}

describe("a station of two stories in the editor", () => {
  it("edits a block of the second story and keeps the first", () => {
    const after = reduce(
      open(),
      act.stationEdited({
        stationId: "well",
        edit: {
          storyText: { block: "b1", field: "caption", value: "The new baker" },
        },
        what: "the text of a story block",
      }),
    );
    const expected = [
      ["miller", "The miller"],
      ["baker", "The new baker"],
    ];
    expect(told(frame(after))).toEqual(expected);
    expect(told(written(after).stations[0]!)).toEqual(expected);
  });

  // Why: a frame has only stories today, but replacing one block must not
  // depend on that: the edit says nothing about the station's other
  // children.
  it("replaces one story block and passes every other child through", () => {
    const state = open();
    const before = frame(state);
    const after = reduce(
      {
        ...state,
        stations: [
          { ...before, children: [...before.children, { ...FREE_PIN }] },
        ],
      },
      act.stationEdited({
        stationId: "well",
        edit: { storyText: { block: "m1", field: "caption", value: "Hi" } },
        what: "the text of a story block",
      }),
    );
    expect(frame(after).children.map((c) => c.id)).toEqual([
      "miller",
      "baker",
      "well-sign",
    ]);
  });

  // Why: a tour's children read in file order, so the order a write puts
  // them in is the format's, and the visitor's picker lists the stories in
  // it.
  it("saves both stories in order, before the free blocks", () => {
    const state = open();
    const edited = reduce(
      state,
      act.stationEdited({
        stationId: "well",
        edit: { title: "The old well" },
        what: "the title",
      }),
    );
    for (const manifest of [manifestNow(edited), written(edited)]) {
      expect(manifest?.stations[0]?.children.map((c) => c.id)).toEqual([
        "miller",
        "baker",
        "well-sign",
      ]);
    }
  });

  it("keeps both stories when the content is written over", () => {
    const next = withTourContent(OPENED, { objects: [] });
    expect(told(next.stations[0]!)).toEqual([
      ["miller", "The miller"],
      ["baker", "The baker"],
    ]);
  });

  it("copies a station with both stories under new ids", () => {
    const after = reduce(
      open(),
      act.stationDuplicated({
        stationId: "well",
        newStationId: "well2",
        newItemIds: {
          miller: "miller2",
          m1: "m2",
          baker: "baker2",
          b1: "b2",
          "well-sign": "well-sign2",
        },
        createdAtIso: "2026-11-06T00:00:00.000Z",
        what: "duplicate",
      }),
    );
    expect(told(frame(after, "well2"))).toEqual([
      ["miller2", "The miller"],
      ["baker2", "The baker"],
    ]);
    expect(told(written(after).stations[1]!)).toEqual([
      ["miller2", "The miller"],
      ["baker2", "The baker"],
    ]);
  });

  // Why: ids are one namespace across the tour, so a new item under the id
  // of a story or of a block in one is a tour the format refuses on the
  // next save.
  it.each(["miller", "m1", "baker", "b1"])(
    "refuses a new item under the taken id %s",
    (newId) => {
      const state = open();
      const after = reduce(
        state,
        act.objectDuplicated({
          id: "well-sign",
          newId,
          createdAtIso: "2026-11-06T00:00:00.000Z",
          what: "duplicate",
        }),
      );
      expect(after).toBe(state);
    },
  );
});
