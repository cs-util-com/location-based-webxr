/**
 * Pass A — reachability and pathfinding over H3 cells.
 *
 * Why these tests matter:
 * `connectedComponents` already answers "are these two cells in the same blob".
 * It does NOT answer "how do I get from one to the other", which is what an
 * agent needs, and the design names traversal within a component as the missing
 * piece. These tests pin that traversal.
 *
 * The trap the implementation plan names explicitly is a fixture that makes the
 * thing under test constant: on a field where every cell is in scope, a path
 * search is indistinguishable from enumerating a straight line. So the load-
 * bearing cases here all have a BARRIER, and they assert the route is strictly
 * longer than the unobstructed grid distance — a detour that a straight-line
 * walker could not produce.
 *
 * @see path.ts.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell, gridDisk, gridDistance, gridRingUnsafe } from "h3-js";
import { findPath, reachableFrom } from "./path.js";
import { columnsAdjacent } from "./column.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";

const ORIGIN = latLngToCell(50.9413, 6.9583, AFFORDANCE_RES);

/** An open field: every cell within 6 rings of the origin. */
const FIELD = new Set(gridDisk(ORIGIN, 6));

/**
 * A wall that fully encloses the origin except for one cell — the gate.
 *
 * Ring 3 is a closed loop around the origin, so removing all of it but one cell
 * leaves exactly one way out. Any route from the middle to the outside MUST
 * pass through the gate, which is what makes the detour assertions meaningful
 * rather than incidental.
 */
const RING_3 = gridRingUnsafe(ORIGIN, 3);
const GATE = RING_3[0]!;
const WALLED = new Set(
  [...FIELD].filter((cell) => cell === GATE || !RING_3.includes(cell)),
);

/** A cell outside the wall, on the far side from the gate. */
const OUTSIDE = gridRingUnsafe(ORIGIN, 5)[8]!;

describe("the fixture itself", () => {
  // THE PLAN'S NAMED TRAP, GUARDED DIRECTLY: "a synthetic field fixture that
  // makes the thing under test constant". Every barrier assertion below is
  // worthless if the wall does not actually enclose the origin or the gate is
  // not actually the only way through. These check the fixture, so a future
  // edit that quietly defangs it fails HERE rather than leaving a suite that
  // passes for the wrong reason.
  it("encloses the origin with a wall that has exactly one opening", () => {
    expect(RING_3).toHaveLength(18);
    expect(WALLED.has(GATE)).toBe(true);

    // Filtered rather than guarded with an `if`, because a conditional
    // `expect` asserts nothing at all when its guard never holds.
    const bricks = RING_3.filter((cell) => cell !== GATE);
    expect(bricks).toHaveLength(17);
    for (const cell of bricks) expect(WALLED.has(cell)).toBe(false);
  });

  it("puts the goal outside the wall, reachable in the open field", () => {
    expect(gridDistance(ORIGIN, OUTSIDE)).toBe(5);
    expect(FIELD.has(OUTSIDE)).toBe(true);
    expect(WALLED.has(OUTSIDE)).toBe(true);
  });

  it("makes the detour strictly longer than the open route", () => {
    // The assertion the barrier exists to produce. If these two were ever
    // equal, every "routes through the gate" test below would be satisfied by
    // a search that ignored the scope set entirely.
    const open = findPath(ORIGIN, OUTSIDE, FIELD)!.length;
    const detour = findPath(ORIGIN, OUTSIDE, WALLED)!.length;
    expect(detour).toBeGreaterThan(open);
  });
});

