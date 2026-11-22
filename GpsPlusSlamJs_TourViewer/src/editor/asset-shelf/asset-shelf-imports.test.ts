/**
 * Why these tests matter: a model being converted is a row on the shelf
 * before it is a file of the tour. Its row must say what the conversion
 * is doing (waiting, converting, failed with words) from the store alone,
 * stand in arrival order among the shelf's files, and never become a file
 * by itself: only the runner's delivery adds the model, through the
 * shelf's own entry, so a removed or failed import can never leave a file
 * behind. What the conversion left out stays with the made model's entry.
 */
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { tourOf } from "../../test-support/tour-of.js";
import {
  initialTourDocumentState,
  tourDocumentActions as doc,
  tourDocumentReducer,
} from "../../tour-document.js";
import {
  assetShelfActions as act,
  assetShelfReducer,
  initialAssetShelfState,
  selectShelfRows,
  type AssetShelfState,
} from "./asset-shelf-slice.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const A = "a".repeat(64);

function shelf(...actions: Parameters<typeof assetShelfReducer>[1][]) {
  return actions.reduce(assetShelfReducer, initialAssetShelfState);
}

const document = tourDocumentReducer(
  initialTourDocumentState,
  doc.opened({ manifest: tourOf([]) }),
);

const rows = (s: AssetShelfState) =>
  selectShelfRows({ assetShelf: s, tourDocument: document });

const queued = (id: string, name = "bust.gltf") =>
  act.importQueued({ id, name, format: "gltf", bytes: 2048 });

const file = (id: string) =>
  act.entryAdded({
    id,
    kind: "model",
    name: "rock.glb",
    origin: "added",
    originalBytes: 1000,
    queued: true,
  });

describe("an import on the shelf", () => {
  it("shows as a model row: waiting, converting, failed with words", () => {
    const waiting = shelf(queued("import:1"));
    expect(rows(waiting)).toEqual([
      {
        id: "import:1",
        kind: "model",
        name: "bust.gltf",
        origin: "added",
        status: "queued",
        progress: 0,
        retryable: false,
        originalBytes: 2048,
        estimatedBytes: 2048,
        queuePosition: 0,
        placesInUse: 0,
        swaps: 0,
        canUseOriginal: false,
        import: { format: "gltf" },
      },
    ]);
    const converting = assetShelfReducer(
      assetShelfReducer(waiting, act.importStarted({ id: "import:1" })),
      act.importProgress({ id: "import:1", fraction: 0.4 }),
    );
    expect(rows(converting)[0]).toMatchObject({
      status: "running",
      progress: 0.4,
      queuePosition: null,
    });
    const failed = assetShelfReducer(
      converting,
      act.importFailed({ id: "import:1", reason: "no .bin", retryable: true }),
    );
    expect(rows(failed)[0]).toMatchObject({
      status: "failed",
      reason: "no .bin",
      retryable: true,
    });
    const again = assetShelfReducer(
      failed,
      act.importRetried({ id: "import:1" }),
    );
    expect(rows(again)[0]).toMatchObject({ status: "queued", progress: 0 });
    expect(rows(again)[0]).not.toHaveProperty("reason");
  });

  it("stands in arrival order among the files, and is gone once removed", () => {
    const s = shelf(file(A), queued("import:1"), file("b".repeat(64)));
    expect(rows(s).map((r) => r.id)).toEqual([A, "import:1", "b".repeat(64)]);
    const removed = assetShelfReducer(s, act.importRemoved({ id: "import:1" }));
    expect(rows(removed).map((r) => r.id)).toEqual([A, "b".repeat(64)]);
    expect(removed.entries).toEqual(s.entries);
  });

  it("keeps what a conversion left out with the made model's entry", () => {
    const s = shelf(
      file(A),
      act.madeFromSet({ id: A, from: "bust.gltf", notes: ["Made without x."] }),
    );
    expect(rows(s)[0]!.madeFrom).toEqual({
      from: "bust.gltf",
      notes: ["Made without x."],
    });
    expect(
      assetShelfReducer(
        s,
        act.madeFromSet({ id: "none", from: "x", notes: [] }),
      ),
    ).toBe(s);
  });

  it("ignores a message for an import it does not hold, and a second queue of an id", () => {
    const s = shelf(queued("import:1"));
    for (const action of [
      act.importStarted({ id: "nope" }),
      act.importProgress({ id: "nope", fraction: 1 }),
      act.importFailed({ id: "nope", reason: "r", retryable: false }),
      act.importRetried({ id: "nope" }),
      act.importRemoved({ id: "nope" }),
      queued("import:1", "other.gltf"),
    ]) {
      expect(assetShelfReducer(s, action)).toBe(s);
    }
    expect(shelf(queued("import:1"), act.cleared()).imports).toEqual({});
  });
});

describe("an import on the shelf, properties", () => {
  const ids = ["import:1", "import:2", "import:3"];
  const fileIds = [A, "b".repeat(64)];
  const action = fc.oneof(
    fc.constantFrom(...ids).map((id) => queued(id)),
    fc.constantFrom(...ids).map((id) => act.importStarted({ id })),
    fc
      .tuple(
        fc.constantFrom(...ids),
        fc.double({ min: 0, max: 1, noNaN: true }),
      )
      .map(([id, fraction]) => act.importProgress({ id, fraction })),
    fc
      .tuple(fc.constantFrom(...ids), fc.boolean())
      .map(([id, retryable]) =>
        act.importFailed({ id, reason: "r", retryable }),
      ),
    fc.constantFrom(...ids).map((id) => act.importRetried({ id })),
    fc.constantFrom(...ids).map((id) => act.importRemoved({ id })),
    fc.constantFrom(...fileIds).map((id) => file(id)),
  );

  it("rows stay in arrival order, and no import adds an entry by itself", () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 30 }), (actions) => {
        const s = shelf(...actions);
        const filesAdded = new Set(
          actions
            .filter((a) => act.entryAdded.match(a))
            .map((a) => (a.payload as { id: string }).id),
        );
        expect(new Set(Object.keys(s.entries))).toEqual(filesAdded);
        const shown = rows(s);
        const seqOf = (id: string) =>
          s.entries[id]?.seq ?? s.imports[id]?.seq ?? -1;
        const seqs = shown.map((r) => seqOf(r.id));
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(shown.length).toBe(
          Object.keys(s.entries).length + Object.keys(s.imports).length,
        );
      }),
    );
  });
});
