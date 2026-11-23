/**
 * Why these tests matter: the editor shell asks Copy, Cut and Paste
 * (`copyOf`, `cutOf`, `pasteOf`) about the same document several times in
 * one draw, and a drag in the tree redraws on every hover. Each answer
 * reads the clipboard's lookup (every item and every folder chain of the
 * tour), so it must be built once per document state, not once per
 * question; a new state (any edit) builds it anew, since a state never
 * changes.
 */
import {
  parseTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it, vi } from "vitest";

import { stationContent } from "../test-support/station-content.js";
import { tourOf } from "../test-support/tour-of.js";
import {
  documentObjects,
  initialTourDocumentState,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
} from "../tour-document.js";
import { copyOf, cutOf, pasteOf } from "./clipboard.js";
import { initialEditorViewState } from "./editor-view.js";

vi.mock("../tour-document.js", async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    documentObjects: vi.fn(actual["documentObjects"] as typeof documentObjects),
  };
});

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

describe("the clipboard's lookup", () => {
  it("is built once per document state, whatever the number of questions", () => {
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
        ...stationContent([pin(id === "a" ? "n" : "e")]),
      })),
    });
    const doc = reduce(
      initialTourDocumentState,
      act.opened({
        manifest: parseTourManifest(JSON.parse(serializeTourManifest(wire))),
      }),
    );
    const builds = vi.mocked(documentObjects);
    builds.mockClear();
    const ui = {
      ...initialEditorViewState,
      selected: "n",
      clipboard: { mode: "copy" as const, ids: ["n"] },
    };
    // One shell draw's questions, twice over.
    for (let i = 0; i < 2; i += 1) {
      copyOf(doc, ui);
      cutOf(doc, ui);
      pasteOf(doc, ui);
      pasteOf(doc, ui);
    }
    expect(builds).toHaveBeenCalledTimes(1);

    const edited = reduce(doc, act.deleted({ id: "e", what: "a note" }));
    expect(edited).not.toBe(doc);
    copyOf(edited, ui);
    pasteOf(edited, ui);
    expect(builds).toHaveBeenCalledTimes(2);
  });
});
