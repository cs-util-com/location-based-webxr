/**
 * The authoring settle's per-moment alignments (owner decision D33).
 *
 * Why these tests matter: the settle used to compose every object of a
 * visit through the alignment at the visit's END, so a note placed early
 * and walked away from inherited all the SLAM drift after it (8.4 m at
 * 500 m, `visit-settle.left-behind.test.ts`). This tracker is what lets the
 * settle use the first mature alignment after each object instead; it must
 * freeze at exactly that alignment, re-open on a move, keep one sighting
 * per second of looking with its time, and fall back to the latest usable
 * alignment when nothing matures before the visit ends.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MATURE_GPS_EXTENT_M } from "gps-plus-slam-app-framework/state/alignment-maturity";

import {
  SIGHTING_SPACING_MS,
  createVisitAlignmentTracker,
} from "./visit-alignment-picks.js";
import type { CodeSighting } from "./visit-settle.js";

const ZERO = { lat: 47.5, lon: 8.7 };

/** A distinguishable alignment: translation x = `tag`. */
function matrix(tag: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tag, 0, 0, 1];
}
const moment = (tag: number, gpsExtentM: number) => ({
  alignmentMatrix: matrix(tag),
  zero: ZERO,
  gpsExtentM,
});
const tagOf = (a: readonly number[] | null | undefined): number | null =>
  a?.[12] ?? null;

function sighting(levelId: string, x: number): CodeSighting {
  return {
    text: `https://example.invalid/?qr=${levelId}`,
    levelId,
    odomPose: { position: [x, 0, 0], rotation: [0, 0, 0, 1] },
  };
}