describe("findPath", () => {
  it("returns the start alone when start and goal are the same", () => {
    expect(findPath(ORIGIN, ORIGIN, FIELD)).toEqual([ORIGIN]);
  });

  it("finds a shortest route across an open field", () => {
    const goal = gridRingUnsafe(ORIGIN, 4)[0]!;
    const path = findPath(ORIGIN, goal, FIELD);

    expect(path?.[0]).toBe(ORIGIN);
    expect(path?.at(-1)).toBe(goal);
    // With no obstacle the hop count is exactly the grid distance. Asserting
    // the LENGTH, not just that a path exists, is what separates a real search
    // from one that wanders and happens to arrive.
    expect(path).toHaveLength(gridDistance(ORIGIN, goal) + 1);
  });

  it("routes through the gate when a wall stands in the way", () => {
    // THE DESIGN'S CASE, in 2D. The direct line is blocked, one opening exists,
    // and the route has to use it.
    const path = findPath(ORIGIN, OUTSIDE, WALLED);

    expect(path).toBeDefined();
    expect(path).toContain(GATE);
    // STRICTLY LONGER THAN THE STRAIGHT LINE. This is the assertion that a
    // fixture without a real barrier could not produce, and the one that fails
    // if the search quietly ignores the scope set.
    expect(path!.length).toBeGreaterThan(gridDistance(ORIGIN, OUTSIDE) + 1);
  });

  it("returns undefined when the wall has no gate at all", () => {
    const sealed = new Set([...FIELD].filter((c) => !RING_3.includes(c)));
    expect(findPath(ORIGIN, OUTSIDE, sealed)).toBeUndefined();
  });

  it("never steps outside the scope set", () => {
    const path = findPath(ORIGIN, OUTSIDE, WALLED)!;
    for (const cell of path) expect(WALLED.has(cell)).toBe(true);
  });

  it("returns a route whose every step is a grid neighbour", () => {
    const path = findPath(ORIGIN, OUTSIDE, WALLED)!;
    for (let i = 1; i < path.length; i++) {
      expect(gridDistance(path[i - 1]!, path[i]!)).toBe(1);
    }
  });

  it("is deterministic across repeated calls", () => {
    // Region identity and the geo-event both derive from sorted traversal for
    // this reason: a route that varies per call turns any downstream
    // comparison into a coin flip.
    const first = findPath(ORIGIN, OUTSIDE, WALLED);
    for (let i = 0; i < 5; i++) {
      expect(findPath(ORIGIN, OUTSIDE, WALLED)).toEqual(first);
    }
  });

  it("does not depend on the order the caller built the scope set", () => {
    // THE DETERMINISM THAT ACTUALLY BITES. A `Set` iterates in insertion
    // order, so a search that walked the scope set rather than the grid would
    // return different routes for sets holding identical cells — and the
    // caller assembles that set from region cells whose order is its own
    // business. `connectedComponents` sorts for exactly this reason.
    const reversed = new Set([...WALLED].reverse());
    expect(findPath(ORIGIN, OUTSIDE, reversed)).toEqual(
      findPath(ORIGIN, OUTSIDE, WALLED),
    );
  });

  describe("the injectable step predicate", () => {
    it("routes around a barrier that only the predicate knows about", () => {
      // THE SEAM PASS B PLUGS INTO. The scope set is the OPEN field — nothing
      // is missing from it — and the detour exists purely because the
      // predicate refuses those steps. This is how a height-aware pass B makes
      // the same search go around a wall instead of over it, without pass A
      // knowing anything about geometry.
      const blocked = new Set(RING_3.filter((cell) => cell !== GATE));
      const path = findPath(ORIGIN, OUTSIDE, FIELD, {
        canStep: (_from, to) => !blocked.has(to),
      });

      expect(path).toContain(GATE);
      expect(path!.length).toBeGreaterThan(gridDistance(ORIGIN, OUTSIDE) + 1);
    });

    it("routes around a SINGLE-VALUED height field", () => {
      // NOT "the column model" — that is what this test used to claim, and
      // review on #257 was right to reject the claim. `canStep` receives cell
      // strings, so `heightAt` below resolves ONE height per cell: a
      // heightfield with a step filter, which is a strictly weaker thing.
      //
      // The genuine two-states-in-one-cell case lives in
      // `column-space.test.ts`, over a search keyed by `(cell, heightM)`.
      // Under THIS composition `columnsAdjacent(foot, top)` is unreachable,
      // because `from` and `to` are never the same cell.
      //
      // The test is kept because a single-valued field is a real
      // configuration — it is what a terrain-only pass B produces — and
      // because a route that detours purely on heights is worth pinning.
      const heightAt = (cell: string) =>
        RING_3.includes(cell) && cell !== GATE ? 8 : 0;

      const path = findPath(ORIGIN, OUTSIDE, FIELD, {
        canStep: (from, to) =>
          columnsAdjacent(
            { cell: from, heightM: heightAt(from) },
            { cell: to, heightM: heightAt(to) },
          ),
      });

      expect(path).toContain(GATE);
      expect(path!.length).toBeGreaterThan(gridDistance(ORIGIN, OUTSIDE) + 1);
    });

    it("is never asked about a cell that was already visited", () => {
      // ROUGHLY FIVE CALLS IN SIX, in a flood. Every interior cell is reached
      // once but sits in six neighbourhoods, so a predicate consulted before
      // the visited check is asked about it six times over.
      //
      // Harmless while the predicate is a set lookup; pass B's does
      // point-in-polygon and a height lookup per call, so it stops being
      // harmless exactly when stage 3 lands. Raised in review on #257.
      const asked: string[] = [];
      findPath(ORIGIN, OUTSIDE, FIELD, {
        canStep: (_from, to) => {
          asked.push(to);
          return true;
        },
      });

      expect(asked.length).toBeGreaterThan(0);
      expect(new Set(asked).size).toBe(asked.length);
    });

    it("is never asked about a cell outside the scope set", () => {
      // Pass B's predicate will do real geometry work per call. Asking it
      // about cells that were already excluded is wasted work, and worse, it
      // invites a predicate that has to defend itself against out-of-scope
      // input.
      const asked: string[] = [];
      findPath(ORIGIN, OUTSIDE, WALLED, {
        canStep: (_from, to) => {
          asked.push(to);
          return true;
        },
      });
      for (const cell of asked) expect(WALLED.has(cell)).toBe(true);
    });
  });

  describe("defensive behaviour at the module boundary", () => {
    it("returns undefined when the start or goal is out of scope", () => {
      const far = gridRingUnsafe(ORIGIN, 20)[0]!;
      expect(findPath(far, ORIGIN, FIELD)).toBeUndefined();
      expect(findPath(ORIGIN, far, FIELD)).toBeUndefined();
    });

    it("refuses a zero-length route that stands on unscored ground", () => {
      // THE CASE THE SCOPE GUARD ACTUALLY EXISTS FOR, found by mutation
      // testing: for every other input the guard is only a fast path — the
      // search would fail to expand anyway and return `undefined` on its own.
      // Not here. Remove the guard and `start === goal` returns `[far]`,
      // asserting a standable position on a cell that was never scored.
      const far = gridRingUnsafe(ORIGIN, 20)[0]!;
      expect(findPath(far, far, FIELD)).toBeUndefined();
    });

    it("refuses cells at different resolutions", () => {
      const coarse = latLngToCell(50.9413, 6.9583, 8);
      expect(() => findPath(ORIGIN, coarse, new Set([ORIGIN, coarse]))).toThrow(
        /resolution/i,
      );
    });

    it("refuses a cap that would silently disable the bound", () => {
      // NaN MAKES EVERY COMPARISON FALSE, so `expansions > NaN` never fires and
      // the safeguard is off — with no error and no way to notice except a tab
      // that stops responding. `Infinity` removes the ceiling outright. A
      // safeguard a caller can switch off by accident is not a safeguard.
      // CodeRabbit raised this as Major on #257.
      for (const cap of [NaN, Infinity, 0, -1]) {
        expect(
          () => findPath(ORIGIN, OUTSIDE, FIELD, { maxExpansions: cap }),
          String(cap),
        ).toThrow(/maxExpansions/);
      }
    });

    it("throws rather than searching past the expansion cap", () => {
      // A CAP, NOT A SILENT TRUNCATION. Returning `undefined` on exhaustion
      // would be indistinguishable from "no route exists" — the caller would
      // draw a blank and never learn the search gave up.
      expect(() =>
        findPath(ORIGIN, OUTSIDE, FIELD, { maxExpansions: 3 }),
      ).toThrow(/expansion/i);
    });
  });
});

