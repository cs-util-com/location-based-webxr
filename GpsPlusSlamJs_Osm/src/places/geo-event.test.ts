/**
 * The `GeoEvent` port — deterministic timed spawn points on the heat map
 * (§6, DEC-R6-14).
 *
 * WHAT IS BEING PORTED. `GpsPlusSlamCs/Algorithms/GeoEvent.cs` decides where an
 * event happens: seed candidate positions inside a tile from
 * `globalSeed + candidateNumber + eventTimeInMinutes`, climb the heat map from
 * each towards a local maximum, gate on quality, and return the best pick.
 *
 * WHY THESE TESTS MATTER, and it is mostly not about the arithmetic.
 *
 * **Determinism is the whole feature.** The seeding exists so every client
 * agrees where the event is without coordinating. A value that varied per call
 * would put two players in different places while both believed they were right
 * — the worst kind of failure, because nothing looks broken.
 *
 * **The hill-climb walking off the edge of scored ground is the trap the plan
 * names** (DEC-R6-14f), and it fails SILENTLY: an unfetched cell scores as the
 * identity, a perfectly plausible low number, so a climb that treated "no data"
 * as "low heat" would settle on the rim of the scored disk every time and
 * nothing would report it.
 *
 * **The quarter-hour boundary has four branches**, and an off-by-one in any of
 * them shifts every event by fifteen minutes.
 */

import { describe, expect, it } from "vitest";

import {
  rankedPeaks,
  bestPickOverField,
  EXHAUSTIVE_SHORTLIST,
  CANDIDATES_PER_BATCH,
  QUARTER_HOUR_MS,
  bestPickForTile,
  climbToLocalMaximum,
  newGeoEventFor,
  eventCandidates,
  nextEventTime,
} from "./geo-event.js";

/** A heat field over a small integer grid; everything else is unscored. */
function fieldFrom(
  values: Record<string, number>,
): (cell: string) => number | undefined {
  return (cell) => values[cell];
}

/** The inverse of the grid `toCell`s below, so a cell has a position. */
function gridToLatLng(cell: string): { lat: number; lng: number } {
  const parts = cell.split(",").map(Number);
  return { lat: (parts[1] ?? 0) * 0.001, lng: (parts[0] ?? 0) * 0.001 };
}

/** Neighbours on an integer grid, so the climb is testable without h3. */
function gridNeighbours(cell: string): string[] {
  const parts = cell.split(",").map(Number);
  const x = parts[0] ?? 0;
  const y = parts[1] ?? 0;
  const out: string[] = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      out.push(`${x + dx},${y + dy}`);
    }
  }
  return out;
}

describe("nextEventTime", () => {
  it("rounds up to the next quarter hour", () => {
    const at = Date.UTC(2026, 7, 2, 10, 3);
    expect(nextEventTime(at, { overlapMinutes: 0 })).toBe(
      Date.UTC(2026, 7, 2, 10, 15),
    );
  });

  it("crosses the hour correctly", () => {
    // THE BRANCH MOST LIKELY TO BE WRONG. The C# writes this as a switch on
    // `inputTime.Minutes` with an `hours + 1` in one arm, which is exactly
    // where an off-by-one lives.
    const at = Date.UTC(2026, 7, 2, 10, 52);
    expect(nextEventTime(at, { overlapMinutes: 0 })).toBe(
      Date.UTC(2026, 7, 2, 11, 0),
    );
  });

  it("crosses midnight correctly", () => {
    const at = Date.UTC(2026, 7, 2, 23, 58);
    expect(nextEventTime(at, { overlapMinutes: 0 })).toBe(
      Date.UTC(2026, 7, 3, 0, 0),
    );
  });

  it("jumps a whole quarter early inside the overlap window", () => {
    // The C# `overlapMinutes` behaviour: within five minutes of a boundary the
    // NEXT event is already the one after it, so a user arriving just before a
    // change is not sent to a spawn that is about to move.
    const at = Date.UTC(2026, 7, 2, 10, 12);
    expect(nextEventTime(at, { overlapMinutes: 5 })).toBe(
      Date.UTC(2026, 7, 2, 10, 30),
    );
  });

  it("is idempotent on an exact boundary", () => {
    // Exactly 10:15 with no overlap must not advance to 10:30, or the event
    // would change the instant it started.
    const at = Date.UTC(2026, 7, 2, 10, 15);
    expect(nextEventTime(at, { overlapMinutes: 0 })).toBe(at);
  });

  it("is NOT idempotent on a boundary under the PRODUCTION default", () => {
    // WHY THIS TEST MATTERS. The test above passes `overlapMinutes: 0`, and the
    // docstring used to claim the idempotence unconditionally — so the pair
    // read as "an exact boundary is already an event time", full stop. It is
    // not: the default is five minutes, and the shift happens BEFORE the
    // rounding, so 10:15 → 10:20 → 10:30.
    //
    // It matters because a user can pick a time (W6). Someone asking for 10:15
    // and being shown 10:30 looks like a bug, so the picker must pass
    // `overlapMinutes: 0` — the overlap models "I am arriving now", which an
    // explicit pick is not. This test is what makes the distinction fail loudly
    // if the default is ever applied to a picked instant.
    const boundary = Date.UTC(2026, 7, 2, 10, 15);
    expect(nextEventTime(boundary)).toBe(Date.UTC(2026, 7, 2, 10, 30));
    expect(nextEventTime(boundary, { overlapMinutes: 0 })).toBe(boundary);
  });

  it("always lands on a quarter-hour multiple", () => {
    for (let minute = 0; minute < 24 * 60; minute += 7) {
      const at = Date.UTC(2026, 7, 2, 0, minute);
      expect(nextEventTime(at, { overlapMinutes: 0 }) % QUARTER_HOUR_MS).toBe(
        0,
      );
    }
  });
});

