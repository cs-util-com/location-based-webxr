/**
 * The elevation seam: the null provider, the median, and multi-source consensus.
 *
 * WHY CONSENSUS IS TESTED AT ALL. It is the one idea taken wholesale from the
 * C# reference's elevation lookup, which appends every sample from every
 * provider to a per-cell list and reads back the median. The reasoning survives
 * the port: a single DEM source serving wrong data for a region is undetectable
 * from inside, and two disagreeing sources are a signal available no other way.
 *
 * The tests therefore pin the two properties that make it worth the extra
 * request: a median (not a mean, because DEM disagreement is a large systematic
 * offset rather than noise), and a failing provider that costs nothing.
 */

import { describe, expect, it } from "vitest";

import {
  NullElevationProvider,
  consensusProvider,
  median,
} from "./elevation-provider.js";
import type { ElevationProvider } from "./elevation-provider.js";

const AT = [
  { lat: 50.94, lng: 6.95 },
  { lat: 50.95, lng: 6.96 },
];

function fixed(
  sourceId: string,
  values: readonly (number | undefined)[],
): ElevationProvider {
  return {
    attribution: `© ${sourceId}`,
    sourceId,
    elevationAt: () => Promise.resolve(values),
  };
}

function broken(sourceId: string): ElevationProvider {
  return {
    attribution: `© ${sourceId}`,
    sourceId,
    elevationAt: () => Promise.reject(new Error("down")),
  };
}

describe("NullElevationProvider", () => {
  it("returns undefined per position, never 0", () => {
    // Zero is a real elevation — most of the Netherlands is near it. An app
    // that has not configured elevation must see an absence it can branch on,
    // not a sea-level claim it will render. (The C# reference's own
    // NoElevationLookup returns 1 rather than 0 for the same reason, which is
    // a workaround for a type that could not say "I don't know".)
    return expect(new NullElevationProvider().elevationAt(AT)).resolves.toEqual(
      [undefined, undefined],
    );
  });
});

describe("median", () => {
  it("is the middle of an odd sample", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middles of an even sample", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is undefined for no samples, not 0", () => {
    expect(median([])).toBeUndefined();
  });

  it("ignores input order", () => {
    expect(median([5, 1, 9, 3, 7])).toBe(median([9, 7, 5, 3, 1]));
  });
});

describe("consensusProvider", () => {
  it("takes the median across providers, per position", async () => {
    const consensus = consensusProvider([
      fixed("a", [100, 200]),
      fixed("b", [110, 500]),
      fixed("c", [105, 210]),
    ]);

    // Position 1: 100/110/105 -> 105. Position 2: 200/500/210 -> 210, i.e. the
    // outlier is rejected rather than averaged in. A mean would give ~303 and
    // would be wrong in exactly the way one bad DEM source makes it wrong.
    await expect(consensus.elevationAt(AT)).resolves.toEqual([105, 210]);
  });

  it("survives a provider that rejects", async () => {
    // "The fallback is down" must not take the primary with it.
    const consensus = consensusProvider([fixed("a", [100, 200]), broken("b")]);
    await expect(consensus.elevationAt(AT)).resolves.toEqual([100, 200]);
  });

  it("reports undefined where NO provider has data", async () => {
    const consensus = consensusProvider([
      fixed("a", [undefined, 200]),
      fixed("b", [undefined, 210]),
    ]);
    await expect(consensus.elevationAt(AT)).resolves.toEqual([undefined, 205]);
  });

  it("ignores a non-finite sample rather than poisoning the median", async () => {
    const consensus = consensusProvider([
      fixed("a", [Number.NaN, 200]),
      fixed("b", [100, 200]),
    ]);
    await expect(consensus.elevationAt(AT)).resolves.toEqual([100, 200]);
  });

  it("combines attributions, deduplicated", () => {
    // Every source's attribution has to reach the UI; showing one of three is
    // an attribution bug that looks like a formatting choice.
    const consensus = consensusProvider([
      fixed("a", []),
      fixed("a", []),
      fixed("b", []),
    ]);
    expect(consensus.attribution).toBe("© a · © b");
  });

  it("refuses to be constructed with no providers", () => {
    expect(() => consensusProvider([])).toThrow(/at least one/);
  });
});