describe("reachableFrom", () => {
  it("collects exactly the cells the barrier leaves open", () => {
    const inner = reachableFrom(ORIGIN, WALLED);

    // The gate is reachable, and so is everything beyond it — one opening is
    // enough to make the whole field connected.
    expect(inner.has(GATE)).toBe(true);
    expect(inner.has(OUTSIDE)).toBe(true);
  });

  it("stops at a sealed barrier", () => {
    const sealed = new Set([...FIELD].filter((c) => !RING_3.includes(c)));
    const inner = reachableFrom(ORIGIN, sealed);

    expect(inner.has(ORIGIN)).toBe(true);
    expect(inner.has(OUTSIDE)).toBe(false);
    // Rings 0-2 are 1 + 6 + 12 = 19 cells. Pinning the COUNT catches a flood
    // that leaks through the barrier by one cell, which `has(OUTSIDE)` alone
    // would miss.
    expect(inner.size).toBe(19);
  });

  it("returns an empty set when the start is out of scope", () => {
    expect(reachableFrom(gridRingUnsafe(ORIGIN, 20)[0]!, FIELD).size).toBe(0);
  });

  it("honours the step predicate as well as the scope set", () => {
    // `reachableFrom` and `findPath` must agree about what an edge is. If only
    // one of them consulted the predicate, a caller could be told a cell is
    // reachable and then get `undefined` asking for the route to it.
    const blocked = new Set(RING_3.filter((cell) => cell !== GATE));
    const open = reachableFrom(ORIGIN, FIELD, {
      canStep: (_from, to) => !blocked.has(to),
    });

    expect(open.has(GATE)).toBe(true);
    expect(open.has(OUTSIDE)).toBe(true);
    for (const cell of blocked) expect(open.has(cell)).toBe(false);
  });
});
