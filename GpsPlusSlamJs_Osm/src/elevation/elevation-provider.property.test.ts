/**
 * `fallbackProvider`'s merge, as a property.
 *
 * WHY THIS FILE EXISTS. The unit tests pin representative answer patterns
 * (all / none / some), but the merge's real claim is universal: for ANY
 * pattern of primary coverage, every position gets `primary ?? fallback` —
 * the primary's answer is never displaced, and a gap is filled from the
 * fallback at exactly its own index. An off-by-one in the gap bookkeeping
 * would shift fallback answers onto neighbouring positions, which produces
 * plausible-looking terrain that is wrong only where coverage happens to end,
 * i.e. exactly where an example-based test was not looking.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fallbackProvider } from "./elevation-provider.js";
import type { ElevationProvider } from "./elevation-provider.js";
import type { LatLng } from "../model/osm-feature.js";

/** An elevation answer: a metre value, or "no data here". */
const answer = fc.option(fc.integer({ min: -430, max: 8848 }), {
  nil: undefined,
});

function tableProvider(
  sourceId: string,
  table: readonly (number | undefined)[],
  calls: (readonly LatLng[])[],
): ElevationProvider {
  return {
    attribution: `© ${sourceId}`,
    sourceId,
    elevationAt: (positions) => {
      calls.push(positions);
      // Positions encode their own index as `lat`, so a provider can answer
      // per-position regardless of which subset it is handed.
      return Promise.resolve(positions.map((p) => table[p.lat]));
    },
  };
}

describe("fallbackProvider merge property", () => {
  it("answers primary[i] ?? fallback[i] for every pattern, querying only the gaps", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(answer, answer), { maxLength: 40 }),
        async (pattern) => {
          const primaryTable = pattern.map(([p]) => p);
          const fallbackTable = pattern.map(([, f]) => f);
          const positions = pattern.map((_, i) => ({ lat: i, lng: 0 }));

          const primaryCalls: (readonly LatLng[])[] = [];
          const fallbackCalls: (readonly LatLng[])[] = [];
          const out = await fallbackProvider(
            tableProvider("primary", primaryTable, primaryCalls),
            tableProvider("fallback", fallbackTable, fallbackCalls),
          ).elevationAt(positions);

          // The contract: same length, and per position the primary's answer
          // wins with the fallback filling only true gaps.
          expect(out).toHaveLength(positions.length);
          out.forEach((v, i) => {
            expect(v).toBe(primaryTable[i] ?? fallbackTable[i]);
          });

          // The fallback saw exactly the unanswered positions — never an
          // answered one (wasted quota), never a second batch.
          const gaps = positions.filter(
            (_, i) => primaryTable[i] === undefined,
          );
          expect(fallbackCalls).toEqual(gaps.length === 0 ? [] : [gaps]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