describe("eventCandidates", () => {
  const bbox = { south: 50.9, west: 6.9, north: 51, east: 7 };

  it("is deterministic for the same seed and time", () => {
    // THE WHOLE POINT OF THE SEEDING. Two clients that disagree here put two
    // players in different places while both believe they are right.
    const a = eventCandidates({
      bbox,
      globalSeed: 7,
      eventTime: 1000,
      count: 5,
    });
    const b = eventCandidates({
      bbox,
      globalSeed: 7,
      eventTime: 1000,
      count: 5,
    });
    expect(a).toEqual(b);
  });

  it("moves when the event time moves", () => {
    // Determinism is worthless if it is constant: positions must rotate every
    // quarter hour or the event never moves.
    const a = eventCandidates({ bbox, globalSeed: 7, eventTime: 0, count: 5 });
    const b = eventCandidates({
      bbox,
      globalSeed: 7,
      eventTime: QUARTER_HOUR_MS,
      count: 5,
    });
    expect(a).not.toEqual(b);
  });

  it("moves when the global seed moves", () => {
    const a = eventCandidates({ bbox, globalSeed: 1, eventTime: 0, count: 5 });
    const b = eventCandidates({ bbox, globalSeed: 2, eventTime: 0, count: 5 });
    expect(a).not.toEqual(b);
  });

  it("quantises the seed to MINUTES, as the C# does", () => {
    // The C# divides the timestamp by 60 000 before seeding, so every candidate
    // within one minute is identical. Without it, a client whose clock is a
    // second out computes a different position — the same failure as no
    // determinism at all.
    const a = eventCandidates({ bbox, globalSeed: 7, eventTime: 0, count: 3 });
    const b = eventCandidates({
      bbox,
      globalSeed: 7,
      eventTime: 59_999,
      count: 3,
    });
    expect(a).toEqual(b);
  });

  it("puts every candidate inside the tile", () => {
    const candidates = eventCandidates({
      bbox,
      globalSeed: 3,
      eventTime: 0,
      count: 50,
    });
    for (const point of candidates) {
      expect(point.lat).toBeGreaterThanOrEqual(bbox.south);
      expect(point.lat).toBeLessThanOrEqual(bbox.north);
      expect(point.lng).toBeGreaterThanOrEqual(bbox.west);
      expect(point.lng).toBeLessThanOrEqual(bbox.east);
    }
  });

  it("spreads candidates rather than clustering them", () => {
    // A generator returning near-identical points would satisfy every test
    // above and make the retry loop pointless — a hundred tries at one spot.
    const candidates = eventCandidates({
      bbox,
      globalSeed: 3,
      eventTime: 0,
      count: 40,
    });
    const lats = new Set(candidates.map((point) => point.lat.toFixed(4)));
    expect(lats.size).toBeGreaterThan(20);
  });
});

describe("climbToLocalMaximum", () => {
  it("walks uphill towards the warmer neighbourhood", () => {
    // A FULL grid with a real GRADIENT, and both halves of that matter.
    //
    // Full, so the peak has every neighbour scored and can be verified — a
    // sparse fixture reports `left` for the right reason and proves nothing.
    //
    // A gradient rather than a lone spike on a plateau, because hill-climbing
    // genuinely cannot cross flat ground: with 1 everywhere and one hot cell
    // three steps away, every neighbourhood sums to the same value and the
    // climb correctly does not move. That is a property of the algorithm the C#
    // chose, not a defect, and it is worth knowing before pointing it at a real
    // heat map — a field of mostly-identical scores gives it nothing to follow.
    const values: Record<string, number> = {};
    for (let x = -2; x <= 6; x += 1) {
      for (let y = -2; y <= 6; y += 1) {
        const distance = Math.hypot(x - 3, y - 3);
        values[`${x},${y}`] = Math.max(1, 20 - distance * 2);
      }
    }
    const result = climbToLocalMaximum({
      start: "0,0",
      heatAt: fieldFrom(values),
      neighbours: gridNeighbours,
      steps: 6,
    });
    expect(result.left).toBe(false);
    expect(result.cell).not.toBe("0,0");
  });

  it("does not move on a flat field", () => {
    const flat: Record<string, number> = {};
    for (let x = -2; x <= 2; x += 1) {
      for (let y = -2; y <= 2; y += 1) flat[`${x},${y}`] = 3;
    }
    const result = climbToLocalMaximum({
      start: "0,0",
      heatAt: fieldFrom(flat),
      neighbours: gridNeighbours,
      steps: 5,
    });
    expect(result.cell).toBe("0,0");
  });

  it("terminates at the step limit rather than running forever", () => {
    // An ever-rising field. Without a bound this walks until the process dies,
    // and it runs inside the worker.
    const heat = (cell: string): number => Number(cell.split(",")[0]);
    const result = climbToLocalMaximum({
      start: "0,0",
      heatAt: heat,
      neighbours: gridNeighbours,
      steps: 3,
    });
    expect(Number(result.cell.split(",")[0])).toBeLessThanOrEqual(3);
  });

  it("REPORTS leaving the scored field rather than returning the edge", () => {
    // THE TRAP NAMED IN THE PLAN (DEC-R6-14f), and the one that fails silently.
    // An unfetched cell scores as the identity — a plausible low number — so a
    // climb treating "no data" as "low heat" would settle on the rim of the
    // scored disk every single time, and nothing would report it. Every event
    // would be placed at the edge of whatever happened to be loaded.
    const result = climbToLocalMaximum({
      start: "0,0",
      heatAt: fieldFrom({ "0,0": 1 }),
      neighbours: gridNeighbours,
      steps: 5,
    });
    expect(result.left).toBe(true);
  });

  it("reports leaving immediately when the start itself is unscored", () => {
    const result = climbToLocalMaximum({
      start: "9,9",
      heatAt: fieldFrom({}),
      neighbours: gridNeighbours,
      steps: 5,
    });
    expect(result.left).toBe(true);
  });

  it("compares NEIGHBOURHOOD heat, not a single cell", () => {
    // `GetHeatForTilePlusNeighbours` in the C#. The climb walks towards a broad
    // warm area rather than an isolated spike — the difference between "a good
    // district" and "one lucky hexagon".
    //
    // "0,0" is the hottest single cell (10) but sits among cold ones; the patch
    // around "3,3" is uniformly warm (4 each) and wins on neighbourhood sum.
    const values: Record<string, number> = {};
    for (let x = -2; x <= 6; x += 1) {
      for (let y = -2; y <= 6; y += 1) values[`${x},${y}`] = 1;
    }
    values["0,0"] = 10;
    for (let x = 2; x <= 4; x += 1) {
      for (let y = 2; y <= 4; y += 1) values[`${x},${y}`] = 4;
    }
    const result = climbToLocalMaximum({
      start: "0,0",
      heatAt: fieldFrom(values),
      neighbours: gridNeighbours,
      steps: 6,
    });
    expect(result.left).toBe(false);
    expect(result.cell).not.toBe("0,0");
  });
});

