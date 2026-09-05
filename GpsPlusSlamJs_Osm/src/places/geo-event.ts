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
 * - **The `heat > 9` quality gate IS ported, TRANSLATED rather than copied**
 *   (DEC-R9-3, round 9). An earlier version of this header said it was not
 *   ported, on the grounds that the C# "summed counts" where this package
 *   multiplies rule factors. THAT WAS WRONG: `HeatMapTile.Heat` starts at 1 as
 *   the multiplication identity and accumulates with `Heat *= elemHeat` — the
 *   same product over the same kind of rule table. So `> 9` is 9 cells at
 *   identity, i.e. structural rather than field-tuned, and the faithful form is
 *   `heat > neighbours(cell).length * threshold`. Derived from `neighbours()`
 *   rather than written down, which also keeps it correct at H3`s twelve
 *   pentagons.
 *   - It read `.length + 1` until 2026-08-05, which was an off-by-one:
 *     `gridDisk(cell, 1)` returns seven cells INCLUDING the centre and the sum
 *     is over exactly those seven, so the `+ 1` -- which assumed `neighbours()`
 *     excluded self -- made the gate ~14 %% stricter than this paragraph claims.
 *   - `threshold` is the rule table`s per-category `__threshold__`, i.e. the same
 *     constant the MAP uses to call ground usable, rather than a hardcoded
 *     identity. Both default to 1, so they used to agree by coincidence.
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
 * Rounds the instant UP to a quarter-hour boundary. An instant that IS a
 * boundary stays where it is rather than being pushed to the next one —
 * otherwise the event would change at the moment it started.
 *
 * `overlapMinutes` reproduces the C#'s handover: the instant is shifted forward
 * by that much BEFORE rounding, so a user arriving just before a change is not
 * sent to a spawn that is about to move.
 *
 * **THE IDEMPOTENCE ABOVE IS ABOUT THE SHIFTED INSTANT, NOT ABOUT `now`, and
 * the difference is user-visible.** Under the production default of five
 * minutes, asking at exactly 18:00 gives **18:15**, not 18:00: 18:00 → 18:05 →
 * round up → 18:15. Only `overlapMinutes: 0` makes a boundary map to itself,
 * which is what the test named "idempotent on an exact boundary" passes. An
 * earlier version of this paragraph claimed the idempotence unconditionally,
 * which reads as a promise the function does not keep — and it matters now that
 * a user can PICK a time (W6): a picker must pass `overlapMinutes: 0`, because
 * "show me 18:00" is a request for that slot, not a statement about arriving.
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

/**
 * Candidates the C# evaluates per batch, and how many batches it will try.
 *
 * `COUNT = 10`, `RETRY_COUNT = 10` — `GeoEvent.cs:60-61`, so up to 100
 * candidates, stopping at the first batch that yields a passing one. Kept
 * verbatim because they are the shape of the retry, not tuning: the batch is
 * what bounds one round of scoring work, and the retry count is how stubborn it
 * is before giving up on a tile.
 */
/**
 * EXPORTED, because the caller has to seed the SAME batch to prepare for it.
 *
 * The worker derives which cells the climb could reach by asking
 * `eventCandidates` for batch 0 and expanding each by the step count, then
 * scores exactly those. That only covers the batch this function actually
 * evaluates while the two counts agree — and until this was exported the demo
 * carried its own `GEO_EVENT_BATCH = 10` in another package, so a change to
 * either would have left the ensure set silently covering the wrong cells and
 * changed every result with nothing failing. One constant cannot drift from
 * itself.
 */
export const CANDIDATES_PER_BATCH = 10;
const MAX_BATCHES = 10;

/**
 * Hotter first, then the smaller cell id — a TOTAL order with no user in it.
 *
 * Returns 0 for the same cell rather than 1 for both orderings: an
 * inconsistent comparator hands the permutation to the engine, and the
 * engine's tie falls back on input order, which is the caller's tile order —
 * the user's tile first. The survivor's `cell`, `position` and `heat` would
 * be identical either way; `candidate` and `evaluated` would not (milestone
 * review, 2026-09-05).
 */
function byHeatThenCell(
  a: { heat: number; cell: string },
  b: { heat: number; cell: string },
): number {
  if (a.heat !== b.heat) return b.heat - a.heat;
  if (a.cell === b.cell) return 0;
  return a.cell < b.cell ? -1 : 1;
}

