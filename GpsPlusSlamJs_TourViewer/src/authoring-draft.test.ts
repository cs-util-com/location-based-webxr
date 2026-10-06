/**
 * Why these tests matter (second testing session, F13, and its cold
 * review). The draft exists to stop a crash losing a creator's walk, and
 * every way it can go wrong makes things WORSE than having no draft at
 * all:
 *
 * - restoring an object the hosted zip already has makes
 *   `serializeTourManifest` throw on every future finish, permanently,
 *   with no escape inside the app;
 * - resetting the draft at each finish loses the batch that only lives in
 *   an in-memory Blob, and produces two downloads that each miss the
 *   other's content, silently;
 * - keying it by the normalised archive url would give one tour two
 *   identities between a dev host and a deployment.
 *
 * So the rules are pure functions with their own tests, and the OPFS
 * mechanics are somebody else's problem.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  createEmptyTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  applyObjectChanges,
  contentEntriesToRemove,
  draftDeletionsNotYetHosted,
  draftHasUnhostedLevel,
  draftIsSpent,
  draftKeyForTour,
  draftLevels,
  draftObjectsNotYetHosted,
  restoredText,
  restoreOfferText,
  type AuthoringDraft,
} from "./authoring-draft.js";

function pin(id: string): TourObject {
  return {
    id,
    kind: "pin",
    label: id,
    createdAtIso: "2026-09-09T00:00:00.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

function draftOf(
  objects: readonly TourObject[],
  deleted: readonly string[] = [],
): AuthoringDraft {
  return {
    tourUrl: "https://h/t.zip",
    sizeM: 0.16,
    level: { id: "abc", json: "{}" },
    objects,
    deleted,
  };
}

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-09-09T00:00:00.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

/** A pin with the same id and a new text: an edit. */
function edited(object: TourObject, label: string): TourObject {
  return object.kind === "pin" ? { ...object, label } : object;
}

function manifestOf(objects: readonly TourObject[]): TourManifest {
  return { ...createEmptyTourManifest(), objects: [...objects] };
}

describe("draftObjectsNotYetHosted", () => {
  it("adds back only what the hosted zip does not already carry", () => {
    // The one rule the whole feature turns on. An object the zip already
    // has must never be re-appended: ids are unique in tour.json, so a
    // duplicate does not corrupt the file - it makes every finish THROW,
    // for as long as the draft is restored.
    const draft = draftOf([pin("a"), pin("b"), pin("c")]);
    const hosted = manifestOf([pin("a")]);
    expect(draftObjectsNotYetHosted(draft, hosted).map((o) => o.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("counts an EDIT of a hosted object as not yet hosted - content, not ids (plan §3.4)", () => {
    // Why this test matters: comparing ids made an edit to a hosted pin
    // look "already in the zip", so the restore dropped it and the spent
    // rule deleted the draft that held it - the edit was lost silently
    // (cold review #8).
    const hosted = manifestOf([pin("a"), pin("b")]);
    const draft = draftOf([edited(pin("a"), "the new text"), pin("b")]);
    expect(draftObjectsNotYetHosted(draft, hosted).map((o) => o.id)).toEqual([
      "a",
    ]);
    // ...and it is hosted once the zip carries THAT content.
    expect(
      draftObjectsNotYetHosted(
        draft,
        manifestOf([edited(pin("a"), "the new text"), pin("b")]),
      ),
    ).toEqual([]);
  });

  it("judges content regardless of the order the fields were written in", () => {
    // A record read back from disk and one minted in memory carry their
    // fields in different orders; the same pin must still be the same pin.
    const reordered = JSON.parse(
      JSON.stringify({
        label: "a",
        geo: { headingDeg: 0, alt: 400, lon: 8.7, lat: 47.5 },
        createdAtIso: "2026-09-09T00:00:00.000Z",
        kind: "pin",
        id: "a",
      }),
    ) as TourObject;
    expect(
      draftObjectsNotYetHosted(draftOf([pin("a")]), manifestOf([reordered])),
    ).toEqual([]);
  });

  it("adds everything when the tour has no manifest yet", () => {
    // An empty starter zip, or one whose tour.json has not loaded: the
    // safe reading is "the zip has nothing of mine".
    const draft = draftOf([pin("a"), pin("b")]);
    expect(draftObjectsNotYetHosted(draft, null)).toHaveLength(2);
    expect(draftObjectsNotYetHosted(draft, manifestOf([]))).toHaveLength(2);
  });

  it("never returns anything the manifest already has (property)", () => {
    // Stated as a property because the failure is permanent and silent:
    // the finish's own validation rejects duplicate ids, so ONE leak here
    // bricks the finish until the site's storage is cleared.
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 8 }),
        fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 8 }),
        (draftIds, hostedIds) => {
          const result = draftObjectsNotYetHosted(
            draftOf(draftIds.map(pin)),
            manifestOf(hostedIds.map(pin)),
          );
          const hosted = new Set(hostedIds);
          for (const object of result)
            expect(hosted.has(object.id)).toBe(false);
          // ...and nothing that SHOULD come back is dropped.
          expect(result.map((o) => o.id)).toEqual(
            draftIds.filter((id) => !hosted.has(id)),
          );
        },
      ),
    );
  });
});