/**
 * WHY THESE TESTS MATTER (round 9 §6, DEC-R9-3/12). `bestPickForTile` is the
 * candidate/retry loop the C# calls `CalcBestPickForGeoHashV2`, and the part it
 * was blocked on was the quality gate.
 *
 * THE GATE IS THE C# CONSTANT, TRANSLATED. `heat > 9` looked like a tuned
 * number and is not: `HeatMapTile.Heat` is documented "Starts at 1 as the
 * neutral multiplication identity element" and accumulates with `Heat *=
 * elemHeat`, exactly as this package's scorer does — so a 9-cell sum of 9 is an
 * entirely baseline neighbourhood, and `> 9` means "something is actually mapped
 * here". H3 gives 7 cells, so the same rule is `> 7`, DERIVED from the
 * neighbourhood rather than written down. Using the literal 9 would have been a
 * ~29 % tightening arrived at by arithmetic rather than judgement.
 */
describe("bestPickForTile — the candidate loop and its gate", () => {
  const BBOX = { south: 0, west: 0, north: 1, east: 1 };
  /** Every candidate maps to the same cell, so the field decides everything. */
  const toOneCell = () => "0,0";

  it("returns nothing when every candidate sits on baseline ground", () => {
    // The gate's whole purpose. A neighbourhood at the identity is unmapped
    // ground, and placing an event there is what the C# refuses to do.
    const flat: Record<string, number> = {};
    for (let x = -2; x <= 2; x += 1) {
      for (let y = -2; y <= 2; y += 1) flat[`${x},${y}`] = 1;
    }
    const pick = bestPickForTile({
      bbox: BBOX,
      globalSeed: 1,
      eventTime: 0,
      toCell: toOneCell,
      toLatLng: gridToLatLng,
      heatAt: fieldFrom(flat),
      neighbours: gridNeighbours,
      steps: 3,
    });
    expect(pick).toBeUndefined();
  });

  it("accepts a neighbourhood that is above baseline", () => {
    const warm: Record<string, number> = {};
    for (let x = -2; x <= 2; x += 1) {
      for (let y = -2; y <= 2; y += 1) warm[`${x},${y}`] = 2;
    }
    const pick = bestPickForTile({
      bbox: BBOX,
      globalSeed: 1,
      eventTime: 0,
      toCell: toOneCell,
      toLatLng: gridToLatLng,
      heatAt: fieldFrom(warm),
      neighbours: gridNeighbours,
      steps: 3,
    });
    expect(pick).toBeDefined();
    expect(pick?.cell).toBe("0,0");
  });

  it("derives the gate from the neighbourhood, not from a constant", () => {
    // A cell with FEWER neighbours has a lower baseline, so the same heat must
    // still pass. H3 pentagons really do have five neighbours rather than six,
    // and a hard-coded 7 would reject perfectly good ground at twelve places on
    // Earth -- rare enough never to be noticed and wrong every time.
    const values: Record<string, number> = { "0,0": 1.5, "1,0": 1.5 };
    const twoCellWorld = (cell: string) => (cell === "0,0" ? ["1,0"] : ["0,0"]);
    const pick = bestPickForTile({
      bbox: BBOX,
      globalSeed: 1,
      eventTime: 0,
      toCell: toOneCell,
      toLatLng: gridToLatLng,
      heatAt: fieldFrom(values),
      neighbours: twoCellWorld,
      steps: 1,
    });
    // Sum is 3.0 over a 2-cell neighbourhood: above its baseline of 2.
    expect(pick).toBeDefined();
  });

  it("rejects an isolated hot cell surrounded by unscored ground", () => {
    // `left: true` is "no answer", not "a weak answer" -- taking it would place
    // the event on the rim of whatever happened to be loaded (DEC-R6-14f).
    //
    // NAMED FOR THE OUTCOME, NOT THE MECHANISM, and that is deliberate. TWO
    // things reject this candidate and no fixture can separate them:
    // `climbToLocalMaximum` returns `heat: 0` whenever `left` is true, so the
    // gate rejects it even with the explicit `left` check removed. The check is
    // kept as defence in depth -- it states the intent independently of the
    // gate's arithmetic, so lowering the baseline could not let a left climb
    // through -- but a test claiming to pin it alone would be claiming something
    // it cannot observe. Found by mutation, not by reading.
    const island: Record<string, number> = { "0,0": 50 };
    const pick = bestPickForTile({
      bbox: BBOX,
      globalSeed: 1,
      eventTime: 0,
      toCell: toOneCell,
      toLatLng: gridToLatLng,
      heatAt: fieldFrom(island),
      neighbours: gridNeighbours,
      steps: 3,
    });
    expect(pick).toBeUndefined();
  });

  it("is deterministic for the same seed and time", () => {
    const warm: Record<string, number> = {};
    for (let x = -2; x <= 2; x += 1) {
      for (let y = -2; y <= 2; y += 1) warm[`${x},${y}`] = 3;
    }
    const args = {
      bbox: BBOX,
      globalSeed: 7,
      eventTime: 1_700_000_000_000,
      toCell: toOneCell,
      toLatLng: gridToLatLng,
      heatAt: fieldFrom(warm),
      neighbours: gridNeighbours,
      steps: 3,
    };
    expect(bestPickForTile(args)).toEqual(bestPickForTile(args));
  });

  it("reports which candidates it evaluated, for the demo to draw", () => {
    // DEC-R9-8 draws the deciding batch rather than all 100, so the caller needs
    // to know which ten those were.
    const warm: Record<string, number> = {};
    for (let x = -2; x <= 2; x += 1) {
      for (let y = -2; y <= 2; y += 1) warm[`${x},${y}`] = 3;
    }
    const pick = bestPickForTile({
      bbox: BBOX,
      globalSeed: 1,
      eventTime: 0,
      toCell: toOneCell,
      toLatLng: gridToLatLng,
      heatAt: fieldFrom(warm),
      neighbours: gridNeighbours,
      steps: 3,
    });
    expect(pick?.evaluated.length).toBe(10);
  });
});

