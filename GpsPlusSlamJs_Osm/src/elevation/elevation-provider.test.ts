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
  fallbackProvider,
  median,
} from "./elevation-provider.js";
import type { ElevationProvider } from "./elevation-provider.js";
import type { LatLng } from "../model/osm-feature.js";

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

describe("fallbackProvider", () => {
  /**
   * WHY THESE TESTS MATTER. The whole point of primary-with-fallback over
   * consensus is that the better source's answers survive UNTOUCHED and the
   * worse source is consulted only where the better one has nothing. Both
   * halves are silent failure modes: querying the fallback for answered
   * positions wastes quota invisibly, and letting a fallback failure destroy
   * primary answers turns "the backup is down" into "no elevation anywhere".
   */
  function recording(
    sourceId: string,
    answer: (p: LatLng) => number | undefined,
  ): { calls: (readonly LatLng[])[]; provider: ElevationProvider } {
    const calls: (readonly LatLng[])[] = [];
    return {
      calls,
      provider: {
        attribution: `© ${sourceId}`,
        sourceId,
        elevationAt: (positions) => {
          calls.push(positions);
          return Promise.resolve(positions.map(answer));
        },
      },
    };
  }

  const POSITIONS = [
    { lat: 1, lng: 0 },
    { lat: 2, lng: 0 },
    { lat: 3, lng: 0 },
    { lat: 4, lng: 0 },
  ];

  it("never consults the fallback when the primary answers everything", async () => {
    const primary = recording("hi-res", (p) => p.lat * 10);
    const backup = recording("lo-res", () => 0);

    const out = await fallbackProvider(
      primary.provider,
      backup.provider,
    ).elevationAt(POSITIONS);

    expect(out).toEqual([10, 20, 30, 40]);
    expect(backup.calls).toEqual([]);
  });

  it("sends the whole batch to the fallback when the primary knows nothing", async () => {
    const primary = recording("hi-res", () => undefined);
    const backup = recording("lo-res", (p) => p.lat * 100);

    const out = await fallbackProvider(
      primary.provider,
      backup.provider,
    ).elevationAt(POSITIONS);

    expect(out).toEqual([100, 200, 300, 400]);
    expect(backup.calls).toEqual([POSITIONS]);
  });

  it("retries ONLY the gaps, in one batched call, merged back in order", async () => {
    // Positions 2 and 4 are outside the primary's coverage. The fallback must
    // see exactly those two — an answered position reaching the fallback is
    // wasted quota, and quota is why the fallback is the fallback.
    const primary = recording("hi-res", (p) =>
      p.lat % 2 === 1 ? p.lat * 10 : undefined,
    );
    const backup = recording("lo-res", (p) => p.lat * 100);

    const out = await fallbackProvider(
      primary.provider,
      backup.provider,
    ).elevationAt(POSITIONS);

    expect(out).toEqual([10, 200, 30, 400]);
    expect(backup.calls).toEqual([
      [
        { lat: 2, lng: 0 },
        { lat: 4, lng: 0 },
      ],
    ]);
  });

  it("keeps the primary's answers when the fallback fails", async () => {
    // The interface contract says providers do not throw for missing data,
    // but a misbehaving fallback must still not take the primary with it.
    const primary = recording("hi-res", (p) =>
      p.lat <= 2 ? p.lat * 10 : undefined,
    );
    const failing: ElevationProvider = {
      attribution: "© lo-res",
      sourceId: "lo-res",
      elevationAt: () => Promise.reject(new Error("down")),
    };

    const out = await fallbackProvider(primary.provider, failing).elevationAt(
      POSITIONS,
    );
    expect(out).toEqual([10, 20, undefined, undefined]);
  });

  it("propagates an abort from either stage instead of degrading", async () => {
    const abort = () =>
      Promise.reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      );
    const aborting: ElevationProvider = {
      attribution: "",
      sourceId: "aborting",
      elevationAt: abort,
    };
    const empty = recording("empty", () => undefined);

    // Primary aborts: nothing to salvage, the caller has left.
    await expect(
      fallbackProvider(aborting, empty.provider).elevationAt(POSITIONS),
    ).rejects.toThrow("aborted");
    // Fallback aborts during the retry: same — an abort is a cancellation,
    // not a data problem, so it must not be smoothed into undefined.
    await expect(
      fallbackProvider(empty.provider, aborting).elevationAt(POSITIONS),
    ).rejects.toThrow("aborted");
  });

  it("passes the signal through to both stages", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const observing = (
      sourceId: string,
      value: number | undefined,
    ): ElevationProvider => ({
      attribution: "",
      sourceId,
      elevationAt: (positions, signal) => {
        seen.push(signal);
        return Promise.resolve(positions.map(() => value));
      },
    });

    await fallbackProvider(
      observing("a", undefined),
      observing("b", 1),
    ).elevationAt(POSITIONS, controller.signal);
    expect(seen).toEqual([controller.signal, controller.signal]);
  });

  it("names both sources and shows both attributions", () => {
    const combined = fallbackProvider(
      recording("hi-res", () => 1).provider,
      recording("lo-res", () => 2).provider,
    );
    expect(combined.sourceId).toBe("hi-res+lo-res");
    expect(combined.attribution).toBe("© hi-res · © lo-res");
  });
});

describe("an aborted consensus batch rejects rather than degrading", () => {
  /**
   * WHY THIS MATTERS. `TerrariumProvider.load` goes out of its way to re-throw
   * an abort — "a caller that left the area is not asking for a degraded
   * answer, it is asking for no answer". `Promise.allSettled` then undoes that:
   * it treats the rejection as just another unfulfilled provider, so the batch
   * resolves to `undefined` everywhere and the caller cannot tell "aborted"
   * from "no DEM coverage anywhere in this batch".
   *
   * Those are very different facts. The second is worth caching and showing;
   * the first means the work should simply stop.
   */
  it("throws AbortError instead of returning undefined everywhere", async () => {
    const controller = new AbortController();
    const aborting: ElevationProvider = {
      attribution: "",
      sourceId: "aborting",
      elevationAt: () =>
        Promise.reject(
          Object.assign(new Error("aborted"), { name: "AbortError" }),
        ),
    };
    controller.abort();

    const consensus = consensusProvider([aborting]);
    await expect(
      consensus.elevationAt(AT, controller.signal),
    ).rejects.toThrow();
  });

  it("still degrades when a provider fails for a NON-abort reason", async () => {
    // The distinction is the point: a provider being down must not stop the
    // others, only an abort must.
    const consensus = consensusProvider([fixed("a", [100, 200]), broken("b")]);
    await expect(consensus.elevationAt(AT)).resolves.toEqual([100, 200]);
  });
});
