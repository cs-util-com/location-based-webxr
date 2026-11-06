/**
 * Why these tests matter: a narration's read-along is an archive entry
 * (`timing/<blockId>.json`), not an asset, so `historyAssetIds` never
 * named it. A write now removes a timing no narration names; without the
 * undo history's timings kept too, deleting a narrated text, saving and
 * undoing brought the text back with its timing file gone.
 */
import {
  serializeTourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it } from "vitest";

import { tourOf } from "./test-support/tour-of.js";
import {
  historyTimingEntries,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
} from "./tour-document.js";
import { stationContent, storyOf } from "./test-support/station-content.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ESSAY: TourObject = {
  id: "essay",
  kind: "longText",
  view: "reading",
  title: "The mill",
  body: "It turned.",
  narration: { audio: "voice", timing: "timing/essay.json", synthetic: true },
  createdAtIso: "2026-10-31T00:00:01.000Z",
  geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
};

describe("historyTimingEntries: the read-along entries the undo history names", () => {
  it("names a deleted narrated text's timing, which the written tour no longer names", () => {
    let state = reduce(
      initialTourDocumentState,
      act.opened({
        manifest: tourOf([ESSAY], {
          assets: [{ id: "voice", path: "content/voice.mp3", kind: "audio" }],
        }),
      }),
    );
    expect(historyTimingEntries(state)).toEqual(new Set());
    state = reduce(state, act.deleted({ id: "essay", what: "the delete" }));
    expect(historyTimingEntries(state)).toEqual(new Set(["timing/essay.json"]));
    const written = manifestToWrite(state);
    expect(
      written?.stations.flatMap((s) => s.blocks).map((b) => b.id),
    ).not.toContain("essay");
    // The redo side counts too: undone, the deleting step is a future one
    // whose view has no essay, and the current view names it itself.
    state = reduce(state, act.undone());
    expect(historyTimingEntries(state)).toEqual(new Set());
  });
});

describe("a copied narrated text", () => {
  // Why: a timing entry is named by its block's own id
  // (`timing/<blockId>.json`), and the format refuses a narration naming
  // another block's. A copy that kept the original's name made every
  // later save of the tour throw in the serializer, with no way out in
  // the app but deleting the copy.
  const opened = () =>
    reduce(
      initialTourDocumentState,
      act.opened({
        manifest: tourOf([ESSAY], {
          assets: [{ id: "voice", path: "content/voice.mp3", kind: "audio" }],
        }),
      }),
    );

  it("keeps the voice and leaves the read-along out when the item is duplicated", () => {
    const state = reduce(
      opened(),
      act.objectDuplicated({
        id: "essay",
        newId: "essay2",
        createdAtIso: "2026-10-31T00:00:02.000Z",
        what: "the copy",
      }),
    );
    const written = manifestToWrite(state);
    if (written === null) throw new Error("nothing open");
    const copy = tourObjects(written).find((o) => o.id === "essay2");
    expect(copy).toMatchObject({
      kind: "longText",
      narration: { audio: "voice", synthetic: true },
    });
    expect(copy?.kind === "longText" && copy.narration?.timing).toBe(undefined);
    expect(() => serializeTourManifest(written)).not.toThrow();
  });

  it("does the same for a story text of a duplicated station", () => {
    const manifest = tourOf([], {
      assets: [{ id: "voice", path: "content/voice.mp3", kind: "audio" }],
      stations: [
        {
          id: "story",
          title: "The story",
          geo: ESSAY.geo,
          activateRadiusM: 50,
          foundRadiusM: 25,
          hint: "arrow",
          ...stationContent([
            storyOf("story-story", [
              {
                id: "told",
                kind: "longText",
                view: "reading",
                title: "Told",
                body: "Once.",
                narration: {
                  audio: "voice",
                  timing: "timing/told.json",
                  synthetic: false,
                },
                pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
                advance: { mode: "tap" },
              },
            ]),
          ]),
        },
      ],
    });
    let state = reduce(initialTourDocumentState, act.opened({ manifest }));
    state = reduce(
      state,
      act.stationDuplicated({
        stationId: "story",
        newStationId: "story2",
        newItemIds: { told: "told2" },
        createdAtIso: "2026-10-31T00:00:02.000Z",
        what: "the copy",
      }),
    );
    const written = manifestToWrite(state);
    if (written === null) throw new Error("nothing open");
    const told = written.stations
      .flatMap((s) => s.blocks)
      .filter((b) => b.kind === "longText")
      .map((b) => [b.id, b.narration?.timing]);
    expect(told).toEqual([
      ["told", "timing/told.json"],
      ["told2", undefined],
    ]);
    expect(() => serializeTourManifest(written)).not.toThrow();
  });
});