/**
 * WHY `newGeoEventFor` EXISTS (round 9 §6). `bestPickForTile` answers "where in
 * THIS tile", and the C# then asks the same of the centre tile plus its three
 * nearest neighbours, returning them ordered by distance to the user — so the
 * app can show the closest event rather than an arbitrary one.
 */
describe("newGeoEventFor — picking across tiles, nearest first", () => {
  const warmField = () => {
    const values: Record<string, number> = {};
    for (let x = -3; x <= 3; x += 1) {
      for (let y = -3; y <= 3; y += 1) values[`${x},${y}`] = 3;
    }
    return fieldFrom(values);
  };

  const tileAt = (lat: number, lng: number) => ({
    bbox: { south: lat, west: lng, north: lat + 0.01, east: lng + 0.01 },
  });

  /**
   * A cell mapping that PRESERVES POSITION, at 0.1-degree granularity, plus its
   * exact inverse.
   *
   * The ordering tests below previously used `toCell: () => "0,0"`, which
   * collapsed every tile onto one cell. That was invisible while the sort key
   * was `candidate` — the seeds still differed — and became wrong the moment
   * ordering moved to the settled position, where it made every pick land on
   * the same point and the sort a no-op. A constant `toCell` cannot test
   * ordering at all; this one can.
   */
  const toCellAt = (position: { lat: number; lng: number }): string =>
    `${Math.round(position.lng * 10)},${Math.round(position.lat * 10)}`;
  const toLatLngAt = (cell: string): { lat: number; lng: number } => {
    const parts = cell.split(",").map(Number);
    return { lat: (parts[1] ?? 0) / 10, lng: (parts[0] ?? 0) / 10 };
  };
  /** Warm everywhere, so no edge of the field can deflect the climb. */
  const warmEverywhere = (): number => 3;

  it("orders picks by distance from the user, nearest first", () => {
    // The C#'s `OrderBy(distance to user)`. Without it the app would show an
    // arbitrary one of the four, which reads as the event jumping around.
    const event = newGeoEventFor({
      user: { lat: 0, lng: 0 },
      tiles: [tileAt(0.5, 0.5), tileAt(0, 0), tileAt(0.2, 0.2)],
      globalSeed: 1,
      eventTime: 0,
      toCell: toCellAt,
      toLatLng: toLatLngAt,
      heatAt: warmEverywhere,
      neighbours: gridNeighbours,
      steps: 3,
    });

    expect(event.picks).toHaveLength(3);
    // Over the SETTLED position, which is what the sort now uses and what a
    // caller showing "nearest event" would quote.
    const distances = event.picks.map(
      (pick) => Math.abs(pick.position.lat) + Math.abs(pick.position.lng),
    );
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  describe("deduplicating picks the caller calls the same spot (owner report 2026-09-04)", () => {
    // Two tiles whose candidates all settle on one plateau: tile A's climbs
    // start (and, on flat heat, stop) on cell "0,0", tile B's on "3,0" — the
    // shape of the field report, where a neighbour tile's climb entered the
    // same plateau from the other side and both reported heat 116 a few
    // metres apart. Tiles are 0.01° wide at lng 0 and 1, so every candidate of
    // each maps to one cell. "3,0" is NOT a grid neighbour of "0,0", so the
    // two neighbourhood sums are independent and a heat difference is a real
    // difference (adjacent cells share most of their neighbourhoods).
    const tiles = [tileAt(0, 0), tileAt(0, 1)];
    const toOneCellPerTile = (position: { lat: number; lng: number }) =>
      position.lng < 0.5 ? "0,0" : "3,0";
    const adjacent = (a: string, b: string) =>
      (a === "0,0" && b === "3,0") || (a === "3,0" && b === "0,0");
    const field = (heat0: number, heat1: number) => {
      const values: Record<string, number> = {};
      for (let x = -2; x <= 5; x += 1) {
        for (let y = -2; y <= 2; y += 1) values[`${x},${y}`] = 2;
      }
      values["0,0"] = heat0;
      values["3,0"] = heat1;
      return fieldFrom(values);
    };
    const pick = (
      heatAt: (cell: string) => number | undefined,
      sameSpot?: (a: string, b: string) => boolean,
    ) =>
      newGeoEventFor({
        user: { lat: 0, lng: 0.9 }, // nearer to "3,0": the rule must ignore it
        tiles,
        globalSeed: 1,
        eventTime: 0,
        toCell: toOneCellPerTile,
        toLatLng: gridToLatLng,
        heatAt,
        neighbours: gridNeighbours,
        steps: 3,
        ...(sameSpot === undefined ? {} : { sameSpot }),
      });

    it("keeps both without a predicate — today's behaviour, the caller opts in", () => {
      const event = pick(field(2, 2));
      expect(event.picks.map((p) => p.cell).sort()).toEqual(["0,0", "3,0"]);
      expect(event.tilesSearched).toBe(2);
    });

    it("merges two same-spot picks to one, keeping the higher heat", () => {
      // "3,0" is hotter, so it survives although "0,0" sorts first by id.
      const event = pick(field(2, 5), adjacent);
      expect(event.picks.map((p) => p.cell)).toEqual(["3,0"]);
      // The tile count is still what was SEARCHED (its docstring): two
      // tiles looked, one spot came back.
      expect(event.tilesSearched).toBe(2);
    });

    it("breaks an exact tie by the smaller cell id, never by the user's position", () => {
      // The user stands at lng 0.9, next to "3,0"; a nearest-wins tie-break
      // would make the surviving cell a function of where the user stood,
      // which is the non-determinism the report was about (plan DEC-T10).
      const event = pick(field(2, 2), adjacent);
      expect(event.picks.map((p) => p.cell)).toEqual(["0,0"]);
    });

    it("only merges what the predicate names; distinct spots stay", () => {
      const event = pick(field(2, 2), () => false);
      expect(event.picks).toHaveLength(2);
    });
  });

  it("weights longitude by latitude, so east-west is not over-counted", () => {
    // AT THE EQUATOR THIS LINE IS A NO-OP, which is why the test above cannot
    // see it -- cos(0) is 1. At Cologne's 51 degrees a longitude degree is only
    // ~0.63 of a latitude degree on the ground, so comparing raw degrees
    // over-counts east-west distance by ~37% and mis-orders a tile due east
    // against one due north. Found by mutation, not by reading.
    //
    // The tile due EAST is 0.8 degrees away, the one due NORTH 0.6. In raw
    // degrees north looks nearer; on the ground east is (0.8 x 0.629 = 0.503).
    const user = { lat: 51, lng: 0 };
    const tiny = (lat: number, lng: number) => ({
      bbox: { south: lat, west: lng, north: lat + 0.0001, east: lng + 0.0001 },
    });
    const event = newGeoEventFor({
      user,
      tiles: [tiny(51.6, 0), tiny(51, 0.8)],
      globalSeed: 1,
      eventTime: 0,
      toCell: toCellAt,
      toLatLng: toLatLngAt,
      heatAt: warmEverywhere,
      neighbours: gridNeighbours,
      steps: 3,
    });
    expect(event.picks).toHaveLength(2);
    // East first: nearer on the ground, further in raw degrees.
    expect(event.picks[0]?.position.lng).toBeGreaterThan(0.5);
  });

  it("skips a tile with no valid position rather than failing the event", () => {
    // The C# throws when the CENTRE tile yields nothing and logs a warning for a
    // neighbour. Neither is right here: a tile that is all water simply has no
    // event, and an exception would take the other tiles down with it.
    const onlyOneCellWarm: Record<string, number> = { "0,0": 1 };
    const event = newGeoEventFor({
      user: { lat: 0, lng: 0 },
      tiles: [tileAt(0, 0)],
      globalSeed: 1,
      eventTime: 0,
      toCell: () => "0,0",
      toLatLng: gridToLatLng,
      heatAt: fieldFrom(onlyOneCellWarm),
      neighbours: gridNeighbours,
      steps: 3,
    });
    expect(event.picks).toEqual([]);
  });

  it("orders by where the climb SETTLED, not by the seed it started from", () => {
    // THE DEFECT THIS PINS (found against the C# reference, round 9 follow-up).
    // `GeoEvent.cs:107` orders by `ToLatLong(x.ExactGeoHash)` -- the CLIMBED
    // geohash -- and `:87` takes the event position from the same place. The C#
    // even names the seed `RawStartEventPos`. Sorting by the seed instead means
    // "nearest event" can name the wrong tile, and the label built on
    // `picks[0]` then quotes a distance to a position no event is at.
    //
    // The field is flat and warm so the climb does NOT move; `toCell` and
    // `toLatLng` alone decide the two positions. That isolates the sort key
    // from the climb, which is the whole point -- the candidate ordering and
    // the settled ordering are deliberately opposite here.
    const event = newGeoEventFor({
      user: { lat: 0, lng: 0 },
      // The FAR tile's candidate climbs to a cell NEAR the user, and vice
      // versa, so sorting by candidate and sorting by position disagree.
      tiles: [tileAt(0.5, 0.5), tileAt(0.001, 0.001)],
      globalSeed: 1,
      eventTime: 0,
      toCell: (position) => (position.lat > 0.2 ? "1,0" : "0,0"),
      toLatLng: (cell) =>
        cell === "1,0" ? { lat: 0.01, lng: 0 } : { lat: 1, lng: 0 },
      heatAt: warmField(),
      neighbours: gridNeighbours,
      steps: 3,
    });

    expect(event.picks).toHaveLength(2);
    // First by settled position: the tile whose SEED is furthest away.
    expect(event.picks[0]?.candidate.lat).toBeGreaterThan(0.2);
    expect(event.picks[0]?.position).toEqual({ lat: 0.01, lng: 0 });
  });

  it("reports the settled position, so callers need not re-derive it", () => {
    // Both the map marker and the button label need "where is the event", and
    // each deriving it from `cell` separately is how the two drift apart --
    // which is exactly what happened: the map drew the winner at the seed.
    const event = newGeoEventFor({
      user: { lat: 0, lng: 0 },
      tiles: [tileAt(0, 0)],
      globalSeed: 1,
      eventTime: 0,
      toCell: () => "2,3",
      toLatLng: gridToLatLng,
      heatAt: warmField(),
      neighbours: gridNeighbours,
      steps: 3,
    });

    const pick = event.picks[0];
    expect(pick).toBeDefined();
    // The invariant, stated over the cell the climb ACTUALLY reached rather
    // than a hardcoded one: the reported position is that cell's position.
    // (Written the other way round first, and the climb walked off the warm
    // region's edge cell -- which made the expectation wrong, not the code.)
    expect(pick?.position).toEqual(gridToLatLng(pick?.cell ?? ""));
    // The climb moved, so seed and settled position are genuinely different --
    // without this the assertion above would hold trivially.
    expect(pick?.cell).not.toBe("2,3");
    expect(pick?.position).not.toEqual(pick?.candidate);
  });

  it("carries the event time, so the caller can show when it starts", () => {
    const event = newGeoEventFor({
      user: { lat: 0, lng: 0 },
      tiles: [tileAt(0, 0)],
      globalSeed: 1,
      eventTime: 1_700_000_000_000,
      toCell: () => "0,0",
      toLatLng: gridToLatLng,
      heatAt: warmField(),
      neighbours: gridNeighbours,
      steps: 3,
    });
    expect(event.eventTime).toBe(1_700_000_000_000);
  });
});

/**
 * WHY THESE TESTS MATTER — the gate is the C# constant TRANSLATED, and the
 * translation had an off-by-one plus a hardcoded threshold.
 *
 * DEC-R9-3 ports `heat > 9` by replacing the 9 with the neighbourhood's actual
 * cell count, because the C#'s 9 IS "nine cells at the multiplicative identity".
 * `bestPickForTile`'s own docstring says so: *"H3 gives 7 cells rather than 9, so
 * the identical rule is `> 7`"*.
 *
 * The code computed `neighbours(cell).length + 1`. `gridDisk(cell, 1)` returns
 * SEVEN cells INCLUDING the centre, so that is 8 — while `climbToLocalMaximum`
 * sums exactly those 7. The `+ 1` assumed `neighbours()` excluded self. The gate
 * was ~14 % stricter than the rule it claims to be.
 *
 * And the identity was hardcoded. The rule table can declare a per-category
 * `__threshold__`, which is what the MAP uses to decide whether a cell is usable
 * ground; the shipped table declares none, so both are 1 today and the two agree
 * by coincidence rather than by construction. Two definitions of "usable ground"
 * that happen to match is the same shape as the three definitions of "below the
 * surface" found earlier this round.
 */
describe("the quality gate is the neighbourhood at threshold, exactly", () => {
  const warmAt = (value: number) => () => value;

  const pickWith = (cellHeat: number, threshold?: number) =>
    bestPickForTile({
      bbox: { south: 0, west: 0, north: 0.01, east: 0.01 },
      globalSeed: 1,
      eventTime: 0,
      toCell: () => "0,0",
      toLatLng: gridToLatLng,
      heatAt: warmAt(cellHeat),
      neighbours: gridNeighbours,
      steps: 3,
      ...(threshold === undefined ? {} : { threshold }),
    });

  it("accepts a neighbourhood exactly above the identity, not one seventh above", () => {
    // `gridNeighbours` returns 9 cells (a 3x3 block including self), so the sum
    // is 9 x cellHeat and the baseline must be 9. At cellHeat slightly above 1
    // the neighbourhood is above the identity and MUST pass.
    //
    // With the `+ 1` the baseline was 10 against a 9-cell sum, so this failed:
    // 9 x 1.05 = 9.45, which is above 9 and below 10.
    expect(pickWith(1.05)).toBeDefined();
  });

  it("still rejects a neighbourhood exactly at the identity", () => {
    // The other half, and it is what stops the fix becoming "accept everything":
    // 9 x 1 = 9 is not ABOVE 9.
    expect(pickWith(1)).toBeUndefined();
  });

  it("scales with the category threshold the MAP uses, not a hardcoded 1", () => {
    // The rule table can declare `__threshold__` per category, and that is what
    // decides whether a cell is drawn as usable ground. An event should not be
    // placed on ground the map itself calls unusable.
    //
    // At threshold 3 the bar is 9 x 3 = 27, so a uniform 2 is below it and a
    // uniform 4 is above.
    expect(pickWith(2, 3)).toBeUndefined();
    expect(pickWith(4, 3)).toBeDefined();
  });
});

/**
 * WHY THIS TEST MATTERS (F57).
 *
 * DEC-R9-15 makes the tile set your own plus any neighbour already downloaded,
 * so two devices in the same place can see a different NUMBER of events while
 * agreeing exactly about each one. Without a searched count the UI cannot tell
 * the user which of those it is looking at, and "fewer events than my friend"
 * reads as a bug rather than as "you have less loaded".
 */
describe("the event reports how much ground was searched", () => {
  const warm = () => 3;
  const tileAt = (lat: number, lng: number) => ({
    bbox: { south: lat, west: lng, north: lat + 0.01, east: lng + 0.01 },
  });

  it("counts tiles SEARCHED, not tiles that yielded a pick", () => {
    // THE DISTINCTION THE FIELD EXISTS FOR. A tile that is all water is searched
    // and returns nothing, which is a different fact from never having looked --
    // and `picks.length` conflates them.
    const event = newGeoEventFor({
      user: { lat: 0, lng: 0 },
      tiles: [tileAt(0, 0), tileAt(0.2, 0.2), tileAt(0.5, 0.5)],
      globalSeed: 1,
      eventTime: 0,
      toCell: () => "0,0",
      toLatLng: gridToLatLng,
      // NOTHING passes the gate, so every pick is rejected while every tile is
      // still searched. Without this the two numbers would coincide and the
      // test could not tell them apart.
      heatAt: () => 1,
      neighbours: gridNeighbours,
      steps: 3,
    });

    expect(event.picks).toEqual([]);
    expect(event.tilesSearched).toBe(3);
  });

  it("counts every tile offered, including those that did yield picks", () => {
    const event = newGeoEventFor({
      user: { lat: 0, lng: 0 },
      tiles: [tileAt(0, 0), tileAt(0.2, 0.2)],
      globalSeed: 1,
      eventTime: 0,
      toCell: () => "0,0",
      toLatLng: gridToLatLng,
      heatAt: warm,
      neighbours: gridNeighbours,
      steps: 3,
    });

    expect(event.picks.length).toBeGreaterThan(0);
    expect(event.tilesSearched).toBe(2);
  });
});

describe("CANDIDATES_PER_BATCH is the caller's contract, not a private detail", () => {
  /**
   * WHY THIS TEST MATTERS (W8).
   *
   * The worker cannot score everything, so it derives which cells the climb
   * could possibly reach: it seeds batch 0 itself, expands each candidate by the
   * step count, and scores exactly that. `bestPickForTile` then evaluates its
   * OWN batch 0. Those are only the same ten candidates while the two batch
   * sizes agree — and until this was exported the demo carried its own copy in
   * another package, so nothing connected them and nothing could.
   *
   * The failure mode is the quiet kind: a smaller ensure set leaves later
   * candidates on unscored ground, the climb reports `left` for them, and the
   * event moves. No error, no test, just different answers.
   */
  it("is what `eventCandidates` must be asked for to reproduce batch 0", () => {
    const bbox = { south: 0, west: 0, north: 0.01, east: 0.01 };
    const eventTime = Date.UTC(2026, 7, 7, 16, 15);

    // What a caller derives its ensure set from.
    const derived = eventCandidates({
      bbox,
      globalSeed: 20260804,
      eventTime,
      count: CANDIDATES_PER_BATCH,
    });

    // What `bestPickForTile` actually evaluates first: it offsets the seed by
    // `batch * CANDIDATES_PER_BATCH`, which is a no-op for batch 0.
    const evaluated = eventCandidates({
      bbox,
      globalSeed: 20260804 + 0 * CANDIDATES_PER_BATCH,
      eventTime,
      count: CANDIDATES_PER_BATCH,
    });

    expect(derived).toEqual(evaluated);
    expect(derived).toHaveLength(CANDIDATES_PER_BATCH);
  });

  it("hands back exactly the batch it evaluated, which is what the map draws", () => {
    // `evaluated` is the demo's ~11 markers (DEC-R9-8), and it is also the
    // closest thing to a receipt for the coupling above: a pick that passes on
    // batch 0 must report the same ten candidates the caller derived its ensure
    // set from. If the two counts ever drift, these two arrays stop matching.
    //
    // (Written while finding that the docstring on this field described a
    // `batch: number` that has never existed on `BestPick`. The field is the
    // candidate list; the docstring now says so.)
    const bbox = { south: 0, west: 0, north: 0.01, east: 0.01 };
    const pick = bestPickForTile({
      bbox,
      globalSeed: 1,
      eventTime: 0,
      toCell: (at) => `${at.lat.toFixed(4)}:${at.lng.toFixed(4)}`,
      toLatLng: () => ({ lat: 0, lng: 0 }),
      heatAt: () => 5,
      neighbours: (cell) => [cell],
      steps: 0,
      threshold: 1,
    });

    expect(pick?.evaluated).toEqual(
      eventCandidates({
        bbox,
        globalSeed: 1,
        eventTime: 0,
        count: CANDIDATES_PER_BATCH,
      }),
    );
  });
});

describe("the winner is the warmest NEIGHBOURHOOD, not the warmest cell", () => {
  it("settles on a low-scoring cell that is surrounded by high ones", () => {
    // WHY THIS TEST MATTERS. This is the single most confusing thing about the
    // feature from a user's point of view, and it was reported as a suspected
    // bug from a live session: the marker sat on a cell whose tooltip read
    // `battleArea = 1` while visibly higher-scoring cells sat right beside it.
    //
    // It is correct, and it is `GetHeatForTilePlusNeighbours` in the C#.
    // `climbToLocalMaximum` maximises the sum over a cell AND its neighbours,
    // so being SURROUNDED by strength beats being strong: a weak cell in the
    // middle of a warm cluster outranks a strong cell on that cluster's edge,
    // because the edge cell's own neighbourhood reaches out into the cold.
    //
    // The fixture is the reported screenshot: a ring of 1.37s around a single
    // 1, on an otherwise flat field of 1.
    const values: Record<string, number> = {};
    for (let x = -4; x <= 8; x += 1) {
      for (let y = -4; y <= 8; y += 1) values[`${x},${y}`] = 1;
    }
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ]) {
      values[`${3 + dx},${3 + dy}`] = 1.37;
    }

    const neighbourhood = (cell: string): number =>
      gridNeighbours(cell).reduce((sum, at) => sum + (values[at] ?? 0), 0);

    // The centre is the WEAKEST cell of the nine and the warmest neighbourhood.
    expect(values["3,3"]).toBe(1);
    expect(values["3,2"]).toBe(1.37);
    expect(neighbourhood("3,3")).toBeGreaterThan(neighbourhood("3,2"));

    const climbed = climbToLocalMaximum({
      start: "0,0",
      heatAt: fieldFrom(values),
      neighbours: gridNeighbours,
      steps: 5,
    });

    expect(climbed.left).toBe(false);
    expect(climbed.cell).toBe("3,3");
    // The pick's OWN score is the lowest in its cluster — which is the thing
    // that looks wrong on the map and is not.
    expect(values[climbed.cell]).toBe(1);
  });

  it("is what lets the gate pass a cluster and reject a lone spike", () => {
    // The counterweight, and why the design is the one the C# chose. The gate
    // is `heat > neighbours(cell).length * threshold` — a sum over the
    // neighbourhood — so one very high cell surrounded by identity ground does
    // NOT qualify, while a broad, mildly-warm district does. An event is meant
    // to land somewhere you can play, not on one lucky hexagon.
    const spike: Record<string, number> = {};
    for (let x = -4; x <= 8; x += 1) {
      for (let y = -4; y <= 8; y += 1) spike[`${x},${y}`] = 1;
    }
    spike["3,3"] = 4;

    const climbed = climbToLocalMaximum({
      start: "3,3",
      heatAt: fieldFrom(spike),
      neighbours: gridNeighbours,
      steps: 5,
    });

    // Nine cells at the identity would sum to 9; the spike lifts it to 12.
    const gate = gridNeighbours("3,3").length * 1;
    expect(climbed.heat).toBe(12);
    expect(climbed.heat > gate).toBe(true);

    // But move the spike's neighbours below the identity and the same cell
    // fails the gate, however high it is on its own — the district is judged,
    // not the hexagon.
    //
    // `steps: 0` so the climb reports THIS cell's neighbourhood rather than
    // wherever it would wander off to. Written the other way round first, and
    // it measured the wrong cell: from an isolated spike the climb walks OUT
    // to the surrounding field, whose neighbourhood is warmer than the pit the
    // spike sits in — true, and not the claim being made here.
    const isolated: Record<string, number> = { ...spike };
    for (const at of gridNeighbours("3,3")) {
      if (at !== "3,3") isolated[at] = 0.5;
    }
    const alone = climbToLocalMaximum({
      start: "3,3",
      heatAt: fieldFrom(isolated),
      neighbours: gridNeighbours,
      steps: 0,
    });
    expect(alone.cell).toBe("3,3");
    expect(alone.heat).toBe(8);
    expect(alone.heat > gate).toBe(false);
  });
});

