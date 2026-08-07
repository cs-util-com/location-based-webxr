/**
 * The elevation seam.
 *
 * WHY A SEAM RATHER THAN A FUNCTION. The plan's §7 recommends Terrarium raster
 * tiles and that recommendation is the least externally-validated part of the
 * whole plan — it is explicitly gated on a DEM survey that has not landed. So
 * the one thing that must be right today is the shape of the boundary, because
 * everything downstream (region elevation, the AR bridge) is written against it
 * and the provider behind it is expected to change.
 *
 * THE CONTRACT, and each clause is load-bearing:
 *
 * - **Batch in, batch out.** `elevationAt` takes many positions and returns one
 *   answer per position, in order. A per-point API would make the raster
 *   provider's whole advantage inexpressible and would invite the C# reference's
 *   original mistake of five point queries per tile.
 * - **`undefined` means "no data here", never `0`.** Zero is a real elevation
 *   (most of the Netherlands is near it) and a provider that returns it on
 *   failure produces a plausible wrong answer. The C# reference's own
 *   `NoElevationLookup` returns `1` rather than `0` for exactly this reason —
 *   it had an assertion that rejected zero, which is a workaround for a type
 *   that could not say "I don't know".
 * - **Orthometric metres, above the geoid.** DEMs are orthometric; GNSS and the
 *   AR session are ellipsoidal. The conversion is `geoid.ts`'s job and is NOT
 *   applied here, so a caller always knows which datum it holds. Getting this
 *   wrong produces a consistent tens-of-metres vertical offset that is easy to
 *   mistake for a fusion bug.
 * - **A provider never throws for missing data.** Network and decode failures
 *   degrade to `undefined` per point; only programmer errors throw.
 *
 * @see elevation-provider.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";

export interface ElevationProvider {
  /** Attribution the consuming app MUST display. */
  readonly attribution: string;
  /** Identifies the provider in provenance and logs. */
  readonly sourceId: string;
  /**
   * Orthometric height in metres per position, `undefined` where unknown.
   *
   * The returned array always has the same length and order as `positions`.
   */
  elevationAt(
    positions: readonly LatLng[],
    signal?: AbortSignal,
  ): Promise<readonly (number | undefined)[]>;
}

/**
 * Returns `undefined` everywhere.
 *
 * The right default for tests and for apps that do not need elevation. It is
 * deliberately not "returns 0": an app that has not configured elevation should
 * see an absence it can branch on, not a sea-level claim it will render.
 */
export class NullElevationProvider implements ElevationProvider {
  readonly attribution = "";
  readonly sourceId = "null";

  elevationAt(
    positions: readonly LatLng[],
  ): Promise<readonly (number | undefined)[]> {
    return Promise.resolve(positions.map(() => undefined));
  }
}

/**
 * Queries several providers and takes the MEDIAN of the answers per position.
 *
 * Ported from the C# reference's elevation lookup, which appends every sample
 * from every provider to a per-cell list and reads back the median
 * (`ElevationLookup.GetElevationFromFileCacheFor`). It is the one part of that
 * design worth keeping wholesale: a single DEM source serving wrong data for a
 * region is undetectable, and two disagreeing sources are a signal you cannot
 * get any other way.
 *
 * Median rather than mean because DEM disagreement is not Gaussian — one source
 * being wrong about a region is a large systematic offset, exactly the case a
 * mean is worst at and a median shrugs off.
 *
 * Providers are queried in parallel; one that rejects contributes nothing
 * rather than failing the batch, because "the fallback is down" must not take
 * the primary with it.
 */
export function consensusProvider(
  providers: readonly ElevationProvider[],
  options: { readonly sourceId?: string } = {},
): ElevationProvider {
  if (providers.length === 0) {
    throw new Error("consensusProvider needs at least one provider");
  }

  return {
    attribution: [...new Set(providers.map((p) => p.attribution))]
      .filter((a) => a !== "")
      .join(" · "),
    sourceId:
      options.sourceId ??
      `consensus(${providers.map((p) => p.sourceId).join(",")})`,

    async elevationAt(positions, signal) {
      const settled = await Promise.allSettled(
        providers.map((provider) => provider.elevationAt(positions, signal)),
      );

      // `allSettled` swallows an abort like any other rejection, which would
      // undo the care `TerrariumProvider` takes to re-throw one: the batch would
      // resolve to `undefined` everywhere and the caller could not tell
      // "aborted" from "no DEM coverage anywhere in this batch". Those are very
      // different facts — the second is worth showing, the first means the work
      // should simply stop. Re-raising keeps the seam consistent with its
      // implementations.
      signal?.throwIfAborted();

      const answers = settled
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);

      return positions.map((_, i) => {
        const samples = answers
          .map((a) => a[i])
          .filter((v): v is number => v !== undefined && Number.isFinite(v));
        return median(samples);
      });
    },
  };
}

/** Median of a sample list, `undefined` when empty. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (low === undefined || high === undefined) return undefined;
  return (low + high) / 2;
}
