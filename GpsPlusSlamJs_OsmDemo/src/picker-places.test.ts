/**
 * WHY THESE TESTS MATTER (DEC-R6b-1, DEC-R6b-2, DEC-R6b-4).
 *
 * Round 7 SPLIT this list from the corpus table, reversing DEC-R4-11's "one
 * table" design. The reason that design gave has not expired — two lists drift,
 * and the drift's specific cost is that the places a human can reach stop being
 * the places the suite covers. So the split had to come with a replacement rule,
 * and these tests ARE that rule. Delete them and the split silently becomes the
 * blind spot the corpus was built to close.
 *
 * The rule is REACHABILITY, not membership: a corpus site need not appear in the
 * dropdown (the owner was emphatic that Sylt must not), but it must stay
 * visitable. See the round-7 plan §1 for why those two are separable.
 */

import { describe, expect, it } from "vitest";
import { CORPUS_SITES } from "gps-plus-slam-osm";

import { PICKER_PLACES, placeById } from "./picker-places.js";

describe("PICKER_PLACES", () => {
  it("opens on Manhattan — it is first, and DEC-R6b-3 makes it the default", () => {
    // Not "Manhattan is present". The note asked for it at position 1
    // specifically, and first-ness is the part a reordering would silently lose.
    expect(PICKER_PLACES[0]?.id).toBe("manhattan-central-park");
  });

  it("puts Manhattan at the Central Park edge, not at the corpus coordinate", () => {
    // DEC-R6b-3 asked for the park in the opening frame; the corpus
    // `manhattan-midtown` sits ~2 km south and may NOT be moved, because its
    // captured extract is bound to that coordinate. The divergence is the
    // expected consequence of the split, so it is pinned rather than tolerated.
    const manhattan = placeById("manhattan-central-park");
    const corpus = CORPUS_SITES.find((s) => s.id === "manhattan-midtown");

    expect(manhattan).toBeDefined();
    expect(corpus).toBeDefined();
    expect(manhattan?.position).not.toEqual(corpus?.position);
    // Central Park's southern edge, give or take a few blocks.
    expect(manhattan?.position.lat).toBeGreaterThan(40.76);
    expect(manhattan?.position.lat).toBeLessThan(40.79);
    expect(manhattan?.position.lng).toBeGreaterThan(-73.99);
    expect(manhattan?.position.lng).toBeLessThan(-73.94);
  });

  it("does NOT offer the three places the note asked to remove", () => {
    // Sylt "auf jeden Fall", plus Berlin and Heidelberg. This is the assertion
    // that would fail if someone "fixed" the containment rule by deriving the
    // picker as "corpus plus extras" — which is why DEC-R6b-1 requires the rule
    // to be a test rather than a construction.
    const positions = PICKER_PLACES.map((p) => p.position);
    const banned = [
      { lat: 54.907, lng: 8.2985 }, // Sylt Westerland
      { lat: 49.4118, lng: 8.7106 }, // Heidelberg Altstadt
      { lat: 52.5219, lng: 13.4132 }, // Berlin Alexanderplatz
    ];

    for (const place of banned) {
      expect(positions).not.toContainEqual(place);
    }
    const names = PICKER_PLACES.map((p) => p.name.toLowerCase()).join(" ");
    expect(names).not.toMatch(/sylt|heidelberg|berlin/);
  });

  it("gives every entry a note, because the picker RENDERS it as the tooltip", () => {
    // Q-R6b-1. `site-picker.ts` sets `option.title` from this field, so an
    // entry without one is not merely undocumented — it is a row with no
    // tooltip sitting beside rows that have one.
    for (const place of PICKER_PLACES) {
      expect(place.note.length, `${place.id} has no note`).toBeGreaterThan(20);
    }
  });

  it("keeps ids unique and URL-safe, because they are a URL parameter", () => {
    const ids = PICKER_PLACES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("holds every position on Earth", () => {
    for (const { id, position } of PICKER_PLACES) {
      expect(Math.abs(position.lat), id).toBeLessThanOrEqual(90);
      expect(Math.abs(position.lng), id).toBeLessThanOrEqual(180);
    }
  });

  it("offers about fourteen places — the note invited more, not fifteen more", () => {
    // DEC-R6b-4: the eight named plus about six. The bound is loose on purpose;
    // what it catches is a list that has quietly grown into the long dropdown
    // round 5 already called too busy.
    expect(PICKER_PLACES.length).toBeGreaterThanOrEqual(12);
    expect(PICKER_PLACES.length).toBeLessThanOrEqual(16);
  });

  it("still offers the two corpus sites the note kept", () => {
    // Cologne and Tokyo were explicitly kept, and at their corpus coordinates —
    // so for these two the picker and the corpus do NOT diverge.
    for (const id of ["cologne-cathedral", "tokyo-shinjuku"]) {
      const place = placeById(id);
      const corpus = CORPUS_SITES.find((s) => s.id === id);
      expect(place?.position).toEqual(corpus?.position);
    }
  });
});

describe("placeById", () => {
  it("returns undefined for an unknown id rather than throwing", () => {
    // The same reasoning as `siteById` and `parseStartPosition`: the id comes
    // from a URL, and an unrecognised one means "fall back", not "the app is
    // broken".
    expect(placeById("atlantis")).toBeUndefined();
    expect(placeById("")).toBeUndefined();
  });

  it("finds every place it lists", () => {
    for (const place of PICKER_PLACES) {
      expect(placeById(place.id)).toBe(place);
    }
  });
});
