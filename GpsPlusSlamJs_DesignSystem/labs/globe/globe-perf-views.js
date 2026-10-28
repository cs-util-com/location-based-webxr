/**
 * The frame-time recorder's fixed-view sweep (`#perf=1&perfItems=0,5,20,50`):
 * the full look held at five views, from space down to street level, with
 * editor-style items standing at the place, each view and item count held
 * a few seconds and repeated, so one link on a phone measures what an
 * editor on the globe would cost. Pure: the plan, the items' layout, the
 * display's refresh and the table; `globe-perf.js` runs it and
 * `globe-lab.js` places the camera and the items.
 *
 * @see globe-perf-views.js.md
 */

/**
 * The views, in the order a sweep visits them: from space the height is
 * over the ellipsoid (the whole disc in view); the next three over the
 * ground at the place, pitched by the flight's law; street level is an
 * eye height over the ground, standing back from the items and looking
 * at them.
 */
export const PERF_VIEWS = Object.freeze([
  Object.freeze({ id: "space", altitudeM: 20_000_000 }),
  Object.freeze({ id: "100km", aglM: 100_000 }),
  Object.freeze({ id: "10km", aglM: 10_000 }),
  Object.freeze({ id: "1km", aglM: 1_000 }),
  Object.freeze({ id: "street", street: true }),
]);

/** The sweep's limits and defaults. */
export const PERF_VIEWS_LIMITS = Object.freeze({
  /** At most this many items in one cell. */
  maxItems: 200,
  /** At most this many item counts in one sweep. */
  maxCounts: 6,
  /** The items' spacing (m): the spiral's scale. */
  spacingM: 6,
});

/**
 * The item counts from the hash's `perfItems` text ("0,5,20,50"): unique
 * and ascending, each a whole number from 0 (the baseline without items)
 * to `maxItems`, at most `maxCounts` of them. Absent, empty or malformed
 * text is null (no sweep), never a partly read list.
 */
export function parsePerfItems(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  const parts = text.split(",").map((p) => p.trim());
  if (!parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const counts = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  if (counts.length > PERF_VIEWS_LIMITS.maxCounts) return null;
  return counts.every((n) => n <= PERF_VIEWS_LIMITS.maxItems) ? counts : null;
}

/**
 * The sweep's cells: a discarded warm-up pass (repeat 0, one cell per view
 * at the largest count, so the first measured repeat finds each view's
 * tiles loaded and the scene's own programs compiled, as every later
 * repeat does; not the items' programs: a count of 0 disposes the items'
 * materials, so each count's first frames compile them again, which its
 * `itemsWarm` records apart), then for each repeat each view in order
 * with every item count. One camera move per view and repeat; the counts
 * change only the items. Inside a view the counts' order starts at a count
 * rotated by the repeat and the view's index, so no count is always the
 * first after a move; odd repeats go forward through the counts, even
 * repeats backward, so no count always follows the same one (forward
 * only, 0 always followed 50 and paid its disposal). For an even number
 * of counts each count takes each position once over as many repeats as
 * counts. `views` defaults to every view (street level needs eye mode;
 * the recorder leaves it out without). RangeError for a repeat count that
 * is not a positive integer, an empty view list or no counts.
 */
export function perfViewCells({
  items,
  repeats,
  views = PERF_VIEWS,
  warmup = true,
}) {
  if (!(Number.isInteger(repeats) && repeats > 0)) {
    throw new RangeError(`repeats must be a positive integer, got ${repeats}`);
  }
  if (!(views.length > 0)) throw new RangeError("the sweep needs a view");
  if (!(items.length > 0)) throw new RangeError("the sweep needs a count");
  const cells = [];
  if (warmup && items.length > 0) {
    const most = Math.max(...items);
    for (const view of views) {
      cells.push({ repeat: 0, view: view.id, items: most, warmup: true });
    }
  }
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const n = items.length;
    const step = repeat % 2 === 1 ? 1 : -1;
    views.forEach((view, v) => {
      const shift = (repeat - 1 + v) % n;
      for (let k = 0; k < n; k++) {
        cells.push({
          repeat,
          view: view.id,
          items: items[(((shift + step * k) % n) + n) % n],
        });
      }
    });
  }
  return cells;
}

/** A cell's run label: view, item count and repeat (or `warm`). */
export const viewRunLabel = (cell) =>
  `${cell.view} n=${cell.items} ${cell.warmup ? "warm" : `r${cell.repeat}`}`;

/**
 * An estimate of the sweep's length (ms), not a bound: the calibration,
 * every camera move waiting its whole settle timeout and every cell
 * holding `holdMs` (the caller folds each cell's warm-up into `holdMs`).
 * The quiet waits before each run, a city that is waited for and slow
 * frames are not in it.
 */
export function perfViewsEstimateMs(
  cells,
  { holdMs, settleMs, calibrateMs = 0 },
) {
  const moves = new Set(cells.map((c) => `${c.repeat}/${c.view}`)).size;
  return calibrateMs + moves * settleMs + cells.length * holdMs;
}