/** The chosen candidate, plus what it beat. */
export interface BestPick {
  /**
   * The raw seeded position, BEFORE the climb — the C#'s `RawStartEventPos`.
   *
   * **This is not where the event is.** It is the random starting point the
   * climb walked away from, kept only because drawing it next to `position`
   * shows what the climb did. Use `position` for anything user-facing.
   */
  readonly candidate: LatLng;
  /** Where the climb settled. */
  readonly cell: string;
  /**
   * WHERE THE EVENT IS — the centre of `cell`, which is the C#'s
   * `geohasher.ToLatLong(bestPick.ExactGeoHash)` (`GeoEvent.cs:87`).
   *
   * Reported rather than left for each caller to derive from `cell`, because
   * two callers deriving it separately is how they drift apart: the demo's map
   * marker and its button label are both built from this, and the map
   * originally drew `candidate` while quoting `cell`'s heat.
   */
  readonly position: LatLng;
  /** Neighbourhood heat at `cell`. */
  readonly heat: number;
  /**
   * The candidates of the DECIDING batch — the ones this pick beat.
   *
   * Exposed because the demo draws the deciding batch rather than all 100
   * candidates (DEC-R9-8) — the honest picture of what the algorithm did, and
   * ~11 markers instead of 400 on a map that had its cell layer defaulted off
   * for exactly that cost.
   *
   * THE BATCH ITSELF IS NOT REPORTED, and this docstring used to say it was:
   * it opened "the batch this was chosen from, in seeded order", describing a
   * `batch: number` field that has never existed on this type. Anyone reading
   * for it found this array instead. The batch index is recoverable from the
   * seed if it is ever wanted — `eventCandidates` with
   * `globalSeed + batch * CANDIDATES_PER_BATCH` reproduces any batch — but
   * nothing needs it today, and an unused field would be a second thing to keep
   * true.
   */
  readonly evaluated: readonly LatLng[];
}

/**
 * The best spawn position in one tile, or `undefined` if the tile has none.
 *
 * This is `CalcBestPickForGeoHashV2` — seeded candidates in batches, each
 * climbed to a local maximum, the first batch with a passing candidate winning.
 *
 * **THE QUALITY GATE IS THE C# CONSTANT, TRANSLATED — not a re-tuned one.**
 * `heat > 9` reads like a field-fitted number and is not. `HeatMapTile.Heat` is
 * documented _"Starts at 1 as the neutral multiplication identity element"_ and
 * accumulates with `Heat *= elemHeat` — the same product over the same rule
 * table this package scores with — so a 9-cell sum of exactly 9 is an entirely
 * baseline neighbourhood and `> 9` means "something is actually mapped here".
 *
 * H3 gives 7 cells rather than 9, so the identical rule is `> 7`. It is DERIVED
 * from `neighbours()` rather than written down, which also makes it correct at
 * H3's twelve pentagons, where a cell has five neighbours instead of six — a
 * hard-coded 7 would reject good ground there, rarely enough never to be noticed
 * and wrongly every time.
 *
 * **The gate is deliberately permissive**, as the C#'s is: F44 measured this
 * threshold selecting ~45 % of ground at Cologne. Rejecting unmapped and vetoed
 * ground is its whole job — finding the *good* spot is the climb's.
 *
 * **A climb that `left` the scored field is never a candidate.** `left` means
 * "no answer", not "a weak answer"; taking it would place the event on the rim
 * of whatever happened to be loaded, which is the failure DEC-R6-14f names.
 *
 * Pure, like everything else here: scoring, fetching and pinning are the
 * caller's, which is what keeps this testable with a plain object as the field.
 */