describe("deletions (tombstones, plan §3.4)", () => {
  it("keeps a deletion pending while the hosted zip still carries the object", () => {
    const draft = draftOf([], ["a", "gone"]);
    expect(draftDeletionsNotYetHosted(draft, manifestOf([pin("a")]))).toEqual([
      "a",
    ]);
    expect(draftDeletionsNotYetHosted(draft, null)).toEqual([]);
  });

  it("is not spent while a deletion has not reached the hosted zip", () => {
    // A draft holding only a deletion is real work: deleting it as spent
    // would bring the deleted object back on the next Finish.
    const draft = { ...draftOf([], ["a"]), level: null };
    expect(draftIsSpent(draft, manifestOf([pin("a")]))).toBe(false);
    expect(draftIsSpent(draft, manifestOf([pin("b")]))).toBe(true);
  });
});

describe("draftIsSpent", () => {
  it("is spent exactly when the hosted zip carries all of it", () => {
    // This is the ONLY signal that deletes a draft. Not "the creator
    // tapped download": on Android that resolves true the moment a
    // download starts, before any file is known to exist - and the
    // creator still has to upload it by hand afterwards.
    const draft = draftOf([pin("a"), pin("b")]);
    const hosted = "{}"; // the draft's level, already in the zip
    expect(draftIsSpent(draft, manifestOf([pin("a")]), hosted)).toBe(false);
    expect(draftIsSpent(draft, manifestOf([pin("a"), pin("b")]), hosted)).toBe(
      true,
    );
    expect(draftIsSpent(draft, null, hosted)).toBe(false);
    // ...and NOT spent while the measurement is still only on this device,
    // however many of its objects the zip already has.
    expect(draftIsSpent(draft, manifestOf([pin("a"), pin("b")]), null)).toBe(
      false,
    );
  });

  it("an object-less draft is NOT spent while it still holds a measurement", () => {
    // The blocker this rule was written wrong for. Measuring is the most
    // expensive thing a creator does - walking to the poster, holding the
    // phone until the pose is stable and GPS has aligned. Mint, then have
    // the tab killed before the first pin, and a draft holds a level and
    // no objects. Judging that by objects alone DELETED the measurement
    // and sent them back to the wall.
    //
    // The earlier version of this test asserted the opposite and was the
    // reason the bug looked correct: not offering and DELETING are
    // different actions, and only the second is destructive.
    const withLevel = draftOf([]);
    expect(draftIsSpent(withLevel, null, null)).toBe(false);
    // ...and it IS spent once the hosted zip carries that same level.
    expect(draftIsSpent(withLevel, null, "{}")).toBe(true);
  });

  it("a draft with neither objects nor a measurement is spent", () => {
    const empty = { ...draftOf([]), level: null };
    expect(draftIsSpent(empty, null)).toBe(true);
  });

  it("a draft holding AR visits is NOT spent: the zip never carries them (M3a/M3b review #5)", () => {
    // A visit that only re-scanned a hosted code leaves nothing else, and
    // the sweep that follows "spent" deleted its file - the summary's only
    // evidence for that code. Only a discard drops visits.
    const empty = { ...draftOf([]), level: null };
    expect(draftIsSpent(empty, null, null, 1)).toBe(false);
    expect(
      draftIsSpent(draftOf([pin("a")]), manifestOf([pin("a")]), "{}", 2),
    ).toBe(false);
    expect(draftIsSpent(empty, null, null, 0)).toBe(true);
  });

  it("draftHasUnhostedLevel says when a measurement is worth offering", () => {
    expect(draftHasUnhostedLevel(draftOf([]), null)).toBe(true);
    expect(draftHasUnhostedLevel(draftOf([]), "{}")).toBe(false);
    expect(draftHasUnhostedLevel({ ...draftOf([]), level: null }, null)).toBe(
      false,
    );
  });
});