/** The refresh rates a display runs at (Hz), which a calibration snaps to. */
export const PERF_REFRESH_HZ = Object.freeze([30, 60, 90, 120]);

/**
 * The display's refresh from a calibration's median interval (ms):
 * `{ measuredMs, hz, intervalMs, mismatch }`, snapped to the nearest of
 * `PERF_REFRESH_HZ`; `mismatch` when the measurement is more than 10 % off
 * the interval it snapped to (a page too busy to calibrate, or a rate not
 * in the list). Null without a usable measurement (null, not finite, not
 * > 0).
 */
export function snapRefreshInterval(measuredMs) {
  if (!(Number.isFinite(measuredMs) && measuredMs > 0)) return null;
  let hz = PERF_REFRESH_HZ[0];
  for (const candidate of PERF_REFRESH_HZ) {
    const off = Math.abs(1000 / candidate - measuredMs);
    if (off < Math.abs(1000 / hz - measuredMs)) hz = candidate;
  }
  const intervalMs = 1000 / hz;
  return {
    measuredMs,
    hz,
    intervalMs,
    mismatch: Math.abs(measuredMs - intervalMs) / intervalMs > 0.1,
  };
}

/** Where the missed-refresh thresholds sit, in refresh intervals. */
const MISSED_AT = Object.freeze([1.5, 2.5, 3.5]);

/**
 * The thresholds (ms) a frame interval must exceed to count as one, two
 * and three missed refreshes: 1.5, 2.5 and 3.5 intervals, halfway between
 * the multiples a frame lands on, so jitter does not move a frame across
 * one, and the counts mean the same on a 30, 60, 90 or 120 Hz display.
 * Rounded to 0.1 ms. Null for an interval that is not finite and > 0.
 */
export function missedThresholdsMs(intervalMs) {
  if (!(Number.isFinite(intervalMs) && intervalMs > 0)) return null;
  return MISSED_AT.map((k) => Math.round(k * intervalMs * 10) / 10);
}

/** The golden angle (rad): a sunflower's spiral never lines items up. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Where `n` items stand around the place, metres east and north: a
 * sunflower spiral of `spacingM`, so they are spread evenly, the first
 * near the centre, and the first `n` of any larger set are the same.
 * RangeError for a count that is not a whole number >= 0 or a spacing
 * that is not finite and > 0.
 */