export function bestPickForTile({
  bbox,
  globalSeed,
  eventTime,
  toCell,
  toLatLng,
  heatAt,
  neighbours,
  steps,
  threshold = 1,
  batches = MAX_BATCHES,
}: {
  bbox: GeoBounds;
  globalSeed: number;
  eventTime: number;
  /** Position → the cell the climb starts from. */
  toCell: (position: LatLng) => string;
  /** Cell → its centre. The inverse of `toCell`, and where the event IS. */
  toLatLng: (cell: string) => LatLng;
  heatAt: (cell: string) => number | undefined;
  neighbours: (cell: string) => readonly string[];
  steps: number;
  /**
   * The per-cell bar a neighbourhood must clear on AVERAGE, from the rule
   * table's `__threshold__` for this category.
   *
   * Defaults to the multiplicative identity, which is `DEFAULT_THRESHOLD` and
   * what the shipped table falls back to -- so passing nothing reproduces
   * today's behaviour exactly.
   */
  threshold?: number;
  /** Batches to try before giving up on the tile. Defaults to the C#`s ten. */
  batches?: number;
}): BestPick | undefined {
  for (let batch = 0; batch < batches; batch += 1) {
    // The seed advances by whole batches, so batch N's candidates are the same
    // ten regardless of whether earlier batches were tried — which is what keeps
    // the result independent of how much scoring happened to be needed.
    const candidates = eventCandidates({
      bbox,
      globalSeed: globalSeed + batch * CANDIDATES_PER_BATCH,
      eventTime,
      count: CANDIDATES_PER_BATCH,
    });

    let best: BestPick | undefined;
    for (const candidate of candidates) {
      const start = toCell(candidate);
      const climbed = climbToLocalMaximum({
        start,
        heatAt,
        neighbours,
        steps,
      });
      if (climbed.left) continue;

      // DERIVED, not a literal. This is the C#'s `> 9` with its 9 replaced by
      // however many cells the neighbourhood actually has, times the threshold
      // the MAP uses to call ground usable.
      //
      // NO `+ 1`. It was there until 2026-08-05 and was an off-by-one:
      // `gridDisk(cell, 1)` returns SEVEN cells INCLUDING the centre, and
      // `climbToLocalMaximum` sums exactly those seven, so the baseline is 7 and
      // not 8. The `+ 1` assumed `neighbours()` excluded self, which made the
      // gate ~14 %% stricter than the docstring above says it is.
      //
      // THE THRESHOLD COMES FROM THE CALLER rather than being the hardcoded
      // identity. The rule table can declare a per-category `__threshold__`, and
      // that is what decides whether a cell is drawn as usable ground -- so an
      // event should not be placed where the map itself says it is unusable.
      // The shipped table declares none, so both are 1 today and the two agreed
      // by COINCIDENCE rather than by construction.
      const baseline = neighbours(climbed.cell).length * threshold;
      if (!(climbed.heat > baseline)) continue;

      if (best === undefined || climbed.heat > best.heat) {
        best = {
          candidate,
          cell: climbed.cell,
          position: toLatLng(climbed.cell),
          heat: climbed.heat,
          evaluated: candidates,
        };
      }
    }

    // FIRST PASSING BATCH WINS, as the C# does — not a global argmax over all
    // 100. A later batch is only reached because every earlier one failed the
    // gate, so "best overall" would mean scoring ten times the ground to improve
    // on a choice that already cleared the bar.
    if (best !== undefined) return best;
  }
  return undefined;
}

/** One tile the event may land in. */
export interface EventTile {
  readonly bbox: GeoBounds;
}

export interface GeoEvent {
  /** When it starts, epoch ms. */
  readonly eventTime: number;
  /**
   * One pick per tile that had a valid position, NEAREST TO THE USER FIRST —
   * minus any pick the caller's `sameSpot` merged into another (two tiles
   * that climbed onto one plateau from two sides report it once).
   */
  readonly picks: readonly BestPick[];
  /**
   * How many tiles were SEARCHED, which is not how many yielded a pick (F57).
   *
   * DEC-R9-15 means the tile set is your own plus any neighbour whose ground is
   * already downloaded, so two people standing together can legitimately see a
   * different NUMBER of events. Each individual event is identical for both --
   * the divergence is coverage, never disagreement -- but without this the UI
   * cannot say which it is, and a missing event reads as "broken" rather than as
   * "not loaded yet". (One bounded exception since the `sameSpot` merge: a
   * device that searched only one of two tiles sharing a plateau can show the
   * other cell of that plateau — within the caller's separation, the same
   * place.)
   *
   * `picks.length` cannot stand in: a tile that is all water is searched and
   * yields nothing, which is a different fact from not having looked — and
   * two tiles may have reported one spot.
   */
  readonly tilesSearched: number;
}

