import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { EnuPoint } from "./enu.js";
import {
  ROOFSCAPE_DEFAULTS,
  inventedEaveHeightM,
  neighbourhoodPriors,
  offsetRing,
  type PriorEntry,
} from "./roofscape-rules.js";

/**
 * Properties of the invented roofscape's rules that no list of cases pins.
 *
 * WHY THIS FILE MATTERS. The prior decides, for every untagged building in a
 * window, whether it gets a roof. It must not depend on the order the data
 * arrives in (Overpass reorders freely, and a reload would then look
 * different), and the grid that makes it fast must find exactly the
 * neighbours a plain scan of every pair finds.
 */

const P = ROOFSCAPE_DEFAULTS;

const entryArb = fc.record({
  x: fc.double({ min: -900, max: 900, noNaN: true }),
  y: fc.double({ min: -900, max: 900, noNaN: true }),
  roof: fc.constantFrom(undefined, "flat", "gabled", "hipped"),
  height: fc.constantFrom(undefined, "4", "13", "25"),
});

const toEntries = (
  rows: readonly {
    x: number;
    y: number;
    roof: string | undefined;
    height: string | undefined;
  }[],
): PriorEntry[] =>
  rows.map((row, i) => ({
    key: `way/${i}`,
    at: { x: row.x, y: row.y },
    tags: {
      building: "yes",
      ...(row.roof === undefined ? {} : { "roof:shape": row.roof }),
      ...(row.height === undefined ? {} : { height: row.height }),
    },
  }));

/** The definition the grid must reproduce: every pair, no grid. */
function bruteForceFlat(entries: readonly PriorEntry[], self: PriorEntry) {
  let roofs = 0;
  let flat = 0;
  for (const other of entries) {
    const d = Math.hypot(other.at.x - self.at.x, other.at.y - self.at.y);
    if (d > P.priorRadiusM) continue;
    const roof = other.tags["roof:shape"];
    if (roof === undefined) continue;
    roofs += 1;
    if (roof === "flat") flat += 1;
  }
  return { roofs, flat };
}

describe("neighbourhoodPriors, as properties", () => {
  it("does not depend on the order of its input", () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 1000 }),
        (rows, seed) => {
          const entries = toEntries(rows);
          const shuffled = [...entries].sort(
            (a, b) =>
              ((a.key.length * 31 + seed) % 7) -
                ((b.key.length * 31 + seed) % 7) || b.key.localeCompare(a.key),
          );
          const one = neighbourhoodPriors(entries, P);
          const two = neighbourhoodPriors(shuffled, P);
          for (const entry of entries) {
            expect(two.get(entry.key)).toEqual(one.get(entry.key));
          }
        },
      ),
    );
  });

  it("finds the roof votes a scan of every pair finds", () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { minLength: 1, maxLength: 40 }),
        (rows) => {
          const entries = toEntries(rows);
          const priors = neighbourhoodPriors(entries, P);
          for (const self of entries) {
            const { roofs, flat } = bruteForceFlat(entries, self);
            const prior = priors.get(self.key);
            if (roofs >= P.priorMinEvidence) {
              expect(prior?.pitched).toBe(flat / roofs < P.flatShareMin);
            } else {
              expect(prior?.why).not.toMatch(/roofs nearby/);
            }
          }
        },
      ),
    );
  });
});

describe("offsetRing and the invented heights, as properties", () => {
  it("leaves a convex ring where it is when nothing moves", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 12 }),
        fc.double({ min: 2, max: 40, noNaN: true }),
        (corners, radius) => {
          const ring: EnuPoint[] = Array.from({ length: corners }, (_, i) => ({
            x: radius * Math.cos((2 * Math.PI * i) / corners),
            y: radius * Math.sin((2 * Math.PI * i) / corners),
          }));
          const out = offsetRing(
            ring,
            ring.map(() => 0),
          );
          expect(out).toBeDefined();
          out?.forEach((p, i) => {
            expect(p.x).toBeCloseTo(ring[i]?.x ?? NaN, 9);
            expect(p.y).toBeCloseTo(ring[i]?.y ?? NaN, 9);
          });
        },
      ),
    );
  });

  it("keeps every untagged eave inside its class's band", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        (key, area) => {
          const eave = inventedEaveHeightM({ building: "yes" }, area, key);
          expect(eave).toBeGreaterThanOrEqual(2.5);
          expect(eave).toBeLessThanOrEqual(10.5);
        },
      ),
    );
  });
});