describe("rankedPeaks — the exhaustive alternative to climbing", () => {
  /** A tiny field laid out as a line of cells, so neighbours are predictable. */
  const line = ["a", "b", "c", "d", "e", "f", "g"];
  const neighbours = (cell: string): string[] => {
    const i = line.indexOf(cell);
    return [line[i - 1], line[i + 1]].filter(
      (c): c is string => c !== undefined,
    );
  };

  it("finds the global maximum a climb would miss", () => {
    // The point of the whole change: a scan cannot get stuck, so the tallest
    // ground is found wherever it is.
    // A THREE-CELL PLATEAU, not a single spike, and the difference matters:
    // the ranking is by NEIGHBOURHOOD heat, so a lone tall cell TIES with the
    // cell beside it (both neighbourhoods contain it). The first version of
    // this fixture used one spike and the tie fell to the alphabetical
    // tie-break, which looked like a bug in the code and was a bug in the test.
    const heat: Record<string, number> = {
      a: 1,
      b: 1,
      c: 1,
      d: 1,
      e: 9,
      f: 9,
      g: 9,
    };
    const peaks = rankedPeaks({
      cells: line,
      heatAt: (c) => heat[c],
      neighbours,
      topN: 1,
    });
    expect(peaks[0]?.cell).toBe("f");
  });

  it("returns SEPARATED peaks, not one hill listed N times", () => {
    // Without the exclusion this returns f, then its neighbours e and g — one
    // place three times — and the rotation would have nothing to rotate between.
    const heat: Record<string, number> = {
      a: 1,
      b: 20,
      c: 1,
      d: 1,
      e: 9,
      f: 9,
      g: 9,
    };
    const peaks = rankedPeaks({
      cells: line,
      heatAt: (c) => heat[c],
      neighbours,
      topN: 2,
    });
    expect(peaks.map((p) => p.cell)).toEqual(["f", "b"]);
  });

  it("skips unscored ground rather than reading it as cold", () => {
    // `undefined` is "nobody looked", not "nothing there" — the distinction
    // `cellState` exists to preserve. A cell nobody scored cannot be a peak.
    const heat: Record<string, number | undefined> = {
      a: 1,
      b: undefined,
      c: 5,
    };
    const peaks = rankedPeaks({
      cells: ["a", "b", "c"],
      heatAt: (c) => heat[c],
      neighbours: () => [],
      topN: 3,
    });
    expect(peaks.map((p) => p.cell)).toEqual(["c", "a"]);
  });

  it("orders ties by cell id, so clients that must agree do", () => {
    const heat: Record<string, number> = { z: 5, a: 5 };
    const peaks = rankedPeaks({
      cells: ["z", "a"],
      heatAt: (c) => heat[c],
      neighbours: () => [],
      topN: 2,
    });
    expect(peaks.map((p) => p.cell)).toEqual(["a", "z"]);
  });
});

