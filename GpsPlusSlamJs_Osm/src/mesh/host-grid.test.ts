import { describe, expect, it } from "vitest";

import { buildHostGrid, type CandidateBounds } from "./host-grid.js";

/**
 * WHY THESE TESTS MATTER. This grid replaced an exhaustive scan, and the scan
 * was CORRECT — so every defect this index can introduce is a silent one. There
 * are exactly two, and both are covered here rather than left to the caller's
 * suite:
 *
 *  - **A false negative** drops a host. A marker that should have been lifted
 *    onto a roof stays at its node, which looks like ordinary OSM data rather
 *    than a bug. The exhaustive-scan comparison below and the property test
 *    beside it exist for this and nothing else.
 *  - **A reordering** changes WHICH host wins. `annotatePoiHosts` orders
 *    candidates buildings-first and the caller takes the first enabled host, so
 *    a café inside a building on a landuse plate would be re-anchored to the
 *    plate instead. The output still looks plausible, which is what makes it
 *    dangerous.
 *
 * The MERGE is where both failures are most likely, because it is the one path
 * that combines several sources — the grid's levels and the oversized backstop —
 * and it is the only place candidate order can be lost.
 */

/** A box centred on `(x, y)`, `size` metres across. */
function box(x: number, y: number, size: number): CandidateBounds {
  const half = size / 2;
  return { minX: x - half, maxX: x + half, minY: y - half, maxY: y + half };
}

/** Every index whose bounds contain the point — the answer the scan gives. */
function scan(
  bounds: readonly CandidateBounds[],
  point: { x: number; y: number },
): number[] {
  const out: number[] = [];
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i] as CandidateBounds;
    if (
      point.x >= b.minX &&
      point.x <= b.maxX &&
      point.y >= b.minY &&
      point.y <= b.maxY
    ) {
      out.push(i);
    }
  }
  return out;
}

describe("buildHostGrid", () => {
  it("returns a superset of the exhaustive scan, so no host is ever dropped", () => {
    // The grid is allowed to over-return (the caller re-checks the real
    // predicate); it is never allowed to under-return.
    const bounds = [
      box(0, 0, 10),
      box(100, 0, 10),
      box(0, 100, 10),
      box(50, 50, 200), // overlaps everything above
    ];
    const grid = buildHostGrid(bounds);
    for (const point of [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 50, y: 50 },
      { x: -500, y: -500 },
    ]) {
      const hits = grid.candidatesAt(point);
      for (const expected of scan(bounds, point)) {
        expect(
          hits,
          `missing ${String(expected)} at ${JSON.stringify(point)}`,
        ).toContain(expected);
      }
    }
  });

  it("returns indices in ASCENDING order, which decides which host wins", () => {
    const bounds = [box(0, 0, 40), box(0, 0, 30), box(0, 0, 20), box(0, 0, 10)];
    const hits = [...buildHostGrid(bounds).candidatesAt({ x: 0, y: 0 })];
    expect(hits).toEqual([...hits].sort((a, b) => a - b));
  });

  it("keeps ascending order across a MERGE, not a concatenation", () => {
    // THE REGRESSION THIS PINS. Candidate 0 lands somewhere other than
    // candidate 1 — a coarser level, or the oversized backstop — and its list is
    // therefore a separate source. Appending rather than merging would put
    // index 0 after index 1, and index 0 is the building that should have won.
    //
    // Candidate 0 is deliberately enormous, so it cannot share candidate 1's
    // level whatever pitch these bounds produce.
    const bounds = [
      { minX: -100_000, maxX: 100_000, minY: -100_000, maxY: 100_000 },
      box(0, 0, 10),
    ];
    const hits = [...buildHostGrid(bounds).candidatesAt({ x: 0, y: 0 })];
    expect(hits).toEqual([0, 1]);
  });

  it("returns an oversized candidate even where every level holds nothing", () => {
    // The backstop is unconditional: it has no cell to be looked up by, so
    // forgetting it on a cell miss would drop exactly the biggest hosts.
    //
    // The small candidates are spread far enough apart that the mean extent —
    // and therefore the pitch — stays small, which is what makes the queried
    // cell genuinely empty. An earlier version of this test used ONE small box
    // and asserted the oversized candidate came back ALONE; that failed, and
    // the code was right: with a 200 km box in the set the mean extent is
    // 200 km, so every point in the fixture shares one cell. Worth recording,
    // because it is the pitch heuristic behaving exactly as documented.
    const bounds: CandidateBounds[] = [
      { minX: -100_000, maxX: 100_000, minY: -100_000, maxY: 100_000 },
    ];
    for (let i = 0; i < 50; i++) bounds.push(box(i * 40, 0, 10));
    const hits = [
      ...buildHostGrid(bounds).candidatesAt({ x: 9_000, y: -9_000 }),
    ];
    expect(hits).toEqual([0]);
  });

  it("never indexes an inverted box, because it contains nothing", () => {
    // `footprintAnchor` returns min > max for an EMPTY footprint. Letting one
    // into the grid would produce a negative cell span; returning it would hand
    // the caller a candidate its own bounds check is guaranteed to reject.
    const bounds: CandidateBounds[] = [
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      box(0, 0, 10),
    ];
    expect([...buildHostGrid(bounds).candidatesAt({ x: 0, y: 0 })]).toEqual([
      1,
    ]);
  });

  it("answers on an empty candidate list without a special case", () => {
    expect([...buildHostGrid([]).candidatesAt({ x: 0, y: 0 })]).toEqual([]);
  });

  it("handles negative coordinates, which are half of every ENU frame", () => {
    // The cell key packs col and row into one integer; an offset that was too
    // small would collide the negative half onto the positive one. ENU is
    // centred on the frame origin, so this is the ordinary case, not an edge.
    const bounds = [box(-2000, -2000, 10), box(2000, 2000, 10)];
    const grid = buildHostGrid(bounds);
    expect([...grid.candidatesAt({ x: -2000, y: -2000 })]).toEqual([0]);
    expect([...grid.candidatesAt({ x: 2000, y: 2000 })]).toEqual([1]);
  });

  it("prunes: a marker does not meet candidates on the other side of the city", () => {
    // The whole point, asserted as a count rather than a clock. Without pruning
    // this is 400; the grid must return a small constant.
    const bounds: CandidateBounds[] = [];
    for (let i = 0; i < 400; i++) bounds.push(box(i * 50, 0, 10));
    const hits = buildHostGrid(bounds).candidatesAt({ x: 0, y: 0 });
    expect(hits.length).toBeLessThan(20);
    expect([...hits]).toContain(0);
  });
});
