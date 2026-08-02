/**
 * Deterministic timed spawn points on the heat map — the `GeoEvent` port
 * (§6, DEC-R6-14).
 *
 * WHAT THE C# DOES, from `GpsPlusSlamCs/Algorithms/GeoEvent.cs`. Seed a handful
 * of candidate positions inside a tile from `globalSeed + candidateNumber +
 * eventTimeInMinutes`, climb the heat map from each towards a local maximum,
 * gate on quality, and return the best pick per tile ordered by distance to the
 * user. Positions rotate every quarter hour and are identical for everyone who
 * shares the seed, so clients agree on where the event is without coordinating.
 *
 * WHAT THIS FILE IS AND IS NOT. It is the PURE half: the time arithmetic, the
 * seeded candidates and the hill-climb, each over injected inputs. It does not
 * know about H3, about the affordance index, or about how far the heat reaches.
 * That is deliberate — it makes every rule above testable in CI, and it means
 * the module does not have to wait for the wide-heat work to be finished before
 * it can be written and checked.
 *
 * THREE DELIBERATE DIVERGENCES FROM THE C#, each recorded because a later reader
 * comparing the two files will otherwise assume a mistake:
 *
 * - **Determinism is within TypeScript only** (DEC-R6-14e). The C# seeds
 *   `new Random((int)(globalSeed + nr + unixMinutes))`, which is .NET's
 *   subtractive generator — not reproducible in JS without porting a runtime's
 *   internals, and .NET has changed it between versions. Same seed and time give
 *   the same positions here, forever; they will NOT match the C#.
 * - **The heat lookup may answer "no data"**, and that is not the same as low
 *   heat. See {@link climbToLocalMaximum}.
 * - **The `heat > 9` quality gate is NOT ported.** Measured over the corpus, 9
 *   selects 30–45 % of all ground in our units, because the C# heat map summed
 *   counts where this one multiplies rule factors. See
 *   `score/corpus-score-distribution.test.ts`; the replacement belongs with the
 *   caller that has a local distribution to take a quantile of.
 *
 * @see geo-event.ts.md
 */

import { stableHash } from "../mesh/stable-jitter.js";
import type { LatLng } from "../model/osm-feature.js";

/** Milliseconds in a quarter of an hour — the event cadence. */
export const QUARTER_HOUR_MS = 15 * 60_000;

/** Milliseconds in a minute; the granularity the seed is quantised to. */
const MINUTE_MS = 60_000;

/** A tile's bounds, in degrees. */
export interface GeoBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/**
 * When the next event starts, as epoch milliseconds.
 *
 * Rounds UP to a quarter-hour boundary, and an exact boundary is already an
 * event time rather than being pushed to the next one — otherwise the event
 * would change the instant it started.
 *
 * `overlapMinutes` reproduces the C#'s handover: within that many minutes of a
 * boundary the answer is the quarter AFTER it, so a user arriving just before a
 * change is not sent to a spawn that is about to move.
 */
