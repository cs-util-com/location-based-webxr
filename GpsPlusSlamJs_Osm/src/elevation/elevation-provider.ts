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

/**
 * The primary answers; the fallback fills only the gaps.
 *
 * WHY THIS BEATS {@link consensusProvider} FOR TWO SOURCES OF VERY DIFFERENT
 * QUALITY. A median of two samples degenerates to their average, so wherever
 * both sources answer, a high-resolution primary (say, national LiDAR) is
 * blended with a coarse global fallback and its resolution advantage is simply
 * thrown away — the worst of both, delivered smoothly. Consensus is the right
 * tool when the sources are peers and disagreement is the signal; when one
 * source is strictly better wherever it has data, the right composition is
 * explicit precedence: the primary's answers survive untouched, the fallback
 * is consulted ONLY for positions the primary returned `undefined`, and every
 * seam in the output is attributable to a known coverage boundary rather than
 * to an anonymous blend.
 *
 * The retry is batched — one fallback call carrying just the missing
 * positions, results merged back at their original indices — so the fallback's
 * quota is spent only on true gaps. A fallback failure degrades those gaps to
 * `undefined` and never destroys the primary's answers; an abort from either
 * stage propagates, per the seam's contract.
 */
export function fallbackProvider(
  primary: ElevationProvider,
  fallback: ElevationProvider,
  options: { readonly sourceId?: string } = {},
): ElevationProvider {
  return {
    attribution: [primary.attribution, fallback.attribution]
      .filter((a) => a !== "")
      .join(" · "),
    sourceId: options.sourceId ?? `${primary.sourceId}+${fallback.sourceId}`,

    async elevationAt(positions, signal) {
      const first = await primary.elevationAt(positions, signal);

      // Indices the primary left unanswered, with their positions kept
      // alongside so the fallback batch and the merge use the same pairing.
      const gapIndices: number[] = [];
      const gapPositions: LatLng[] = [];
      positions.forEach((position, i) => {
        if (first[i] === undefined) {
          gapIndices.push(i);
          gapPositions.push(position);
        }
      });
      // Copying via `positions` (not `first`) keeps the output's length pinned
      // to the input even if a misbehaving primary returned a short array.
      const merged = positions.map((_, i) => first[i]);
      if (gapIndices.length === 0) return merged;

      let filled: readonly (number | undefined)[];
      try {
        filled = await fallback.elevationAt(gapPositions, signal);
      } catch (error) {
        // The contract says providers do not throw for missing data, but a
        // misbehaving fallback must not destroy the primary's answers. An
        // abort is different: it is a cancellation, not a data problem.
        if (error instanceof Error && error.name === "AbortError") throw error;
        signal?.throwIfAborted();
        return merged;
      }
      gapIndices.forEach((positionIndex, j) => {
        merged[positionIndex] = filled[j];
      });
      return merged;
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