describe("applyObjectChanges (the Finish: replace and filter, plan §3.4)", () => {
  it("replaces an edited object in place, appends new ones and drops deleted ones", () => {
    // Why this test matters: the finish used to APPEND, skipping ids the
    // manifest had - so an edit to a hosted pin was silently dropped at
    // Finish, and a delete had no way to be written at all.
    const result = applyObjectChanges(
      [pin("a"), pin("b"), photo("c")],
      [edited(pin("a"), "moved text"), pin("d")],
      ["c"],
    );
    expect(result.map((o) => o.id)).toEqual(["a", "b", "d"]);
    expect(result[0]).toEqual(edited(pin("a"), "moved text"));
  });

  it("never resurrects a deleted id and never duplicates one, whatever it is given (property)", () => {
    // The finish serialises through `parseTourManifest`, which REJECTS
    // duplicate ids - so a duplicate here is a finish that throws on every
    // retry; and a deleted id coming back is the delete silently undone.
    const ids = fc.constantFrom<string>("a", "b", "c", "d", "e", "f");
    fc.assert(
      fc.property(
        fc.uniqueArray(ids, { maxLength: 6 }),
        fc.array(fc.tuple(ids, fc.string({ minLength: 1 })), {
          maxLength: 10,
        }),
        fc.array(ids, { maxLength: 6 }),
        (existingIds, changeSpecs, deleted) => {
          const changes = changeSpecs.map(([id, label]) =>
            edited(pin(id), label),
          );
          const out = applyObjectChanges(
            existingIds.map(pin),
            changes,
            deleted,
          );
          const outIds = out.map((o) => o.id);
          expect(new Set(outIds).size).toBe(outIds.length);
          for (const id of deleted) expect(outIds).not.toContain(id);
          const gone = new Set<string>(deleted);
          // Every surviving id is there, carrying its LAST change.
          const expected = new Set(
            [...existingIds, ...changes.map((c) => c.id)].filter(
              (id) => !gone.has(id),
            ),
          );
          expect(new Set(outIds)).toEqual(expected);
          const lastChange = new Map(changes.map((c) => [c.id, c]));
          expect(out).toEqual(out.map((o) => lastChange.get(o.id) ?? o));
          // Hosted order is kept: the existing survivors come first.
          const survivors = existingIds.filter((id) => !gone.has(id));
          expect(outIds.slice(0, survivors.length)).toEqual(survivors);
        },
      ),
    );
  });
});

describe("contentEntriesToRemove (a deleted photo takes its jpg with it)", () => {
  it("names each deleted photo's content entry under the zip's wrap, and nothing else", () => {
    expect(
      contentEntriesToRemove(
        [photo("p1"), photo("p2"), pin("a")],
        ["p1", "a", "absent"],
        "mytour/",
      ),
    ).toEqual(["mytour/content/p1.jpg"]);
    expect(contentEntriesToRemove([photo("p1")], [], "")).toEqual([]);
  });
});