/**
 * The event for a moment and a place — one pick per tile, nearest first.
 *
 * `bestPickForTile` answers "where in THIS tile"; this asks it of each tile the
 * caller offers and orders the answers by distance to the user, which is the
 * C#'s `OrderBy(distance)`. Without the ordering the app would show an arbitrary
 * one of them, which reads as the event jumping about.
 *
 * **WHICH TILES IS THE CALLER'S CHOICE, deliberately.** The C# always takes the
 * centre tile plus its three nearest neighbours, which under DEC-R9-4's
 * fetch-on-demand could mean four Overpass fetches — minutes of waiting for one
 * event. Taking the tile list as an argument lets the worker start with the
 * centre alone, whose data is by definition already loaded because the user is
 * standing in it, and widen later without changing this function.
 *
 * **A TILE WITH NO VALID POSITION IS SKIPPED, NOT FATAL.** The C# throws when
 * the centre tile yields nothing (`GeoEvent.cs:83`) and logs a warning plus a
 * `Debugger.Break()` for a neighbour. Neither survives the port: a tile that is
 * all water genuinely has no event, and an exception would take the other tiles
 * down with it. DEC-R6-14f already reversed the equivalent assertion.
 */
export function newGeoEventFor({
  user,
  tiles,
  globalSeed,
  eventTime,
  toCell,
  toLatLng,
  heatAt,
  neighbours,
  steps,
  threshold,
  cellsOfTile,
  sameSpot,
}: {
  user: LatLng;
  tiles: readonly EventTile[];
  globalSeed: number;
  eventTime: number;
  toCell: (position: LatLng) => string;
  toLatLng: (cell: string) => LatLng;
  heatAt: (cell: string) => number | undefined;
  neighbours: (cell: string) => readonly string[];
  steps: number;
  /** The category threshold the MAP uses. See `bestPickForTile`. */
  threshold?: number;
  /**
   * Supply this to SCAN each tile instead of climbing within it.
   *
   * Present means exhaustive: every cell whose heat is known is ranked and the
   * time seed picks among the best separated peaks ({@link bestPickOverField}).
   * Absent means the original seeded-candidates hill climb.
   *
   * **Both paths are live on purpose.** The scan is measured at 364 ms over one
   * tile, which is a LOWER bound — no fixture holds a full tile — so the climb
   * stays reachable by not passing this, and its tests keep running, rather than
   * becoming a fallback nobody exercises.
   */
  cellsOfTile?: (tile: EventTile) => Iterable<string>;
  /**
   * Supply this to report a spot ONCE when two tiles both settle on it.
   *
   * Candidates are seeded in each tile's bounding box, which overlaps the
   * neighbours, and the climb stops on flat ground wherever it entered — so
   * two tiles can climb onto one plateau from two sides and report adjacent
   * cells with the same heat (the owner's second marker "a few metres from
   * the first", 2026-09-04). Picks the predicate relates are merged: the
   * higher heat survives, an exact tie the smaller cell id. Nothing about the
   * user enters the rule, so the surviving cell is the same on every device
   * that searched both tiles. Injected, like `neighbours`, because this half
   * does not know about H3; the caller decides what "the same spot" means.
   *
   * Absent means no merging — every tile's pick is reported, as before.
   */
  sameSpot?: (a: string, b: string) => boolean;
}): GeoEvent {
  const picks: BestPick[] = [];
  for (const tile of tiles) {
    const pick =
      cellsOfTile === undefined
        ? bestPickForTile({
            bbox: tile.bbox,
            globalSeed,
            eventTime,
            toCell,
            toLatLng,
            heatAt,
            neighbours,
            steps,
            ...(threshold === undefined ? {} : { threshold }),
          })
        : bestPickOverField({
            cells: cellsOfTile(tile),
            globalSeed,
            eventTime,
            toLatLng,
            heatAt,
            neighbours,
            ...(threshold === undefined ? {} : { threshold }),
          });
    if (pick !== undefined) picks.push(pick);
  }

  // ONE PICK PER SPOT, by a rule with no user in it. Ranked by heat, then by
  // cell id for an exact tie, and kept only when no already-kept pick is the
  // same spot — so the survivor of a merged pair is decided by the picks
  // alone, never by where the user stood (a nearest-wins tie-break would have
  // moved the marker with a ten-metre walk, which is the report this answers).
  // Coverage still decides WHICH tiles were searched: a device that has not
  // loaded the neighbour sees that tile's pick alone, and may therefore show
  // the other cell of a shared plateau — a disagreement bounded by the
  // caller's separation, about a spot that is the same place. See `GeoEvent`.
  const kept: BestPick[] = [];
  if (sameSpot === undefined) {
    kept.push(...picks);
  } else {
    const ranked = [...picks].sort(byHeatThenCell);
    for (const pick of ranked) {
      if (!kept.some((winner) => sameSpot(winner.cell, pick.cell))) {
        kept.push(pick);
      }
    }
  }

  // PLANAR, not great-circle. These are candidates inside adjacent tiles a
  // kilometre or so apart, so the only thing the distance decides is their
  // ORDER — and any monotonic function of true distance gives the same order at
  // this scale. Squared degrees also avoids a sqrt per comparison.
  const distanceTo = (position: LatLng): number => {
    const dLat = position.lat - user.lat;
    // Longitude degrees shrink with latitude; ignoring that would mis-order
    // tiles east-west against north-south at high latitudes.
    const dLng =
      (position.lng - user.lng) * Math.cos((user.lat * Math.PI) / 180);
    return dLat * dLat + dLng * dLng;
  };

  // BY THE SETTLED POSITION, not the seed. The C# orders by
  // `ToLatLong(x.ExactGeoHash)` (`GeoEvent.cs:107`) — where the climb ended.
  // Ordering by `candidate` ranks tiles by a point the event is not at, so a
  // caller's "nearest event" would quote a distance to nothing.
  kept.sort((a, b) => distanceTo(a.position) - distanceTo(b.position));
  return { eventTime, picks: kept, tilesSearched: tiles.length };
}

