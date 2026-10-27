/**
 * Tests for the recorder's fixed-view sweep with editor-style items.
 *
 * Why this file matters: the sweep is what a phone runs from ONE link to
 * tell whether the full globe look still holds the frame budget with a
 * tour's items in it. Its numbers are only comparable across devices and
 * runs if the plan (views, item counts, repeats, order) is fixed by the
 * hash alone, the items stand where the camera sees them, and the table
 * pools the repeats the same way every time; a malformed hash must fall
 * back to "no sweep", never to a half-read plan.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  PERF_VIEWS,
  formatViewTable,
  itemOffsets,
  parsePerfItems,
  perfViewCells,
  perfViewsEstimateMs,
  summariseViewRuns,
  viewRunLabel,
} from "./globe-perf-views.js";

describe("PERF_VIEWS", () => {
  it("runs from space down to street level, each view named once", () => {
    assert.deepEqual(
      PERF_VIEWS.map((v) => v.id),
      ["space", "100km", "10km", "1km", "street"],
    );
    // From space the height is over the ellipsoid; every other view is
    // over the ground, so a city on a plateau is seen as one at sea level.
    assert.equal(PERF_VIEWS[0].altitudeM, 20_000_000);
    assert.deepEqual(
      PERF_VIEWS.slice(1, 4).map((v) => v.aglM),
      [100_000, 10_000, 1_000],
    );
    assert.equal(PERF_VIEWS[4].street, true);
  });
});

describe("parsePerfItems", () => {
  it("reads a comma list as unique ascending counts", () => {
    assert.deepEqual(parsePerfItems("50,5,20,5"), [5, 20, 50]);
    assert.deepEqual(parsePerfItems("0"), [0]);
  });
  it("reads absent, empty or malformed text as no sweep", () => {
    for (const text of [
      null,
      "",
      " ",
      "5,x",
      "-1",
      "2.5",
      "201",
      "1,2,3,4,5,6,7",
    ]) {
      assert.equal(parsePerfItems(text), null, String(text));
    }
  });
});

describe("perfViewCells", () => {
  it("orders repeats, then views, then item counts", () => {
    const cells = perfViewCells({ items: [5, 20], repeats: 2 });
    assert.equal(cells.length, 2 * PERF_VIEWS.length * 2);
    assert.deepEqual(cells.slice(0, 3), [
      { repeat: 1, view: "space", items: 5 },
      { repeat: 1, view: "space", items: 20 },
      { repeat: 1, view: "100km", items: 5 },
    ]);
    assert.deepEqual(cells.at(-1), { repeat: 2, view: "street", items: 20 });
  });
  it("refuses a repeat count that is not a positive integer", () => {
    assert.throws(() => perfViewCells({ items: [5], repeats: 0 }), RangeError);
    assert.throws(
      () => perfViewCells({ items: [5], repeats: 1.5 }),
      RangeError,
    );
  });
  it("labels each cell by view, count and repeat", () => {
    assert.equal(
      viewRunLabel({ repeat: 3, view: "street", items: 50 }),
      "street n=50 r3",
    );
  });
});

describe("perfViewsEstimateMs", () => {
  it("is an upper bound: every move settles to its timeout, every cell holds", () => {
    const cells = perfViewCells({ items: [5, 20, 50], repeats: 3 });
    // 3 repeats x 5 views = 15 moves; 45 holds.
    assert.equal(
      perfViewsEstimateMs(cells, { holdMs: 5_000, settleMs: 20_000 }),
      15 * 20_000 + 45 * 5_000,
    );
  });
});

describe("itemOffsets", () => {
  it("places n distinct items around the centre, none closer than the spacing's half", () => {
    const offsets = itemOffsets(50, 6);
    assert.equal(offsets.length, 50);
    for (let i = 0; i < offsets.length; i++) {
      for (let j = i + 1; j < offsets.length; j++) {
        const d = Math.hypot(
          offsets[i].eastM - offsets[j].eastM,
          offsets[i].northM - offsets[j].northM,
        );
        assert.ok(d > 3, `items ${i} and ${j} are ${d.toFixed(2)} m apart`);
      }
    }
  });
  it("keeps 50 items within a street's reach (about 50 m), the first near the centre", () => {
    const offsets = itemOffsets(50, 6);
    const far = Math.max(...offsets.map((o) => Math.hypot(o.eastM, o.northM)));
    assert.ok(far < 50, `farthest ${far.toFixed(1)} m`);
    assert.ok(Math.hypot(offsets[0].eastM, offsets[0].northM) < 6);
  });
  it("is deterministic and the first n of a larger set", () => {
    assert.deepEqual(itemOffsets(5, 6), itemOffsets(20, 6).slice(0, 5));
    assert.deepEqual(itemOffsets(0, 6), []);
  });
  it("refuses a bad count or spacing", () => {
    assert.throws(() => itemOffsets(-1, 6), RangeError);
    assert.throws(() => itemOffsets(2.5, 6), RangeError);
    assert.throws(() => itemOffsets(5, 0), RangeError);
  });
});

/** A run as the recorder finishes it, reduced to what the table reads. */
const run = (view, items, repeat, p50, p95, max, over50, voided = false) => ({
  cell: { view, items, repeat },
  voided,
  bytes: 1_048_576 * repeat,
  summary: {
    stats: {
      count: 300,
      p50Ms: p50,
      p95Ms: p95,
      maxMs: max,
      over: [
        { thresholdMs: 33, count: over50 + 1 },
        { thresholdMs: 50, count: over50 },
      ],
    },
  },
});

