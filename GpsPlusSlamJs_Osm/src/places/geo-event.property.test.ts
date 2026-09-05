/**
 * Property tests for `newGeoEventFor` — the two statements the owner made
 * about the quest picks on 2026-09-04, pinned rather than argued.
 *
 * Why these tests matter: the owner walked 10 m inside one tile, pressed
 * "Show Quests" again and saw a second marker a few metres from the first.
 * The hypothesis was that the exact user position seeds the search. It does
 * not — candidates are hashed into the TILE's bounding box — and property 1
 * is that statement for every user position. Property 2 is the fix for what
 * the owner actually saw: two tiles reporting one plateau from two sides;
 * with a "same spot" predicate no result carries two picks the predicate
 * relates, and the survivor is the one the rule names (higher heat, then the
 * smaller cell id), independent of the user again.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { newGeoEventFor } from "./geo-event.js";

/** Cells are "x,y" on an integer grid; a candidate maps to its rounded cell. */
const toCell = (position: { lat: number; lng: number }): string =>
  `${Math.round(position.lng * 100)},${Math.round(position.lat * 100)}`;
const toLatLng = (cell: string): { lat: number; lng: number } => {
  const [x, y] = cell.split(",").map(Number);
  return { lat: (y ?? 0) / 100, lng: (x ?? 0) / 100 };
};
const neighbours = (cell: string): string[] => {
  const [x, y] = cell.split(",").map(Number);
  const out: string[] = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1)
      out.push(`${(x ?? 0) + dx},${(y ?? 0) + dy}`);
  }
  return out;
};
const gridSteps = (a: string, b: string): number => {
  const [ax, ay] = a.split(",").map(Number);
  const [bx, by] = b.split(",").map(Number);
  return Math.max(
    Math.abs((ax ?? 0) - (bx ?? 0)),
    Math.abs((ay ?? 0) - (by ?? 0)),
  );
};

/** Three tiles in a row, 0.05° wide, over a field warm enough to pass the gate. */
const tiles = [0, 0.05, 0.1].map((lng) => ({
  bbox: { south: 0, west: lng, north: 0.05, east: lng + 0.05 },
}));
/** A bumpy but deterministic heat: the climb has somewhere to go. */
const heatAt = (cell: string): number => {
  const [x, y] = cell.split(",").map(Number);
  return 2 + (((x ?? 0) * 7 + (y ?? 0) * 13) % 5);
};

const event = (
  user: { lat: number; lng: number },
  sameSpot?: (a: string, b: string) => boolean,
) =>
  newGeoEventFor({
    user,
    tiles,
    globalSeed: 7,
    eventTime: 0,
    toCell,
    toLatLng,
    heatAt,
    neighbours,
    steps: 3,
    ...(sameSpot === undefined ? {} : { sameSpot }),
  });

const userArb = fc.record({
  lat: fc.double({ min: -0.1, max: 0.15, noNaN: true }),
  lng: fc.double({ min: -0.1, max: 0.25, noNaN: true }),
});

describe("newGeoEventFor — properties", () => {
  it("the SET of pick cells does not depend on where the user stands; only the order does", () => {
    const reference = event({ lat: 0.025, lng: 0.075 })
      .picks.map((p) => p.cell)
      .sort();
    expect(reference.length).toBeGreaterThan(0);
    fc.assert(
      fc.property(userArb, (user) => {
        const cells = event(user)
          .picks.map((p) => p.cell)
          .sort();
        expect(cells).toEqual(reference);
      }),
    );
  });

  it("with a same-spot predicate no two picks of a result are the same spot, and the survivor is the rule's", () => {
    const within = (steps: number) => (a: string, b: string) =>
      gridSteps(a, b) <= steps;
    fc.assert(
      fc.property(userArb, fc.integer({ min: 0, max: 6 }), (user, steps) => {
        const all = event(user).picks;
        const kept = event(user, within(steps)).picks;
        const tooClose = kept.flatMap((a) =>
          kept
            .filter((b) => a !== b && gridSteps(a.cell, b.cell) <= steps)
            .map((b) => `${a.cell} ~ ${b.cell}`),
        );
        expect(tooClose).toEqual([]);
        // Every dropped pick is the same spot as a kept one that beats it:
        // higher heat, or equal heat and a smaller cell id.
        for (const dropped of all) {
          if (kept.some((k) => k.cell === dropped.cell)) continue;
          const winner = kept.find(
            (k) =>
              gridSteps(k.cell, dropped.cell) <= steps &&
              (k.heat > dropped.heat ||
                (k.heat === dropped.heat && k.cell < dropped.cell)),
          );
          expect(winner, `no winner for dropped ${dropped.cell}`).toBeDefined();
        }
        // And the kept set is still nearest-first for THIS user — measured
        // with the production metric (longitude weighted by cos(lat)), so a
        // near-tie cannot flip between the two formulas.
        const cosLat = Math.cos((user.lat * Math.PI) / 180);
        const d = (p: { position: { lat: number; lng: number } }) =>
          (p.position.lat - user.lat) ** 2 +
          ((p.position.lng - user.lng) * cosLat) ** 2;
        for (let i = 1; i < kept.length; i += 1) {
          expect(d(kept[i]!)).toBeGreaterThanOrEqual(d(kept[i - 1]!) - 1e-12);
        }
      }),
    );
  });
});