/** One peak found by an exhaustive scan, with the heat that ranked it. */
export interface RankedPeak {
  readonly cell: string;
  /** Neighbourhood heat — the cell plus its neighbours, as the climb uses. */
  readonly heat: number;
}

/**
 * The best SEPARATED places in a field, ranked — an exhaustive alternative to
 * climbing (DEC-A5).
 *
 * WHY THIS EXISTS. `climbToLocalMaximum` samples: it drops candidates at random
 * and walks each a little way uphill, so it finds a peak only when a candidate
 * lands on one. Measured over a field with a single obvious maximum, the event
 * landed on it **0 times out of 24**. Two attempts to widen the sampling were
 * refuted on one invariant — *anything that searches more of the tile must score
 * more of the tile* — and the arithmetic then pointed somewhere unexpected: a
 * res-8 event tile holds only **343 res-11 chunks**, which is FEWER than a climb
 * with useful reach needs. Once they are all scored there is nothing left to
 * search for; the answer can simply be read off.
 *
 * **SEPARATION IS THE WHOLE DIFFICULTY, not the ranking.** The top cells of any
 * real field are neighbours of each other — one hill yields its summit and the
 * six cells around it — so a naive "top N" returns one place N times. Each pick
 * therefore excludes its own neighbourhood from those that follow.
 *
 * **WHY N AND NOT JUST THE MAXIMUM**, which is the non-obvious half. Event
 * positions **rotate every quarter hour** and must stay identical across clients
 * that share a seed. Returning the single global maximum would make the event
 * *static forever* — a regression against a documented behaviour, dressed as a
 * fix. So this returns a ranked shortlist and the caller's existing time seed
 * chooses within it: the best ground is always in the running, and which of the
 * good places wins still rotates.
 *
 * `heatAt` returning `undefined` means unscored, and an unscored cell is skipped
 * rather than treated as cold — the distinction `cellState` exists to preserve.
 */
export function rankedPeaks({
  cells,
  heatAt,
  neighbours,
  topN,
}: {
  cells: Iterable<string>;
  heatAt: (cell: string) => number | undefined;
  neighbours: (cell: string) => readonly string[];
  topN: number;
}): RankedPeak[] {
  const scored: RankedPeak[] = [];
  for (const cell of cells) {
    const own = heatAt(cell);
    if (own === undefined) continue;
    let heat = own;
    for (const around of neighbours(cell)) {
      if (around === cell) continue;
      heat += heatAt(around) ?? 0;
    }
    scored.push({ cell, heat });
  }

  // Ties broken by cell id so the order is total and reproducible. Two chunks of
  // identical heat are common in sparse ground, and a result that depended on
  // Map iteration order would differ between clients that must agree.
  scored.sort(byHeatThenCell);

  const picked: RankedPeak[] = [];
  const excluded = new Set<string>();
  for (const peak of scored) {
    if (picked.length >= topN) break;
    if (excluded.has(peak.cell)) continue;
    picked.push(peak);
    excluded.add(peak.cell);
    for (const around of neighbours(peak.cell)) excluded.add(around);
  }
  return picked;
}

