/**
 * Tests for the recorder's fixed-view sweep with editor-style items.
 *
 * Why this file matters: the sweep is what a phone runs from ONE link to
 * tell whether the full globe look still holds the frame budget with a
 * tour's items in it. Its numbers are only comparable across devices and
 * runs if the plan (views, item counts, repeats, order) is fixed by the
 * hash alone, the items stand where the camera sees them, and the table
 * pools the repeats the same way every time; a malformed hash must fall
 * back to "no sweep", never to a half-read plan. A run that is not fair
 * (held while the view still loads, always first after a move) must not
 * decide a row.
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
  snapRefreshInterval,
  summariseViewDownloads,
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
  it("reads a comma list as unique ascending counts, 0 the baseline", () => {
    assert.deepEqual(parsePerfItems("50,5,20,5"), [5, 20, 50]);
    assert.deepEqual(parsePerfItems("0"), [0]);
    assert.deepEqual(parsePerfItems("0,5,20,50"), [0, 5, 20, 50]);
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
  it("opens with a discarded warm-up pass, one cell per view at the largest count", () => {
    const cells = perfViewCells({ items: [5, 20], repeats: 2 });
    const warm = cells.filter((c) => c.warmup);
    assert.deepEqual(
      warm,
      PERF_VIEWS.map((v) => ({
        repeat: 0,
        view: v.id,
        items: 20,
        warmup: true,
      })),
    );
    // The warm-up comes first, then every repeat holds every view and count.
    assert.equal(cells.indexOf(warm.at(-1)), warm.length - 1);
    assert.equal(cells.length, PERF_VIEWS.length + 2 * PERF_VIEWS.length * 2);
    assert.equal(cells.at(-1).view, "street");
  });
  it("leaves the warm-up out on request", () => {
    const cells = perfViewCells({ items: [5], repeats: 1, warmup: false });
    assert.equal(cells.filter((c) => c.warmup).length, 0);
    assert.equal(cells.length, PERF_VIEWS.length);
  });
  // WHY: the counts must not run in one fixed order inside a view, or the
  // first count always pays what is left of the move (a cache release, a
  // late tile) and the count is confounded with the time since the move.
  // Each count takes each position once over as many repeats as counts,
  // at every view, and the views of one repeat start on different counts.
  it("rotates the counts' order per repeat and per view", () => {
    const items = [0, 5, 20, 50];
    const cells = perfViewCells({ items, repeats: 4, warmup: false });
    const orderOf = (repeat, view) =>
      cells
        .filter((c) => c.repeat === repeat && c.view === view)
        .map((c) => c.items);
    for (const view of PERF_VIEWS.map((v) => v.id)) {
      for (let pos = 0; pos < items.length; pos++) {
        const atPos = [1, 2, 3, 4].map((r) => orderOf(r, view)[pos]);
        assert.deepEqual(
          [...atPos].sort((a, b) => a - b),
          items,
          view,
        );
      }
    }
    const firsts = PERF_VIEWS.slice(0, 4).map((v) => orderOf(1, v.id)[0]);
    assert.deepEqual(
      [...firsts].sort((a, b) => a - b),
      items,
    );
    assert.deepEqual(orderOf(1, "space"), [0, 5, 20, 50]);
    assert.deepEqual(orderOf(2, "space"), [5, 20, 50, 0]);
  });
  it("holds only the views it is given (street needs eye mode)", () => {
    const views = PERF_VIEWS.filter((v) => !v.street);
    const cells = perfViewCells({ items: [5], repeats: 1, views });
    assert.ok(cells.every((c) => c.view !== "street"));
    assert.equal(cells.length, 2 * views.length);
  });
  it("refuses a repeat count that is not a positive integer", () => {
    assert.throws(() => perfViewCells({ items: [5], repeats: 0 }), RangeError);
    assert.throws(
      () => perfViewCells({ items: [5], repeats: 1.5 }),
      RangeError,
    );
  });
  it("labels each cell by view, count and repeat, the warm-up as such", () => {
    assert.equal(
      viewRunLabel({ repeat: 3, view: "street", items: 50 }),
      "street n=50 r3",
    );
    assert.equal(
      viewRunLabel({ repeat: 0, view: "space", items: 50, warmup: true }),
      "space n=50 warm",
    );
  });
});

describe("perfViewsEstimateMs", () => {
  it("adds the calibration, every move's settle and every cell's hold", () => {
    const cells = perfViewCells({ items: [5, 20, 50], repeats: 3 });
    // 1 warm-up pass + 3 repeats = 20 moves; 5 warm-up cells + 45 holds.
    assert.equal(
      perfViewsEstimateMs(cells, {
        holdMs: 5_000,
        settleMs: 20_000,
        calibrateMs: 2_000,
      }),
      2_000 + 20 * 20_000 + 50 * 5_000,
    );
  });
});

describe("snapRefreshInterval", () => {
  // WHY: the dropped-frame counts divide by the refresh interval, so a
  // calibration that read the scene's own frame time (35 ms) in place of
  // the display's would count about half the dropped frames. A display
  // runs at one of a few rates; the measurement is snapped to the nearest
  // and a poor fit is flagged, so a 30 Hz battery saver is told apart from
  // a busy page.
  it("snaps to the nearest of 30, 60, 90 and 120 Hz", () => {
    assert.deepEqual(snapRefreshInterval(16.4), {
      measuredMs: 16.4,
      hz: 60,
      intervalMs: 1000 / 60,
      mismatch: false,
    });
    assert.equal(snapRefreshInterval(8.4).hz, 120);
    assert.equal(snapRefreshInterval(11.2).hz, 90);
    assert.equal(snapRefreshInterval(33.1).hz, 30);
  });
  it("flags a measurement more than 10 % off the rate it snapped to", () => {
    assert.equal(snapRefreshInterval(25).mismatch, true);
    assert.equal(snapRefreshInterval(37).mismatch, true);
    assert.equal(snapRefreshInterval(17.5).mismatch, false);
  });
  it("is null without a usable measurement", () => {
    for (const v of [null, undefined, 0, -1, NaN, Infinity]) {
      assert.equal(snapRefreshInterval(v), null, String(v));
    }
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
const run = (
  view,
  items,
  repeat,
  { p50 = 10, p95 = 20, max = 30, over34 = 0, over51 = 0, dropped = 0 } = {},
  extra = {},
) => ({
  cell: { view, items, repeat },
  voided: false,
  settledBefore: true,
  work: { insideMs: 4 * 300, frames: 300 },
  itemsWarm: { maxFrameMs: 40, frames: 20, programs: 1 },
  summary: {
    stats: {
      count: 300,
      p50Ms: p50,
      p95Ms: p95,
      maxMs: max,
      droppedFrames: dropped,
      over: [
        { thresholdMs: 33, count: over34 + 1 },
        { thresholdMs: 34, count: over34 },
        { thresholdMs: 50, count: over51 + 1 },
        { thresholdMs: 51, count: over51 },
      ],
    },
  },
  ...extra,
});

describe("summariseViewRuns", () => {
  it("pools the repeats of one view and count: median p50, p95 and work, worst max, summed counts", () => {
    const rows = summariseViewRuns([
      run("street", 20, 1, { p50: 10, p95: 20, max: 40, dropped: 3 }),
      run(
        "street",
        20,
        2,
        { p50: 12, p95: 26, max: 70, over34: 2, over51: 1, dropped: 9 },
        { work: { insideMs: 6 * 100, frames: 100 } },
      ),
      run("street", 20, 3, { p50: 11, p95: 22, max: 45 }),
      run("space", 5, 1, { p50: 8, p95: 9, max: 12 }),
    ]);
    assert.deepEqual(rows, [
      {
        view: "space",
        items: 5,
        runs: 1,
        voided: 0,
        timedOut: 0,
        p50Ms: 8,
        p95Ms: 9,
        maxMs: 12,
        workMs: 4,
        dropped: 0,
        over33: 1,
        over34: 0,
        over50: 1,
        over51: 0,
        itemsWarmMaxMs: 40,
      },
      {
        view: "street",
        items: 20,
        runs: 3,
        voided: 0,
        timedOut: 0,
        p50Ms: 11,
        p95Ms: 22,
        maxMs: 70,
        workMs: 4,
        dropped: 12,
        over33: 5,
        over34: 2,
        over50: 4,
        over51: 1,
        itemsWarmMaxMs: 40,
      },
    ]);
  });
  it("leaves voided runs out of the numbers but counts them", () => {
    const [row] = summariseViewRuns([
      run("1km", 50, 1, { max: 30 }),
      run("1km", 50, 2, { p50: 99, max: 999, over51: 9 }, { voided: true }),
    ]);
    assert.equal(row.runs, 1);
    assert.equal(row.voided, 1);
    assert.equal(row.maxMs, 30);
  });
  // WHY: a run whose settle timed out holds a view that was still loading
  // (tiles, the city, a cache drain): its long frames are the load's, not
  // the items'. Pooled, they decided the max and the long-frame counts.
  it("counts runs whose settle timed out apart and keeps them out of every number", () => {
    const [row] = summariseViewRuns([
      run("street", 5, 1, { p95: 20, max: 30 }),
      run(
        "street",
        5,
        2,
        { p95: 80, max: 900, over34: 40, over51: 20, dropped: 99 },
        { settledBefore: false },
      ),
    ]);
    assert.equal(row.runs, 1);
    assert.equal(row.timedOut, 1);
    assert.equal(row.maxMs, 30);
    assert.equal(row.p95Ms, 20);
    assert.equal(row.over51, 0);
    assert.equal(row.dropped, 0);
  });
  it("leaves the warm-up pass out entirely", () => {
    const rows = summariseViewRuns([
      run(
        "space",
        50,
        0,
        { max: 999 },
        { cell: { view: "space", items: 50, repeat: 0, warmup: true } },
      ),
      run("space", 50, 1, { max: 30 }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].runs, 1);
    assert.equal(rows[0].maxMs, 30);
  });
  it("orders rows by the views' order, then the count", () => {
    const rows = summariseViewRuns([
      run("street", 5, 1),
      run("10km", 50, 1),
      run("10km", 5, 1),
    ]);
    assert.deepEqual(
      rows.map((r) => `${r.view}/${r.items}`),
      ["10km/5", "10km/50", "street/5"],
    );
  });
});

describe("summariseViewDownloads", () => {
  // WHY: the bytes counter is cumulative over the page's life, so a
  // per-row maximum read the boot's download as every view's. A camera
  // move's own download is what that view costs.
  it("is each move's download: the counter after its last run minus at its move", () => {
    const moved = (view, items, repeat, atMove, after) =>
      run(
        view,
        items,
        repeat,
        {},
        { bytesAtMove: atMove * 2 ** 20, bytes: after * 2 ** 20 },
      );
    assert.deepEqual(
      summariseViewDownloads([
        moved("space", 5, 1, 9, 9.5),
        moved("space", 20, 1, 9, 10),
        moved("street", 5, 1, 10, 14.4),
        moved("space", 5, 2, 14.4, 14.4),
      ]),
      [
        { view: "space", repeat: 1, mib: 1 },
        { view: "street", repeat: 1, mib: 4.4 },
        { view: "space", repeat: 2, mib: 0 },
      ],
    );
  });
});

describe("formatViewTable", () => {
  it("prints one line per row under a header, then the display's rate and the downloads", () => {
    const rows = summariseViewRuns([
      run("street", 20, 1, {
        p50: 10.04,
        p95: 20.5,
        max: 40,
        over34: 1,
        dropped: 2,
      }),
    ]);
    const text = formatViewTable(rows, {
      refresh: snapRefreshInterval(16.5),
      downloads: [{ view: "street", repeat: 1, mib: 4.4 }],
    });
    const lines = text.split("\n");
    assert.match(
      lines[0],
      /view\s+n\s+p50\s+p95\s+max\s+work\s+drop\s+>34\s+>51/,
    );
    assert.match(
      lines[1],
      /^street\s+20\s+10\.0\s+20\.5\s+40\.0\s+4\.0\s+2\s+1\s+0$/,
    );
    assert.match(text, /display 60 Hz \(measured 16\.5 ms\): a frame 16\.7 ms/);
    assert.match(text, /street r1 4\.4/);
  });
  it("names timed-out and voided runs on their row, and a calibration that does not fit", () => {
    const rows = summariseViewRuns([
      run("1km", 5, 1),
      run("1km", 5, 2, {}, { settledBefore: false }),
      run("1km", 5, 3, {}, { voided: true }),
    ]);
    const text = formatViewTable(rows, { refresh: snapRefreshInterval(25) });
    assert.match(text.split("\n")[1], /\(1 void, 1 timed out\)$/);
    assert.match(text, /does not fit/);
  });
});
