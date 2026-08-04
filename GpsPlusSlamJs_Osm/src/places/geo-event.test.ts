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
  QUARTER_HOUR_MS,
  bestPickForTile,
  climbToLocalMaximum,
  eventCandidates,
  nextEventTime,
} from "./geo-event.js";

/** A heat field over a small integer grid; everything else is unscored. */
function fieldFrom(
  values: Record<string, number>,
): (cell: string) => number | undefined {
  return (cell) => values[cell];
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
      heatAt: fieldFrom(warm),
      neighbours: gridNeighbours,
      steps: 3,
    });
    expect(pick?.evaluated.length).toBe(10);
  });
});