export function nextEventTime(
  now: number,
  { overlapMinutes = 5 }: { overlapMinutes?: number } = {},
): number {
  const shifted = now + overlapMinutes * MINUTE_MS;
  return Math.ceil(shifted / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

/**
 * Candidate positions inside a tile, seeded so every client agrees.
 *
 * THE SEED IS QUANTISED TO MINUTES, exactly as the C# is (it divides the
 * timestamp by 60 000 before seeding). Without that, a client whose clock is a
 * second out computes a different position — which is the same failure as having
 * no determinism at all, and much harder to notice.
 *
 * `stableHash` rather than a stateful PRNG, and the difference matters: there is
 * no sequence, so candidate `n` is a pure function of `(seed, time, n)` and
 * cannot shift because an earlier candidate was added or removed.
 */
export function eventCandidates({
  bbox,
  globalSeed,
  eventTime,
  count,
}: {
  bbox: GeoBounds;
  globalSeed: number;
  eventTime: number;
  count: number;
}): LatLng[] {
  const minutes = Math.floor(eventTime / MINUTE_MS);
  const points: LatLng[] = [];
  for (let n = 0; n < count; n += 1) {
    const key = `${globalSeed}:${minutes}:${n}`;
    // Two independent draws from one key, salted, so latitude and longitude do
    // not correlate — a single hash used for both would lay every candidate on
    // a diagonal.
    const u = stableHash(`${key}#lat`) / 0x1_0000_0000;
    const v = stableHash(`${key}#lng`) / 0x1_0000_0000;
    points.push({
      lat: bbox.south + (bbox.north - bbox.south) * u,
      lng: bbox.west + (bbox.east - bbox.west) * v,
    });
  }
  return points;
}

/** What a climb ended up with. */
export interface ClimbResult {
  /** Where it stopped. */
  readonly cell: string;
  /**
   * True when the climb ran out of SCORED ground rather than reaching a peak.
   *
   * The caller must treat this as "no answer", not as a weak one — see the
   * function's own docstring for why.
   */
  readonly left: boolean;
  /** The neighbourhood heat at `cell`, or 0 when `left`. */
  readonly heat: number;
}

/**
 * Climbs from `start` towards the warmest neighbourhood.
 *
 * NEIGHBOURHOOD HEAT, NOT CELL HEAT, which is `GetHeatForTilePlusNeighbours` in
 * the C# and is a real choice rather than a smoothing detail: it walks towards a
 * broad warm area rather than an isolated spike — the difference between "a good
 * district" and "one lucky hexagon".
 *
 * **"NO DATA" IS NOT "LOW HEAT", AND THIS IS THE TRAP THE PLAN NAMES**
 * (DEC-R6-14f). An unfetched cell scores as the identity, which is a perfectly
 * plausible low number, so a climb that treated a missing lookup as a cold cell
 * would settle on the rim of the scored disk every single time — placing every
 * event at the edge of whatever happened to be loaded, with nothing reporting
 * it. When any cell in the neighbourhood under consideration is unscored, the
 * climb stops and says so.
 *
 * BOUNDED BY `steps`, because this runs inside the worker and an ever-rising
 * field would otherwise walk until the process died.
 */
export function climbToLocalMaximum({
  start,
  heatAt,
  neighbours,
  steps,
}: {
  start: string;
  heatAt: (cell: string) => number | undefined;
  neighbours: (cell: string) => readonly string[];
  steps: number;
}): ClimbResult {
  /**
   * A cell's heat plus its neighbours', and whether the sum saw all of them.
   *
   * `undefined` means the CELL ITSELF is outside the scored field. `complete:
   * false` means the cell is scored but at least one neighbour is not — the sum
   * is still usable for comparison, it just cannot prove a peak.
   *
   * THE FIRST VERSION RETURNED EARLY ON ANY UNSCORED NEIGHBOUR, which sounds
   * like the cautious reading of DEC-R6-14f and is useless: the scored field is
   * finite, so a climb anywhere near its boundary would abandon immediately and
   * report nothing. The trap the decision names is settling ON the rim, not
   * touching it.
   */
  const neighbourhood = (
    cell: string,
  ): { heat: number; complete: boolean } | undefined => {
    const own = heatAt(cell);
    if (own === undefined) return undefined;
    let total = own;
    let complete = true;
    for (const around of neighbours(cell)) {
      if (around === cell) continue;
      const heat = heatAt(around);
      if (heat === undefined) {
        complete = false;
        continue;
      }
      total += heat;
    }
    return { heat: total, complete };
  };

  const startAt = neighbourhood(start);
  if (startAt === undefined) return { cell: start, left: true, heat: 0 };

  let current = start;
  // Explicitly typed rather than inferred from the narrowed `startAt`: the
  // reassignment at the end of the loop makes control-flow analysis widen it
  // back to `any`, which the lint rules then reject.
  let currentAt: { heat: number; complete: boolean } = startAt;

  for (let step = 0; step < steps; step += 1) {
    let bestCell = current;
    let best: { heat: number; complete: boolean } = currentAt;
    for (const candidate of neighbours(current)) {
      const at = neighbourhood(candidate);
      // Unscored candidates are SKIPPED rather than abandoning the climb: an
      // edge is a boundary of knowledge, not a wall.
      if (at === undefined) continue;
      if (at.heat > best.heat) {
        best = at;
        bestCell = candidate;
      }
    }
    if (bestCell === current) break;
    current = bestCell;
    currentAt = best;
  }

  // THE PEAK IS ONLY A PEAK IF IT COULD BE VERIFIED. Stopping at a cell whose
  // own neighbourhood reaches unscored ground means the climb may simply have
  // run out of map — which is precisely how every event ends up on the rim of
  // whatever was loaded, with nothing reporting it (DEC-R6-14f). The caller
  // must treat this as "no answer", not as a weaker one.
  return {
    cell: current,
    left: !currentAt.complete,
    heat: currentAt.complete ? currentAt.heat : 0,
  };
}