export function itemOffsets(n, spacingM = PERF_VIEWS_LIMITS.spacingM) {
  if (!(Number.isInteger(n) && n >= 0)) {
    throw new RangeError(
      `the item count must be a whole number >= 0, got ${n}`,
    );
  }
  if (!(spacingM > 0 && Number.isFinite(spacingM))) {
    throw new RangeError(`the spacing must be finite and > 0, got ${spacingM}`);
  }
  return Array.from({ length: n }, (_, k) => {
    const r = spacingM * Math.sqrt(k + 0.5);
    const a = k * GOLDEN_ANGLE;
    return { eastM: r * Math.sin(a), northM: r * Math.cos(a) };
  });
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const overAt = (stats, ms) =>
  stats.over.find((o) => o.thresholdMs === ms)?.count ?? 0;
const sumOf = (list, read) => list.reduce((sum, x) => sum + read(x), 0);
/** Frames over the run's `i`th missed threshold, null without one. */
const missedAt = (r, i) =>
  Array.isArray(r.missedMs) ? overAt(r.summary.stats, r.missedMs[i]) : null;
/** The runs' missed counts summed; null when any run has none. */
const sumMissed = (list, i) => {
  const counts = list.map((r) => missedAt(r, i));
  return counts.some((c) => c === null) ? null : sumOf(counts, (c) => c);
};
const viewIndex = (id) => PERF_VIEWS.findIndex((v) => v.id === id);

/**
 * One row per view and item count, in the views' order, then the count:
 * the pooled runs' median p50, p95 and work per frame (the frame
 * callback's own time, ms), the worst frame, the refreshes dropped, the
 * frames over 33 and 50 ms and the frames that missed at least 1, 2 and 3
 * refreshes (over each run's `missedMs`, `missedThresholdsMs`; null when
 * a run has none) summed, and the items' worst warm-up frame. Pooled are the runs that were neither voided (a touch, the page
 * hidden, a lost context) nor held after a settle that timed out; those
 * are counted (`voided`, `timedOut`) and kept out of every number. The
 * warm-up pass is left out entirely. `runs` are the recorder's finished
 * runs with `cell`, `settledBefore`, `work`, `itemsWarm` and `missedMs`.
 */
export function summariseViewRuns(runs) {
  const groups = new Map();
  for (const r of runs) {
    if (r.cell.warmup) continue;
    const key = `${r.cell.view}/${r.cell.items}`;
    if (!groups.has(key)) {
      groups.set(key, { view: r.cell.view, items: r.cell.items, list: [] });
    }
    groups.get(key).list.push(r);
  }
  return [...groups.values()]
    .sort((a, b) => viewIndex(a.view) - viewIndex(b.view) || a.items - b.items)
    .map(({ view, items, list }) => {
      const counted = list.filter(
        (r) => !r.voided && r.summary.stats.count > 0,
      );
      const kept = counted.filter((r) => r.settledBefore !== false);
      const stats = kept.map((r) => r.summary.stats);
      const some = kept.length > 0;
      const work = kept
        .filter((r) => r.work?.frames > 0)
        .map((r) => r.work.insideMs / r.work.frames);
      const warm = kept
        .map((r) => r.itemsWarm?.maxFrameMs)
        .filter((ms) => Number.isFinite(ms));
      return {
        view,
        items,
        runs: kept.length,
        voided: list.length - counted.length,
        timedOut: counted.length - kept.length,
        p50Ms: some ? median(stats.map((s) => s.p50Ms)) : null,
        p95Ms: some ? median(stats.map((s) => s.p95Ms)) : null,
        maxMs: some ? Math.max(...stats.map((s) => s.maxMs)) : null,
        workMs: work.length ? +median(work).toFixed(2) : null,
        dropped: sumOf(stats, (s) => s.droppedFrames ?? 0),
        over33: sumOf(stats, (s) => overAt(s, 33)),
        over50: sumOf(stats, (s) => overAt(s, 50)),
        missed1: sumMissed(kept, 0),
        missed2: sumMissed(kept, 1),
        missed3: sumMissed(kept, 2),
        itemsWarmMaxMs: warm.length ? Math.max(...warm) : null,
      };
    });
}

/**
 * Each camera move's own download (MiB): the bytes counter after the
 * move's last run minus the counter at the move (`bytesAtMove`), in the
 * sweep's order, the warm-up pass included (where a cold page downloads
 * most). The counter is the caller's; runs without both numbers are
 * skipped.
 */
export function summariseViewDownloads(runs) {
  const moves = new Map();
  for (const r of runs) {
    if (!(Number.isFinite(r.bytesAtMove) && Number.isFinite(r.bytes))) {
      continue;
    }
    const key = `${r.cell.repeat}/${r.cell.view}`;
    const m = moves.get(key) ?? {
      view: r.cell.view,
      repeat: r.cell.repeat,
      at: r.bytesAtMove,
      after: r.bytes,
    };
    m.after = Math.max(m.after, r.bytes);
    moves.set(key, m);
  }
  return [...moves.values()].map((m) => ({
    view: m.view,
    repeat: m.repeat,
    mib: +(Math.max(0, m.after - m.at) / 2 ** 20).toFixed(1),
  }));
}

/** A number with `decimals`, "-" for none, padded to `width`. */
const col = (value, width, decimals = 0) =>
  (value === null ? "-" : value.toFixed(decimals)).padEnd(width);

/**
 * The table as text for the overlay and the export: one line per row, then
 * what the columns are, the display's rate the long frames are read
 * against (`refresh`, from `snapRefreshInterval`) and each move's download
 * (`downloads`, from `summariseViewDownloads`), when given.
 */
export function formatViewTable(rows, { refresh = null, downloads = [] } = {}) {
  const header = "view    n    p50    p95    max     work  drop >=1  >=2  >=3";
  const lines = rows.map((r) => {
    const apart = [
      r.voided ? `${r.voided} void` : null,
      r.timedOut ? `${r.timedOut} timed out` : null,
    ].filter(Boolean);
    return [
      r.view.padEnd(7),
      col(r.items, 4),
      col(r.p50Ms, 6, 1),
      col(r.p95Ms, 6, 1),
      col(r.maxMs, 7, 1),
      col(r.workMs, 5, 1),
      col(r.dropped, 4),
      col(r.missed1, 4),
      col(r.missed2, 4),
      col(r.missed3, 4),
      apart.length ? `(${apart.join(", ")})` : "",
    ]
      .join(" ")
      .trimEnd();
  });
  const notes = [
    "p50/p95/max: frame intervals (ms); work: the frame callback's own",
    "time (ms, median); drop: refreshes missed; >=1, >=2, >=3: frames",
    "that missed at least 1, 2 or 3 refreshes.",
  ];
  if (refresh) {
    const { hz, intervalMs, measuredMs, mismatch } = refresh;
    notes.push(
      `display ${hz} Hz (measured ${measuredMs.toFixed(1)} ms): a frame ${intervalMs.toFixed(1)} ms, one missed refresh ${(2 * intervalMs).toFixed(1)} ms${mismatch ? "; the measurement does not fit that rate" : ""}.`,
      `missed 1, 2, 3 refreshes: over ${missedThresholdsMs(intervalMs).join(", ")} ms.`,
    );
  } else {
    notes.push(
      "display rate not measured: drop and the missed counts are not counted.",
    );
  }
  if (downloads.length) {
    notes.push(
      "MiB per move (globe-lab assets, from the move to its last run):",
      downloads.map((d) => `${d.view} r${d.repeat} ${d.mib}`).join(", "),
    );
  }
  return [header, ...lines, "", ...notes].join("\n");
}
