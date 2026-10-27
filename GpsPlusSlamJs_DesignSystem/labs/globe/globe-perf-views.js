/**
 * The frame-time recorder's fixed-view sweep (`#perf=1&perfItems=5,20,50`):
 * the full look held at five views, from space down to street level, with
 * editor-style items standing at the place, each view and item count held
 * a few seconds and repeated, so one link on a phone measures what an
 * editor on the globe would cost. Pure: the plan, the items' layout and
 * the table; `globe-perf.js` runs it and `globe-lab.js` places the camera
 * and the items.
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
 * The item counts from the hash's `perfItems` text ("5,20,50"): unique and
 * ascending, each a whole number from 0 to `maxItems`, at most `maxCounts`
 * of them. Absent, empty or malformed text is null (no sweep), never a
 * partly read list.
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
 * The sweep's cells: for each repeat, each view in order, each item count.
 * One camera move per view and repeat; the counts change only the items.
 * RangeError for a repeat count that is not a positive integer.
 */
export function perfViewCells({ items, repeats }) {
  if (!(Number.isInteger(repeats) && repeats > 0)) {
    throw new RangeError(`repeats must be a positive integer, got ${repeats}`);
  }
  const cells = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const view of PERF_VIEWS) {
      for (const n of items) cells.push({ repeat, view: view.id, items: n });
    }
  }
  return cells;
}

/** A cell's run label: view, item count and repeat. */
export const viewRunLabel = (cell) =>
  `${cell.view} n=${cell.items} r${cell.repeat}`;

/**
 * An upper bound on the sweep's length (ms): every camera move waits its
 * whole settle timeout, every cell holds `holdMs`.
 */
export function perfViewsEstimateMs(cells, { holdMs, settleMs }) {
  const moves = new Set(cells.map((c) => `${c.repeat}/${c.view}`)).size;
  return moves * settleMs + cells.length * holdMs;
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

/**
 * One row per view and item count, in the sweep's order: the repeats'
 * median p50 and p95, the worst frame, the frames over 33 and 50 ms
 * summed, and the most bytes the page had needed (MiB). Voided runs (a
 * touch, the page hidden, a lost context) are counted, not pooled.
 * `runs` are the recorder's finished runs with `cell` and `bytes`.
 */
export function summariseViewRuns(runs) {
  const groups = new Map();
  for (const r of runs) {
    const key = `${r.cell.view}/${r.cell.items}`;
    if (!groups.has(key)) {
      groups.set(key, { view: r.cell.view, items: r.cell.items, list: [] });
    }
    groups.get(key).list.push(r);
  }
  const viewIndex = (id) => PERF_VIEWS.findIndex((v) => v.id === id);
  return [...groups.values()]
    .sort((a, b) => viewIndex(a.view) - viewIndex(b.view) || a.items - b.items)
    .map(({ view, items, list }) => {
      const kept = list.filter((r) => !r.voided && r.summary.stats.count > 0);
      const stats = kept.map((r) => r.summary.stats);
      return {
        view,
        items,
        runs: kept.length,
        voided: list.length - kept.length,
        p50Ms: kept.length ? median(stats.map((s) => s.p50Ms)) : null,
        p95Ms: kept.length ? median(stats.map((s) => s.p95Ms)) : null,
        maxMs: kept.length ? Math.max(...stats.map((s) => s.maxMs)) : null,
        over33: stats.reduce((sum, s) => sum + overAt(s, 33), 0),
        over50: stats.reduce((sum, s) => sum + overAt(s, 50), 0),
        bytesMiB: +(
          Math.max(0, ...list.map((r) => r.bytes ?? 0)) /
          2 ** 20
        ).toFixed(1),
      };
    });
}

/** A number with `decimals`, "-" for none, padded to `width`. */
const col = (value, width, decimals = 0) =>
  (value === null ? "-" : value.toFixed(decimals)).padEnd(width);

/** The table as text for the overlay and the export: one line per row. */
export function formatViewTable(rows) {
  const header = "view    n    p50    p95    max     >33  >50  MiB";
  const lines = rows.map((r) =>
    [
      r.view.padEnd(7),
      col(r.items, 4),
      col(r.p50Ms, 6, 1),
      col(r.p95Ms, 6, 1),
      col(r.maxMs, 7, 1),
      col(r.over33, 4),
      col(r.over50, 4),
      col(r.bytesMiB, 0, 1),
      r.voided ? `(${r.voided} void)` : "",
    ]
      .join(" ")
      .trimEnd(),
  );
  return [header, ...lines].join("\n");
}
