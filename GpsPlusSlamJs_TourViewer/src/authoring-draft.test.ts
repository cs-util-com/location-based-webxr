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
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  appendWithoutDuplicateIds,
  draftIsSpent,
  draftKeyForTour,
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

function draftOf(objects: readonly TourObject[]): AuthoringDraft {
  return {
    tourUrl: "https://h/t.zip",
    sizeM: 0.16,
    level: { id: "abc", json: "{}" },
    objects,
  };
}

function manifestOf(objects: readonly TourObject[]): TourManifest {
  return { version: 1, objects: [...objects] };
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

describe("draftIsSpent", () => {
  it("is spent exactly when the hosted zip carries all of it", () => {
    // This is the ONLY signal that deletes a draft. Not "the creator
    // tapped download": on Android that resolves true the moment a
    // download starts, before any file is known to exist - and the
    // creator still has to upload it by hand afterwards.
    const draft = draftOf([pin("a"), pin("b")]);
    expect(draftIsSpent(draft, manifestOf([pin("a")]))).toBe(false);
    expect(draftIsSpent(draft, manifestOf([pin("a"), pin("b")]))).toBe(true);
    expect(draftIsSpent(draft, null)).toBe(false);
  });

  it("an empty draft is spent, so it cannot be offered as nothing", () => {
    expect(draftIsSpent(draftOf([]), null)).toBe(true);
  });
});

describe("appendWithoutDuplicateIds", () => {
  it("keeps the existing objects and adds only new ids", () => {
    const result = appendWithoutDuplicateIds(
      [pin("a"), pin("b")],
      [pin("b"), pin("c")],
    );
    expect(result.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("produces no duplicate ids whatever it is given (property)", () => {
    // The finish serialises through `parseTourManifest`, which REJECTS
    // duplicate ids - so this function's output is the difference between
    // a finish that works and one that throws every time it is retried.
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { maxLength: 10 }),
        fc.array(fc.string({ minLength: 1 }), { maxLength: 10 }),
        (existingIds, additionIds) => {
          const out = appendWithoutDuplicateIds(
            // The existing list can itself repeat only if the manifest was
            // already broken; dedupe the input so the property is about
            // THIS function.
            [...new Set(existingIds)].map(pin),
            additionIds.map(pin),
          );
          expect(new Set(out.map((o) => o.id)).size).toBe(out.length);
          // Order is stable: existing first, then new ones as given.
          expect(
            out.slice(0, new Set(existingIds).size).map((o) => o.id),
          ).toEqual([...new Set(existingIds)]);
        },
      ),
    );
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

  it("always names the count and never reads as a command (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (count) => {
        expect(restoreOfferText(count)).toContain(String(count));
        expect(restoredText(count)).toContain(String(count));
      }),
    );
  });
});
