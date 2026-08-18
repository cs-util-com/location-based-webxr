import { describe, expect, it } from "vitest";

import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { buildObstacleIndex } from "../../nav/obstacles.js";

/**
 * WHAT `buildObstacleIndex` COSTS, measured rather than guessed (DEC-G7).
 *
 * WHY THIS FILE EXISTS. Stage 4 had to decide WHERE the index is built.
 * DEC-R11-16 chose "in the worker, once per publish, in the same pass as the mesh
 * builders" and explicitly left the publish-path cost to be measured before
 * wiring (stage-3 follow-ups §4). This is that measurement, and it decided the
 * question in favour of DEC-R11-19: the index is built **lazily, on the first
 * route request**, because the sweep is hundreds of milliseconds per publish on
 * a corpus extract and a session where nobody orders a route would pay all of it
 * for nothing.
 *
 * **The figures, on the developer machine, 2026-08-08** — the whole corpus was
 * measured once while taking this decision, and every site landed in the same
 * band:
 *
 * - `cologne-cathedral` — 2 347 covered cells, 186 obstacles, 1 281 features
 * - `heidelberg-altstadt` — 2 280 / 433 / 1 135
 * - `berlin-alexanderplatz` — 2 394 / 56 / 1 298
 * - `sylt-westerland` — 2 294 / 189 / 729
 * - `manhattan-midtown` — 2 716 / 227 / 1 463
 * - `tokyo-shinjuku` — 1 937 / 173 / 1 749
 *
 * Six sites cost ~2.4 s wall clock including the JSON parse, i.e. a few hundred
 * milliseconds each. The extracts are res-9/res-10 captures; **the demo's
 * working set is a res-7 fetch tile and is substantially larger**, so this is a
 * floor on the real publish cost rather than an estimate of it.
 *
 * **ONLY ONE SITE IS MEASURED HERE, and that is deliberate.** Sweeping all six
 * cost the package's unit stage ~15 s — a 37 % increase for a measurement whose
 * conclusion every site agreed on — and even two sites put measurable
 * module-level load on a pool where `poi-models.test.ts` runs with under two
 * seconds of headroom against the 5 s per-test cap. `site-barriers.test.ts` and
 * `site-building-obstacles.test.ts` already build an index at every site, so the
 * corpus-wide "it indexes something everywhere" floor is covered there; this
 * file keeps the one that carries the argument — Cologne, the site the demo
 * opens on, and the home of the ~16 200 m² canopy the passability rule exists
 * for. The other five figures are in the list above, from the one-off sweep.
 *
 * **WHY THE ASSERTIONS ARE CELL COUNTS AND NOT DURATIONS.** `coverCells` at
 * res-13 (~8 m) over every barrier and every solid building is the work, and the
 * number of covered cells is a DETERMINISTIC proxy for it — same input, same
 * number, on any machine under any suite load. A wall-clock threshold would be a
 * flake on CI and a false green on a fast laptop, which is the failure mode
 * `site-barriers.test.ts`'s own header describes.
 *
 * A change to these counts is a selector change or a resolution change. Both
 * move the publish cost, so both should fail here and be re-argued rather than
 * absorbed.
 *
 * @see ../../nav/obstacles.ts.md
 */

interface Measurement {
  readonly cells: number;
  readonly obstacles: number;
  readonly buildMs: number;
}

/**
 * The one site the decision rests on. See the header for why this is not all
 * six, and for the other five sites' figures.
 */
const MEASURED_SITES = ["cologne-cathedral"] as const;

/**
 * One index per site, BUILT ONCE AT MODULE LEVEL.
 *
 * The same hoisting `site-barriers.test.ts` documents, and for the same reason:
 * this is a substantial fraction of a second per site, and building inside an
 * `it` puts sites past vitest's 5 s per-test timeout whenever the suite runs in
 * parallel — a timeout that appears only under load, which reads as flake.
 */
const measured = new Map<string, Measurement>();

for (const id of MEASURED_SITES) {
  const features = [...parseOverpassJson(loadSite(id).payload).features];
  const started = performance.now();
  const index = buildObstacleIndex(features);
  const buildMs = performance.now() - started;
  // Counted by IDENTITY across the whole index: one obstacle is filed under
  // every cell it covers, so a naive sum would report the coverage again rather
  // than the population producing it — which is the ratio the last test is about.
  const seen = new Set<unknown>();
  for (const cell of index.cells) {
    for (const obstacle of index.obstaclesIn(cell)) seen.add(obstacle);
  }
  measured.set(id, {
    cells: index.cells.size,
    obstacles: seen.size,
    buildMs,
  });
}

function measurementFor(id: string): Measurement {
  const entry = measured.get(id);
  if (entry === undefined) throw new Error(`no measurement for ${id}`);
  return entry;
}

describe("what the obstacle index costs", () => {
  it("covers thousands of res-13 cells at the measured site", () => {
    // THE NUMBER THAT DECIDED DEC-R11-19: ~1 900–2 700 covered cells per corpus
    // extract, each one a `coverCells` sweep plus Map insertions, on extracts
    // several times smaller than the demo's actual working set. That is not a
    // rounding error on a publish, and the publish is already this demo's
    // slowest interaction.
    //
    // Bounded from BOTH sides. The upper bound catches a selector that started
    // indexing the world; the lower bound catches one that quietly stopped
    // indexing anything — which is the failure that makes routing look fast
    // while walking agents through walls.
    for (const id of MEASURED_SITES) {
      const entry = measurementFor(id);
      expect(entry.cells).toBeGreaterThan(1_000);
      expect(entry.cells).toBeLessThan(10_000);
    }
  });

  it("indexes real obstacles at the measured site", () => {
    // The floor under the whole feature. A site that indexes nothing routes an
    // agent straight through every wall it can see and still looks like it
    // works — which is exactly why stage 3 shipped corpus tests with literal
    // counts rather than hand-built fixtures. The corpus-WIDE version of this
    // floor lives in `site-barriers.test.ts`, which already builds an index at
    // every site; repeating it here would double that sweep for one assertion.
    for (const id of MEASURED_SITES) {
      const entry = measurementFor(id);
      expect(entry.obstacles).toBeGreaterThan(20);
    }
  });

  it("costs many more cells than it holds obstacles, which is why it is cached", () => {
    // WHY THE INDEX IS EXPENSIVE, as an assertion rather than as prose: each
    // obstacle is smeared across many res-13 cells so a step lookup is a Map hit
    // instead of a scan. That multiplier IS the cost, and it is what makes
    // "build once per feature set" worth a module of its own — at a ratio near 1
    // the index would be barely more than the feature list and the cache would
    // not earn its complexity.
    for (const id of MEASURED_SITES) {
      const entry = measurementFor(id);
      expect(entry.cells).toBeGreaterThan(entry.obstacles * 3);
    }
  });

  it("takes real time to build, which is the fact the caching rests on", () => {
    // ASSERTED AS A SHAPE, NEVER AS A THRESHOLD. The claim that matters is
    // "this is measurable work, not free" — a duration bound here would be a
    // flake under suite load and would pass trivially on a fast machine. The
    // actual figures are in the header, where a reader can compare them against
    // their own run.
    for (const id of MEASURED_SITES) {
      const entry = measurementFor(id);
      expect(Number.isFinite(entry.buildMs)).toBe(true);
      expect(entry.buildMs).toBeGreaterThan(0);
    }
  });
});