describe("draftKeyForTour", () => {
  it("keys by the creator's own link, so one tour has one identity", () => {
    // NOT `session.archive.url`: that is normalised, and a Drive tour's
    // proxy route is a RELATIVE path on a deployment and an absolute one
    // on a dev host - the same tour, two keys, and a draft that vanishes
    // when the creator moves between them.
    expect(draftKeyForTour("  https://h/t.zip  ")).toBe("https://h/t.zip");
    expect(draftKeyForTour("https://h/a.zip")).not.toBe(
      draftKeyForTour("https://h/b.zip"),
    );
    // Two tours that differ only in a query are different tours.
    expect(draftKeyForTour("https://h/t.zip?v=1")).not.toBe(
      draftKeyForTour("https://h/t.zip?v=2"),
    );
  });
});

describe("the words the creator reads", () => {
  it("says how much is waiting, and singular when it is one", () => {
    // The creator is being asked to decide about work they may not
    // remember doing; a count is the one fact that makes that possible.
    expect(restoreOfferText(1)).toContain("1 thing");
    expect(restoreOfferText(3)).toContain("3 things");
    expect(restoredText(1)).toContain("1 placed object");
    expect(restoredText(2)).toContain("2 placed objects");
  });

  it("names changes and deletions next to what was placed", () => {
    // A restore that brings back a deletion must say so: "Add it back?"
    // over a bare count would read as bringing the object back.
    expect(restoreOfferText(1, false, { changed: 1, deleted: 2 })).toContain(
      "1 thing you placed, 1 change and 2 deletions",
    );
    expect(restoreOfferText(0, false, { changed: 0, deleted: 1 })).toContain(
      "1 deletion",
    );
    expect(restoredText(0, false, { changed: 2, deleted: 0 })).toContain(
      "2 changes",
    );
  });

  it("names AR visits apart, and never says they go into the zip", () => {
    expect(restoreOfferText(0, false, { visits: 2 })).toBe(
      "Unsaved work from this tour is still on this device: 2 AR visits for the summary map. Add them back?",
    );
    expect(restoreOfferText(1, true, { visits: 1 })).toContain(
      "1 thing you placed, 1 AR visit for the summary map and the code's measured position",
    );
    expect(restoredText(0, false, { visits: 1 })).toBe(
      "1 AR visit restored - the summary after the next Finish shows it.",
    );
    expect(restoredText(2, false, { visits: 3 })).toBe(
      "2 placed objects restored - they go into the zip on the next Finish. 3 AR visits came back for the summary too.",
    );
  });

  it("always names the count and never reads as a command (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (count) => {
        expect(restoreOfferText(count)).toContain(String(count));
        expect(restoredText(count)).toContain(String(count));
      }),
    );
  });
});

describe("a draft with several codes (code book plan M4c-1)", () => {
  // Why: a draft holding two measured codes was judged by its one `level`,
  // so a draft whose OTHER code the hosted zip does not hold yet could be
  // deleted as spent - the measurement lost. Every code must be hosted.
  const a = { id: "aaaaaaaaaaa1", json: "A" };
  const b = { id: "bbbbbbbbbbb2", json: "B" };
  const twoCodes: AuthoringDraft = { ...draftOf([]), level: b, levels: [a, b] };
  const hostedOf = (texts: Record<string, string>) => (id: string) =>
    texts[id] ?? null;

  it("is spent only when the hosted zip holds every code", () => {
    expect(
      draftIsSpent(
        twoCodes,
        manifestOf([]),
        hostedOf({ [a.id]: "A", [b.id]: "B" }),
      ),
    ).toBe(true);
    expect(
      draftIsSpent(twoCodes, manifestOf([]), hostedOf({ [b.id]: "B" })),
    ).toBe(false);
    expect(draftHasUnhostedLevel(twoCodes, hostedOf({ [b.id]: "B" }))).toBe(
      true,
    );
    expect(
      draftHasUnhostedLevel(twoCodes, hostedOf({ [a.id]: "A", [b.id]: "B" })),
    ).toBe(false);
  });

  it("reads the legacy one-level form: a string is the hosted text of `level`", () => {
    const one: AuthoringDraft = { ...draftOf([]), level: a };
    expect(draftHasUnhostedLevel(one, "A")).toBe(false);
    expect(draftHasUnhostedLevel(one, "old")).toBe(true);
    expect(draftLevels(one)).toEqual([a]);
    expect(draftLevels(twoCodes)).toEqual([a, b]);
  });
});
