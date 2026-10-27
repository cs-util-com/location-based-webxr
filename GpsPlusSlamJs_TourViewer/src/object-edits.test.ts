/**
 * Why these tests matter: the phone's object list and the desktop editor
 * (M6 E0c, E2 plan review #8) must agree on what an edit, a delete and an
 * undo do to the lists the Finish writes - otherwise a tour edited on one
 * page and saved on the other drops or revives objects. The rules were
 * wired into `object-editing.ts`; here they are pinned on their own: an
 * empty pin refused (the manifest serializer rejects one, so a save would
 * throw), a hosted delete as a tombstone and a local one dropped, an undo
 * back at the old place, a map move keeping height and facing.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  TourObject,
  TourPicture,
  TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  authoringObjects,
  deleteObject,
  moveObjectTo,
  pinTextEdit,
  upsertPlaced,
} from "./object-edits.js";
import { captionOf } from "./test-support/tour-of.js";

type Entry = { readonly object: TourObject; readonly blob?: Blob };

function pin(id: string, label = `pin ${id}`): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: label,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 },
  };
}

function photo(id: string): TourPicture {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: id,
    widthM: 1,
    imageAsset: {
      id: id,
      path: `content/${id}.jpg`,
      kind: "image",
      width: 4,
      height: 3,
    },
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0.6, 0, 0.8] },
  };
}

describe("pinTextEdit", () => {
  it("edits a pin's text, trimmed", () => {
    expect(pinTextEdit(pin("a", "Old"), "  New  ")).toEqual({
      kind: "edited",
      after: { ...pin("a"), caption: "New" },
    });
  });

  it("refuses an empty pin and leaves the same text alone", () => {
    expect(pinTextEdit(pin("a", "Old"), "   ")).toEqual({
      kind: "refused",
      reason: "A pin needs some text - it was left as it was.",
    });
    expect(pinTextEdit(pin("a", "Old"), "Old ")).toEqual({
      kind: "unchanged",
    });
  });

  // Why: a pin's text is a short text's caption, which the tour file caps
  // at 40 characters; a longer one would make every later save throw. The
  // count is the format's own, so 40 emoji fit (80 UTF-16 units) and a
  // 41st character of any kind does not.
  it("refuses a pin's text past 40 characters, counted as the file counts them", () => {
    expect(pinTextEdit(pin("a", "Old"), "x".repeat(41))).toEqual({
      kind: "refused",
      reason: "A pin's text takes at most 40 characters.",
    });
    const emoji = "😀".repeat(40);
    expect(pinTextEdit(pin("a", "Old"), emoji)).toEqual({
      kind: "edited",
      after: { ...pin("a"), caption: emoji },
    });
  });

  // Why (B2a review finding 6, design §3): text is stored in NFC. A
  // caption typed decomposed (an "e" and a combining accent, as some
  // keyboards and pastes give it) counted twice toward the 40 and was
  // stored as typed, so the same word could be refused on one device and
  // fit on another, and the B3b hash would differ for the same text.
  it("stores a pin's text in NFC and counts it so", () => {
    const decomposed = `e${String.fromCodePoint(0x301)}`.repeat(40);
    expect(decomposed.length).toBe(80);
    expect(pinTextEdit(pin("a", "Old"), decomposed)).toEqual({
      kind: "edited",
      after: { ...pin("a"), caption: "\u00e9".repeat(40) },
    });
  });

  it("does not edit a photo's caption (owner question Q-E2-1)", () => {
    expect(pinTextEdit(photo("p"), "A caption")).toEqual({
      kind: "unchanged",
    });
  });
});

describe("deleteObject", () => {
  it("tombstones a hosted object and drops this device's entry for it", () => {
    const placed: Entry[] = [{ object: pin("a", "edited") }];
    const [entry] = authoringObjects([pin("a")], placed, []);
    const out = deleteObject({ placed, deleted: [] }, entry!);
    expect(out.placed).toEqual([]);
    expect(out.deleted).toEqual(["a"]);
  });

  it("drops a local object without a tombstone", () => {
    const placed: Entry[] = [{ object: pin("x") }, { object: pin("n") }];
    const entries = authoringObjects([], placed, []);
    const out = deleteObject({ placed, deleted: [] }, entries[1]!);
    expect(out.placed.map((p) => p.object.id)).toEqual(["x"]);
    expect(out.deleted).toEqual([]);
  });

  it("takes exactly the one entry, keeps the others' order, and tombstones only a hosted object (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        fc.subarray(["t1", "t2"]),
        (n, pick, hostedToo, earlier) => {
          const placed: Entry[] = Array.from({ length: n }, (_, i) => ({
            object: i % 2 === 0 ? pin(`o${String(i)}`) : photo(`o${String(i)}`),
          }));
          const manifest = hostedToo ? placed.map((p) => p.object) : [];
          const entries = authoringObjects(manifest, placed, []);
          const target = entries[pick % entries.length]!;
          const out = deleteObject({ placed, deleted: [...earlier] }, target);
          const id = target.object.id;
          expect(out.placed).toEqual(placed.filter((p) => p.object.id !== id));
          // Deletions made before this one stay as they were (E2a review #12).
          expect(out.deleted).toEqual(hostedToo ? [...earlier, id] : earlier);
        },
      ),
    );
  });
});

describe("moveObjectTo", () => {
  it("moves a pin and a photo on the map, keeping height and facing", () => {
    expect(moveObjectTo(pin("a"), 47.6, 8.8).geo).toEqual({
      lat: 47.6,
      lon: 8.8,
      alt: 400,
      headingDeg: 30,
    });
    // A photo's rotation is a world-frame quaternion: a move of a few
    // metres keeps its facing (E2 plan review #8).
    expect(moveObjectTo(photo("p"), 47.6, 8.8).geo).toEqual({
      lat: 47.6,
      lon: 8.8,
      alt: 400,
      rotation: [0, 0.6, 0, 0.8],
    });
  });

  it("refuses a position nobody can draw", () => {
    expect(() => moveObjectTo(pin("a"), 123, 8.8)).toThrow(/latitude/i);
    expect(() => moveObjectTo(pin("a"), 47.5, Number.NaN)).toThrow(
      /longitude/i,
    );
    expect(() => moveObjectTo(pin("a"), 47.5, Infinity)).toThrow(/longitude/i);
  });

  // Why (PR #611 review): the map can pan onto a world copy, where a drag
  // reports a longitude past 180; that is an ordinary place on the globe,
  // so it is folded back, not refused.
  it("folds a longitude from a world copy back onto the globe", () => {
    expect(moveObjectTo(pin("a"), 47.5, 183.5).geo.lon).toBeCloseTo(-176.5, 9);
    expect(moveObjectTo(pin("a"), 47.5, -190).geo.lon).toBeCloseTo(170, 9);
    expect(moveObjectTo(pin("a"), 47.5, 541).geo.lon).toBeCloseTo(-179, 9);
    expect(moveObjectTo(pin("a"), 47.5, 180).geo.lon).toBe(180);
    expect(moveObjectTo(pin("a"), 47.5, -180).geo.lon).toBe(-180);
  });
});

describe("upsertPlaced", () => {
  it("replaces an entry by id in place, or appends", () => {
    const placed: Entry[] = [{ object: pin("a") }, { object: pin("b") }];
    expect(
      upsertPlaced(placed, { object: pin("a", "new") }).map((p) =>
        captionOf(p.object),
      ),
    ).toEqual(["new", "pin b"]);
    expect(upsertPlaced(placed, { object: pin("c") })).toHaveLength(3);
  });
});