describe("bestPickOverField — the exhaustive pick, and its weighting", () => {
  /**
   * WHY THIS WHOLE BLOCK MATTERS. `bestPickOverField` shipped wired into the
   * demo (`demo-pipeline.ts` passes `cellsOfTile`) with **no test of its own** —
   * `rankedPeaks` was covered, the pick built on top of it was not. So the one
   * thing the exhaustive path adds beyond ranking, the heat-weighted roll, was
   * asserted only by a docstring.
   */

  /** Isolated cells: no neighbours, so neighbourhood heat is the cell's own. */
  const alone = (): string[] => [];

  /** Peak plus five bumps — the fixture the weighting docstring computes on. */
  const peakAndBumps: Record<string, number> = {
    "0,0": 560,
    "10,0": 84,
    "20,0": 84,
    "30,0": 84,
    "40,0": 84,
    "50,0": 84,
  };

  const pickAt = (
    eventTime: number,
    heat: Record<string, number> = peakAndBumps,
  ): ReturnType<typeof bestPickOverField> =>
    bestPickOverField({
      cells: Object.keys(heat),
      globalSeed: 42,
      eventTime,
      toLatLng: gridToLatLng,
      heatAt: (cell) => heat[cell],
      neighbours: alone,
    });

  it("refuses ground the map itself calls unusable", () => {
    // The SHARED quality gate, `heat > neighbours(cell).length × threshold`.
    // Nine neighbours (the grid includes the cell itself) against heat 3 fails
    // it, and a refusal must be `undefined` — never a pick on bad ground, which
    // would put an event where the map draws nothing.
    const thin: Record<string, number> = { "0,0": 3, "1,0": 3 };
    expect(
      bestPickOverField({
        cells: Object.keys(thin),
        globalSeed: 42,
        eventTime: Date.UTC(2026, 7, 2, 10, 15),
        toLatLng: gridToLatLng,
        heatAt: (cell) => thin[cell],
        neighbours: gridNeighbours,
      }),
    ).toBeUndefined();
  });

  it("returns undefined over ground nobody has scored", () => {
    // Not a crash and not a pick at the origin: an unscored field simply has no
    // event in it, the same way `rankedPeaks` skips unscored cells.
    expect(pickAt(Date.UTC(2026, 7, 2, 10, 15), {})).toBeUndefined();
  });

  it("is identical for the same seed and minute, and quantised to minutes", () => {
    // DETERMINISM IS THE FEATURE. Two clients agree without coordinating only
    // if the pick depends on nothing but seed and whole minute — so a clock a
    // few seconds out must not move the event.
    const at = Date.UTC(2026, 7, 2, 10, 15);
    expect(pickAt(at)).toEqual(pickAt(at));
    expect(pickAt(at + 59_000)).toEqual(pickAt(at));
  });

  it("reports the shortlist it beat, capped at EXHAUSTIVE_SHORTLIST", () => {
    // `evaluated` is what the map draws beside the pick. For the scan these are
    // genuine runners-up rather than the climb's discarded seeds, and there are
    // never more of them than the shortlist — ten separated peaks still yield
    // six, or the map would claim the search considered more than it ranked.
    const wide: Record<string, number> = {};
    for (let i = 0; i < 10; i += 1) wide[`${i * 10},0`] = 100 + i;

    const pick = pickAt(Date.UTC(2026, 7, 2, 10, 15), wide);
    expect(pick?.evaluated).toHaveLength(EXHAUSTIVE_SHORTLIST);
    // Nothing was climbed, so the reported candidate IS the chosen position.
    expect(pick?.candidate).toEqual(pick?.position);
    expect(pick?.position).toEqual(gridToLatLng(pick?.cell ?? ""));
  });

  it("weights by heat rather than rolling uniformly over the shortlist", () => {
    // THE ARITHMETIC THE DOCSTRING CLAIMS, now executable. A peak at 560 against
    // five bumps at 84 is 560/980 of the total heat, so it must win ≈57 % of
    // minutes — not the 1-in-6 (17 %) a uniform roll over the shortlist gives.
    //
    // Sampled over 1 200 consecutive minutes, which is deterministic: the roll
    // is `stableHash`, not a PRNG, so this is a fixed number and not a flake.
    const start = Date.UTC(2026, 7, 2, 0, 0);
    const minutes = 1200;
    let peakWins = 0;
    const winners = new Set<string>();
    for (let m = 0; m < minutes; m += 1) {
      const pick = pickAt(start + m * 60_000);
      winners.add(pick?.cell ?? "none");
      if (pick?.cell === "0,0") peakWins += 1;
    }

    const share = peakWins / minutes;
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.65);

    // AND THE ROTATION SURVIVES THE WEIGHTING, which is the other half: every
    // shortlisted place must stay reachable, or the event is static forever —
    // the regression `EXHAUSTIVE_SHORTLIST` exists to prevent.
    expect(winners.size).toBe(Object.keys(peakAndBumps).length);
  });
});