describe("createVisitAlignmentTracker (D33)", () => {
  it("fixes each object at the first mature alignment at or after its placement", () => {
    const t = createVisitAlignmentTracker();
    t.noteAlignment(moment(1, 5));
    t.notePlacement("early", 1_000);
    t.noteAlignment(moment(2, MATURE_GPS_EXTENT_M - 1));
    t.noteAlignment(moment(3, MATURE_GPS_EXTENT_M));
    t.notePlacement("late", 9_000);
    t.noteAlignment(moment(4, 300));
    t.noteAlignment(moment(5, 600));
    const picks = t.picks();
    expect(tagOf(picks.objects.get("early")?.alignment)).toBe(3);
    expect(picks.objects.get("early")?.atMs).toBe(1_000);
    // Placed after maturity: the alignment of its own moment.
    expect(tagOf(picks.objects.get("late")?.alignment)).toBe(3);
  });

  // Why this test matters: the fallback. A visit that ends before 40 m of
  // extent settles its objects through the end-of-visit alignment, which is
  // the latest one the open pick followed.
  it("follows the alignment to the latest usable one while none matures", () => {
    const t = createVisitAlignmentTracker();
    t.noteAlignment(moment(1, 2));
    t.notePlacement("pin", 0);
    t.noteMeasurement(10);
    t.noteAlignment(moment(2, 30));
    t.noteAlignment({ alignmentMatrix: null, zero: ZERO, gpsExtentM: 90 });
    const picks = t.picks();
    expect(tagOf(picks.objects.get("pin")?.alignment)).toBe(2);
    expect(tagOf(picks.measurement?.alignment)).toBe(2);
    expect(picks.measurement?.atMs).toBe(10);
  });

  it("re-opens an object on a move: a move is a new placement", () => {
    const t = createVisitAlignmentTracker();
    t.noteAlignment(moment(1, 100));
    t.notePlacement("pin", 0);
    t.noteAlignment(moment(2, 200));
    t.notePlacement("pin", 5_000);
    t.noteAlignment(moment(3, 300));
    expect(tagOf(t.picks().objects.get("pin")?.alignment)).toBe(2);
    expect(t.picks().objects.get("pin")?.atMs).toBe(5_000);
  });

  it("keeps no alignment for a placement before any usable one, until one comes", () => {
    const t = createVisitAlignmentTracker();
    t.notePlacement("pin", 0);
    expect(t.picks().objects.get("pin")?.alignment).toBeNull();
    t.noteAlignment(moment(7, 3));
    expect(tagOf(t.picks().objects.get("pin")?.alignment)).toBe(7);
  });

  // Why this test matters: a stable code is re-evaluated many times a
  // second; the settle needs the sighting nearest each note, which a
  // second's resolution gives without one entry per frame.
  it("keeps one sighting per second of looking, each with its own time and pick", () => {
    const t = createVisitAlignmentTracker();
    t.noteAlignment(moment(1, 100));
    for (let ms = 0; ms < 2_500; ms += 100)
      t.noteSighting(sighting("a", ms), ms);
    const kept = t.picks().sightings;
    expect(kept.map((s) => s.atMs)).toEqual([900, 1_900, 2_400]);
    // The newest of each run, frozen at the alignment of its moment.
    expect(kept.map((s) => s.sighting.odomPose.position[0])).toEqual([
      900, 1_900, 2_400,
    ]);
    expect(kept.every((s) => tagOf(s.alignment) === 1)).toBe(true);
    expect(SIGHTING_SPACING_MS).toBe(1_000);
  });

  // Why this test matters: a code re-minted through a pick must record the
  // quality block (fix count, GPS accuracy) of THAT alignment, so the info
  // has to travel with the pick it belongs to.
  it("hands each pick the mint info of its own alignment", () => {
    const t = createVisitAlignmentTracker();
    const info = (n: number) => ({
      hasMatrix: true,
      sampleCount: n,
      gpsAccuracyM: 4,
    });
    t.noteAlignment({
      ...moment(1, MATURE_GPS_EXTENT_M),
      alignmentInfo: info(12),
    });
    t.noteMeasurement(0);
    t.noteAlignment({ ...moment(2, 300), alignmentInfo: info(90) });
    expect(t.picks().measurement?.alignmentInfo).toEqual(info(12));
    t.noteMeasurement(5);
    expect(t.picks().measurement?.alignmentInfo).toEqual(info(90));
  });

  // Why this test matters: D31 marks a code composed through an alignment
  // under 10 m of GPS extent as heading-uncertain, and since R7 of D33 the
  // settle's re-mint carries that marker, so the extent of the alignment a
  // pick froze at has to travel with it, like its mint info.
  it("hands each pick the GPS extent of its own alignment", () => {
    const t = createVisitAlignmentTracker();
    t.noteAlignment(moment(1, 6));
    t.noteMeasurement(0);
    expect(t.picks().measurement?.gpsExtentM).toBe(6);
    t.noteAlignment(moment(2, MATURE_GPS_EXTENT_M));
    t.noteAlignment(moment(3, 300));
    expect(t.picks().measurement?.gpsExtentM).toBe(MATURE_GPS_EXTENT_M);
  });

  // Why this test matters: the settle decides by WALKED distance which code
  // event a note shares its alignment with (review R1 of D33) and which
  // sighting corrects it (R3). Each event keeps the walked distance of its
  // own moment - not of the alignment its pick later freezes at - and an
  // event whose caller never told the distance keeps none.
  it("stamps each event with the walked distance at its own moment", () => {
    const t = createVisitAlignmentTracker();
    t.noteAlignment({ ...moment(1, 5), walkedM: 12 });
    t.noteMeasurement(0);
    t.notePlacement("pin", 10);
    t.noteSighting(sighting("a", 0), 20);
    t.noteAlignment({ ...moment(2, 300), walkedM: 70 });
    t.noteSighting(sighting("a", 1), 500);
    t.noteSighting(sighting("a", 2), 5_000);
    const picks = t.picks();
    expect(picks.measurement?.walkedM).toBe(12);
    expect(picks.objects.get("pin")?.walkedM).toBe(12);
    // The newest of a run replaces it, with its own distance.
    expect(picks.sightings.map((s) => s.walkedM)).toEqual([70, 70]);
    const bare = createVisitAlignmentTracker();
    bare.noteAlignment(moment(1, 5));
    bare.notePlacement("pin", 0);
    expect(bare.picks().objects.get("pin")?.walkedM).toBeUndefined();
  });

  it("never merges sightings of two different codes", () => {
    const t = createVisitAlignmentTracker();
    t.noteAlignment(moment(1, 100));
    t.noteSighting(sighting("a", 0), 0);
    t.noteSighting(sighting("b", 1), 100);
    expect(t.picks().sightings.map((s) => s.sighting.levelId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("forgets everything on reset (a new visit)", () => {
    const t = createVisitAlignmentTracker();
    t.noteAlignment(moment(1, 100));
    t.notePlacement("pin", 0);
    t.noteMeasurement(0);
    t.noteSighting(sighting("a", 0), 0);
    t.reset();
    t.notePlacement("next", 1);
    const picks = t.picks();
    expect([...picks.objects.keys()]).toEqual(["next"]);
    expect(picks.objects.get("next")?.alignment).toBeNull();
    expect(picks.measurement).toBeNull();
    expect(picks.sightings).toEqual([]);
  });

  // Why this test matters: the settle reads the picks after the store has
  // moved on; a pick must not change when a caller mutates what it read.
  it("hands out copies", () => {
    const t = createVisitAlignmentTracker();
    t.noteAlignment(moment(1, 100));
    t.notePlacement("pin", 0);
    const first = t.picks().objects.get("pin")!.alignment as number[];
    first[12] = 99;
    expect(tagOf(t.picks().objects.get("pin")?.alignment)).toBe(1);
  });
});

describe("createVisitAlignmentTracker (property)", () => {
  // Why this test matters: whatever order alignments and placements come
  // in, each object's pick is the definition - the first mature alignment
  // at or after its LAST placement, else the latest one since it.
  it("equals the search over the alignment history for every object", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant("alignment" as const),
              extent: fc.double({ min: 0, max: 200, noNaN: true }),
            }),
            fc.record({
              kind: fc.constant("place" as const),
              id: fc.constantFrom("a", "b", "c"),
            }),
          ),
          { maxLength: 40 },
        ),
        (events) => {
          const t = createVisitAlignmentTracker();
          const history: { tag: number; extent: number }[] = [];
          const placedAt = new Map<string, number>();
          events.forEach((e, i) => {
            if (e.kind === "alignment") {
              history.push({ tag: i, extent: e.extent });
              t.noteAlignment(moment(i, e.extent));
            } else {
              placedAt.set(e.id, history.length);
              t.notePlacement(e.id, i);
            }
          });
          const picks = t.picks();
          for (const [id, from] of placedAt) {
            // The alignment current at the placement, then every later one.
            const seen = history.slice(Math.max(0, from - 1));
            const relevant = from === 0 ? history : seen;
            const mature = relevant.find(
              (h) => h.extent >= MATURE_GPS_EXTENT_M,
            );
            const expected = mature?.tag ?? relevant.at(-1)?.tag ?? null;
            expect(tagOf(picks.objects.get(id)?.alignment)).toBe(expected);
          }
        },
      ),
    );
  });
});
