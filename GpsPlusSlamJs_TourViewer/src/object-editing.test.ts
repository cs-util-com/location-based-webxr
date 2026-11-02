/**
 * Why these tests matter: `authoringObjects` is what the object list, the
 * AR previews and (through `applyObjectChanges`) the Finish all read as
 * "the tour's objects now" (authoring plan 2026-09-28-0953 §3.4, M4). If
 * it disagreed with the Finish, the creator would see one tour and publish
 * another; if `upsertPlaced` appended instead of replacing, an edited
 * hosted object would be written twice and every Finish would throw on the
 * duplicate id. The composed actions are tested through the real setup in
 * `authoring-settle.test.ts`.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  TourObject,
  TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { applyObjectChanges } from "./authoring-draft.js";
import type { UndoOffer } from "./creator-undo.js";
import { wireObjectEditing } from "./object-editing.js";
import { authoringObjects, upsertPlaced } from "./object-edits.js";
import type { ObjectListHandlers } from "./object-list.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";

function pin(id: string, label = `pin ${id}`): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: label,
    createdAtIso: "2026-09-30T00:00:00.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

describe("authoringObjects", () => {
  it("is the manifest with this device's records replacing theirs, new ones after, deleted ones gone", () => {
    const view = authoringObjects(
      [pin("a"), pin("b"), pin("c")],
      [{ object: pin("b", "edited") }, { object: pin("new") }],
      ["c"],
    );
    expect(
      view.map((o) => [o.object.id, o.hosted, o.changed, o.placed !== null]),
    ).toEqual([
      ["a", true, false, false],
      ["b", true, true, true],
      ["new", false, true, true],
    ]);
    expect(view[1]?.object).toEqual(pin("b", "edited"));
  });

  it("lists exactly what the Finish writes, whatever the edits and deletions (property)", () => {
    const ids = fc.constantFrom<string>("a", "b", "c", "d", "e");
    fc.assert(
      fc.property(
        fc.uniqueArray(ids, { maxLength: 5 }),
        fc.uniqueArray(ids, { maxLength: 5 }),
        fc.array(ids, { maxLength: 5 }),
        (hostedIds, placedIds, deleted) => {
          const hosted = hostedIds.map((id) => pin(id));
          const placed = placedIds.map((id) => ({ object: pin(id, "mine") }));
          const view = authoringObjects(hosted, placed, deleted);
          expect(view.map((o) => o.object)).toEqual(
            applyObjectChanges(
              hosted,
              placed.map((p) => p.object),
              deleted,
            ),
          );
        },
      ),
    );
  });
});

describe("upsertPlaced", () => {
  it("replaces the entry with the same id, keeping the others and their order", () => {
    const out = upsertPlaced([{ object: pin("a") }, { object: pin("b") }], {
      object: pin("a", "edited"),
    });
    expect(out.map((p) => p.object)).toEqual([pin("a", "edited"), pin("b")]);
  });

  it("appends an id it does not have", () => {
    const out = upsertPlaced([{ object: pin("a") }], { object: pin("b") });
    expect(out.map((p) => p.object.id)).toEqual(["a", "b"]);
  });
});

/**
 * Why this test matters: a delete names what it took in the list's note
 * and in the strip's Undo ("Undo: delete the long text"). The name comes
 * from the kind's word; a fixed "the photo" there would tell a creator
 * they deleted a picture when they deleted a text, and nothing else would
 * notice.
 */
describe("wireObjectEditing delete", () => {
  it("names a deleted long text by its kind in the note and the Undo", () => {
    const ctx = createTourViewerSession();
    const text: TourObject = {
      id: "door",
      kind: "longText",
      view: "lectern",
      title: "The door",
      body: "Painted red in spring.",
      createdAtIso: "2026-10-19T00:00:00.000Z",
      geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    };
    ctx.tourDocument.open(tourOf([text]));
    let handlers: ObjectListHandlers | null = null;
    const notes: string[] = [];
    const offers: UndoOffer[] = [];
    wireObjectEditing({
      ctx,
      arStore: createTourViewerStore(),
      view: {
        bind: (h) => {
          handlers = h;
        },
        render: (model) => {
          notes.push(model.note);
        },
      },
      getArWorldGroup: () => null,
      sessionLive: () => false,
      placementAllowed: () => false,
      settleInputs: () => ({}) as never,
      codes: () => [],
      schedule: () => () => undefined,
      syncPreviews: () => undefined,
      renderAuthorReadout: () => undefined,
      offerUndo: (offer) => {
        offers.push(offer);
      },
    });
    handlers!.remove("door");
    expect(notes).toContain("Deleting the long text…");
    expect(offers.map((o) => o.target)).toEqual(["delete the long text"]);
  });
});
