/**
 * Why these tests matter: the near-K rule and the morph run every frame
 * over every station, and a creator sees at once a rule that drops the
 * selection, grows past its count, depends on the station list's order,
 * or makes items jump back as the camera tilts. These check the rules'
 * promises over random tours, centres, counts, bands and angles.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { morphStanding, nearStations } from "./editor3d-visibility.js";

describe("morphStanding, for any band and tilts", () => {
  // Why: a camera tilting steadily must see the items rise steadily: never
  // back, never outside flat and upright.
  it("is monotonic in the tilt and clamped to 0..1, for any band", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 80, noNaN: true }),
        fc.double({ min: 0.5, max: 80, noNaN: true }),
        fc.double({ min: -10, max: 100, noNaN: true }),
        fc.double({ min: -10, max: 100, noNaN: true }),
        (from, width, a, b) => {
          const band = { fromDeg: from, toDeg: from + width };
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const sLo = morphStanding(lo, band);
          const sHi = morphStanding(hi, band);
          expect(sLo).toBeGreaterThanOrEqual(0);
          expect(sHi).toBeLessThanOrEqual(1);
          expect(sHi).toBeGreaterThanOrEqual(sLo);
        },
      ),
    );
  });
});

describe("nearStations, for any tour", () => {
  const tour = fc.uniqueArray(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 4 }),
      east: fc.integer({ min: -300, max: 300 }),
      north: fc.integer({ min: -300, max: 300 }),
    }),
    { selector: (s) => s.id, maxLength: 40 },
  );

  // Why: the rule's three promises, over any tour: at most K + 1 stations,
  // the selected one always among them, and the same set however the
  // station list is ordered (the store may hand it over reordered).
  it("returns at most K + 1, always the selected one, the same set in any order", () => {
    fc.assert(
      fc.property(
        tour,
        fc.integer({ min: 0, max: 12 }),
        fc.record({
          east: fc.integer({ min: -300, max: 300 }),
          north: fc.integer({ min: -300, max: 300 }),
        }),
        fc.nat(),
        fc.boolean(),
        (stations, k, centre, pick, select) => {
          const selected =
            select && stations.length > 0
              ? stations[pick % stations.length]!.id
              : null;
          const shown = nearStations(stations, centre, k, selected);
          expect(shown.size).toBeLessThanOrEqual(k + 1);
          expect(shown.size).toBeLessThanOrEqual(stations.length);
          expect(selected === null || shown.has(selected)).toBe(true);
          const reversed = nearStations(
            [...stations].reverse(),
            centre,
            k,
            selected,
          );
          expect([...reversed].sort()).toEqual([...shown].sort());
          // Everything shown but the selection is no farther than anything
          // left out.
          const d = (s: { east: number; north: number }) =>
            Math.hypot(s.east - centre.east, s.north - centre.north);
          const near = stations.filter(
            (s) => shown.has(s.id) && s.id !== selected,
          );
          const out = stations.filter((s) => !shown.has(s.id));
          for (const a of near)
            for (const b of out) expect(d(a)).toBeLessThanOrEqual(d(b));
        },
      ),
    );
  });
});