/**
 * How many separated peaks the exhaustive search shortlists per tile.
 *
 * **NOT ONE, and that is the point.** Event positions rotate every quarter hour
 * and must be identical across clients sharing a seed, so returning the single
 * global maximum would make the event *static forever* — a regression dressed as
 * a fix. Six keeps the best ground always in the running while leaving something
 * for the time seed to choose between.
 */
export const EXHAUSTIVE_SHORTLIST = 6;

/**
 * The best pick for one tile by SCANNING it, rather than by climbing to it.
 *
 * The exhaustive counterpart to {@link bestPickForTile}. Given every cell of the
 * tile whose heat is known, it ranks separated peaks and lets the time seed pick
 * among the top {@link EXHAUSTIVE_SHORTLIST}.
 *
 * **Why scanning is affordable, which is the non-obvious part.** A res-8 event
 * tile holds only **343 res-11 chunks** to SCORE — fewer than a hill climb with
 * useful reach needs (a 5-step res-11 climb needs ~684 against a 488-chunk cache
 * cap). Once they are scored there is nothing left to search for.
 *
 * **TWO COSTS, AND AN EARLIER VERSION OF THIS COMMENT CONFLATED THEM.** 343 is
 * what must be SCORED. The scan itself is handed every res-13 cell of the tile —
 * **16 807** — each costing a `gridDisk` plus seven `heatAt` calls. So the
 * affordability argument covers the scoring and says nothing about the ranking,
 * whose cost has not been measured.
 *
 * **The same quality gate as the climb**, `heat > neighbours(cell).length ×
 * threshold`, so an event is still never placed where the map itself says the
 * ground is unusable. Shared deliberately: two gates that drifted would put
 * events somewhere the heat map draws as empty.
 *
 * `candidate` is the chosen position rather than a pre-climb seed, because
 * nothing was climbed. Reported anyway so `BestPick`'s shape is unchanged for
 * the map, which draws `candidate` beside `position` to show what the search did.
 */
export function bestPickOverField({
  cells,
  globalSeed,
  eventTime,
  toLatLng,
  heatAt,
  neighbours,
  threshold = 1,
}: {
  cells: Iterable<string>;
  globalSeed: number;
  eventTime: number;
  toLatLng: (cell: string) => LatLng;
  heatAt: (cell: string) => number | undefined;
  neighbours: (cell: string) => readonly string[];
  threshold?: number;
}): BestPick | undefined {
  const peaks = rankedPeaks({
    cells,
    heatAt,
    neighbours,
    topN: EXHAUSTIVE_SHORTLIST,
  }).filter((peak) => peak.heat > neighbours(peak.cell).length * threshold);

  if (peaks.length === 0) return undefined;

  // THE SAME QUANTISATION THE SEEDED CANDIDATES USE — whole minutes — so two
  // clients whose clocks differ by seconds still agree. Indexing a ranked list
  // rather than generating a position keeps the choice inside the shortlist,
  // which is what makes the best ground always a live option.
  const minute = Math.floor(eventTime / MINUTE_MS);
  const roll = stableHash(`geo-event-pick:${globalSeed}:${minute}`);

  // WEIGHTED BY HEAT, NOT UNIFORM, and the difference is the whole feature.
  //
  // A uniform roll over the shortlist throws the ranking away: the best ground
  // would win exactly 1 time in `EXHAUSTIVE_SHORTLIST`, which over a field with
  // one real peak and five bumps is 1 in 6 — barely better than the sampling
  // this replaced, after paying to scan the whole tile. Weighting by heat keeps
  // every shortlisted place reachable (so the event still rotates) while making
  // the best one much the likeliest.
  //
  // Arithmetic on the test fixture: a peak at 560 against five bumps at 84 wins
  // 560/980 = 57 % of quarter hours rather than 17 %.
  const total = peaks.reduce((sum, peak) => sum + peak.heat, 0);
  let ticket = total > 0 ? roll % Math.ceil(total) : 0;
  let chosen = peaks[0] as RankedPeak;
  for (const peak of peaks) {
    if (ticket < peak.heat) {
      chosen = peak;
      break;
    }
    ticket -= peak.heat;
  }

  return {
    candidate: toLatLng(chosen.cell),
    cell: chosen.cell,
    position: toLatLng(chosen.cell),
    heat: chosen.heat,
    // What it beat, which is what the map draws. The runners-up are genuinely
    // the alternatives here, rather than the discarded random seeds the climb
    // reported — a more honest picture of what the search considered.
    evaluated: peaks.map((peak) => toLatLng(peak.cell)),
  };
}
