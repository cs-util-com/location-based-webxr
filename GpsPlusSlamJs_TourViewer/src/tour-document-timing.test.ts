/**
 * Why these tests matter: a narration's read-along is an archive entry
 * (`timing/<blockId>.json`), not an asset, so `historyAssetIds` never
 * named it. A write now removes a timing no narration names; without the
 * undo history's timings kept too, deleting a narrated text, saving and
 * undoing brought the text back with its timing file gone.
 */
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
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
