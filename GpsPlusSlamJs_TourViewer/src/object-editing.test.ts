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
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { applyObjectChanges } from "./authoring-draft.js";
import { authoringObjects, upsertPlaced } from "./object-editing.js";

function pin(id: string, label = `pin ${id}`): TourObject {
  return {
    id,
    kind: "pin",
    label,
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
