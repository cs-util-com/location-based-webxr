/**
 * Why these tests matter: a creator answers these questions before a
 * delete, and a yes given to a question that left something out deletes
 * more than was agreed to. The story's question once said "It has no
 * entries." while its automatic station went with it; the station's lists
 * its stories by name and joins them in plain words.
 */
import type {
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { beforeAll, describe, expect, it } from "vitest";

import { stationContent, storyOf } from "../test-support/station-content.js";
import { tourOf } from "../test-support/tour-of.js";
import { tourDocumentActions, tourDocumentReducer } from "../tour-document.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import {
  stationDeleteQuestion,
  storyDeleteQuestion,
} from "./delete-questions.js";

beforeAll(() => {
  createTourViewerStore();
});

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;
const line = (id: string) =>
  ({ id, kind: "shortText", view: "card", caption: id, pose: POSE }) as const;

function station(
  id: string,
  content: Parameters<typeof stationContent>[0],
  title?: string,
): TourStation {
  return {
    id,
    ...(title === undefined ? {} : { title }),
    geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    ...stationContent(content),
  };
}

function stateOf(stations: readonly TourStation[]) {
  const base: TourManifest = tourOf([]);
  return tourDocumentReducer(
    undefined,
    tourDocumentActions.opened({
      manifest: { ...base, stations: [...stations] },
    }),
  );
}

describe("stationDeleteQuestion", () => {
  it("names each story and counts the free items, joined by commas and a last and", () => {
    const s = station("gate", [
      storyOf("a", [line("l1")], "Legend"),
      storyOf("b", [], "Siege"),
      { ...line("f1"), view: "pin" },
      { ...line("f2"), view: "pin" },
    ]);
    expect(stationDeleteQuestion(s, "Gate")).toBe(
      'Delete the station "Gate"? Its 4 items go with it: the story "Legend", the story "Siege" and 2 free items. You can undo this.',
    );
  });

  it("says one item, two parts with a bare and, and no content", () => {
    expect(
      stationDeleteQuestion(station("g", [storyOf("a", [], "Legend")]), "G"),
    ).toBe(
      'Delete the station "G"? Its item goes with it: the story "Legend". You can undo this.',
    );
    expect(
      stationDeleteQuestion(
        station("g", [
          storyOf("a", [], "Legend"),
          { ...line("f"), view: "pin" },
        ]),
        "G",
      ),
    ).toBe(
      'Delete the station "G"? Its 2 items go with it: the story "Legend" and 1 free item. You can undo this.',
    );
    expect(stationDeleteQuestion(station("g", []), "G")).toBe(
      'Delete the station "G"? It has no content. You can undo this.',
    );
  });
});

describe("storyDeleteQuestion", () => {
  it("counts the entries of a story whose station stays", () => {
    const state = stateOf([
      station(
        "gate",
        [storyOf("a", [line("l1"), line("l2")], "Legend")],
        "Gate",
      ),
    ]);
    expect(storyDeleteQuestion(state, "a")).toBe(
      'Delete the story "Legend"? Its 2 entries go with it. You can undo this.',
    );
  });

  it("names the automatic station a delete takes along, also for a story with no entries", () => {
    const state = stateOf([
      station("gate", [{ ...line("f"), view: "pin" }], "Gate"),
      station("lone", [storyOf("aside", [], "Aside")]),
    ]);
    expect(storyDeleteQuestion(state, "aside")).toBe(
      'Delete the story "Aside"? Its station "Station 2", which holds nothing else, goes with it. You can undo this.',
    );
    const told = stateOf([
      station("gate", [{ ...line("f"), view: "pin" }], "Gate"),
      station("lone", [storyOf("aside", [line("l1")], "Aside")]),
    ]);
    expect(storyDeleteQuestion(told, "aside")).toBe(
      'Delete the story "Aside"? Its entry and its station "Station 2", which holds nothing else, go with it. You can undo this.',
    );
  });

  it("says a story with no entries has none, and is null for one not in the tour", () => {
    const state = stateOf([
      station("gate", [storyOf("a", [], "Legend")], "Gate"),
    ]);
    expect(storyDeleteQuestion(state, "a")).toBe(
      'Delete the story "Legend"? It has no entries. You can undo this.',
    );
    expect(storyDeleteQuestion(state, "gone")).toBeNull();
  });
});
