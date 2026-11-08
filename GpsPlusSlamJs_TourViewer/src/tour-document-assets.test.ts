/**
 * Why these tests matter: a file brought into the tour (a voice, a
 * model, a picture) is an asset the document lists beside the written
 * tour's (`addedAssets`) until a save writes it. A draft keeps those
 * files, so a restore brings them back with the records naming them -
 * and a record naming a file nothing holds is left out, since the format
 * refuses it and every later save would fail.
 */
import type {
  TourAsset,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it } from "vitest";

import { tourOf } from "./test-support/tour-of.js";
import {
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const STATUE: TourAsset = {
  id: "a".repeat(64),
  path: `content/${"a".repeat(64)}.glb`,
  kind: "model",
};

function pin(id: string): TourObject {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    createdAtIso: "2026-11-07T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

const MODEL: TourObject = {
  id: "m",
  kind: "model",
  view: "placed",
  asset: STATUE.id,
  sizeM: 2,
  createdAtIso: "2026-11-07T00:00:01.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
};

function opened(): TourDocumentState {
  return reduce(
    initialTourDocumentState,
    act.opened({ manifest: tourOf([pin("a")]) }),
  );
}

describe("restored: the files a draft kept", () => {
  // Why: a model brought in and placed, then the page reloaded - the
  // draft offers the record and its file; both must come back, and the
  // next write must list the asset.
  it("puts back a record with the file it names", () => {
    const state = reduce(
      opened(),
      act.restored({
        objects: [MODEL],
        deleted: [],
        assets: [STATUE],
        what: "the restored changes",
      }),
    );
    expect(state.addedAssets).toEqual([STATUE]);
    expect(documentObjects(state).map((o) => o.object.id)).toContain("m");
    expect(manifestToWrite(state)?.assets).toContainEqual(STATUE);
  });

  // Why (follow-up: a draft model naming a missing asset): a record whose
  // file is held nowhere would make every save fail with the parser's
  // words; it is left out instead.
  it("leaves out a record naming a file nothing holds", () => {
    const before = opened();
    const state = reduce(
      before,
      act.restored({
        objects: [MODEL],
        deleted: [],
        what: "the restored changes",
      }),
    );
    expect(documentObjects(state).map((o) => o.object.id)).not.toContain("m");
  });
});