describe("summariseViewRuns", () => {
  it("pools the repeats of one view and count: median p50 and p95, worst max, summed long frames", () => {
    const rows = summariseViewRuns([
      run("street", 20, 1, 10, 20, 40, 0),
      run("street", 20, 2, 12, 26, 70, 2),
      run("street", 20, 3, 11, 22, 45, 0),
      run("space", 5, 1, 8, 9, 12, 0),
    ]);
    assert.deepEqual(rows, [
      {
        view: "space",
        items: 5,
        runs: 1,
        voided: 0,
        p50Ms: 8,
        p95Ms: 9,
        maxMs: 12,
        over33: 1,
        over50: 0,
        bytesMiB: 1,
      },
      {
        view: "street",
        items: 20,
        runs: 3,
        voided: 0,
        p50Ms: 11,
        p95Ms: 22,
        maxMs: 70,
        over33: 5,
        over50: 2,
        bytesMiB: 3,
      },
    ]);
  });
  it("leaves voided runs out of the numbers but counts them", () => {
    const [row] = summariseViewRuns([
      run("1km", 50, 1, 10, 20, 30, 0),
      run("1km", 50, 2, 99, 99, 999, 9, true),
    ]);
    assert.equal(row.runs, 1);
    assert.equal(row.voided, 1);
    assert.equal(row.maxMs, 30);
  });
  it("orders rows by the views' order, then the count", () => {
    const rows = summariseViewRuns([
      run("street", 5, 1, 1, 1, 1, 0),
      run("10km", 50, 1, 1, 1, 1, 0),
      run("10km", 5, 1, 1, 1, 1, 0),
    ]);
    assert.deepEqual(
      rows.map((r) => `${r.view}/${r.items}`),
      ["10km/5", "10km/50", "street/5"],
    );
  });
});

describe("formatViewTable", () => {
  it("prints one line per row under a header", () => {
    const text = formatViewTable(
      summariseViewRuns([run("street", 20, 1, 10.04, 20.5, 40, 0)]),
    );
    const lines = text.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /view\s+n\s+p50\s+p95\s+max\s+>33\s+>50\s+MiB/);
    // The run's 1 frame over 33 ms, none over 50, 1 MiB.
    assert.match(
      lines[1],
      /^street\s+20\s+10\.0\s+20\.5\s+40\.0\s+1\s+0\s+1\.0$/,
    );
  });
});
