// Repo-meta test: a test file that measures a clock AND asserts a number must
// be a deliberate, justified choice — not something that arrives by habit.
//
// Why this test matters. On 2026-08-20 four packages failed their gates on
// timing in one day. Most of it was concurrency between gate runs (fixed by
// `scripts/test-timing/gate-lock.mjs`), but not all: `terrarium.test.ts` failed
// again at 95 ms against an 85 ms bound on a verifiably idle machine, because
// vitest spreads ~130 files across worker threads and a 60 ms platform timer
// lands 30-40 ms late however quiet the machine is.
//
// The expensive part was never the flake. It was that each failure invited
// "widen the threshold" — a one-line change — while the real answer required
// looking outside the failing test. `agent-route.test.ts` shows where that
// leads: its bound was raised 2000 -> 3000 ms because it was failing one run in
// three IN ISOLATION, and the widening is recorded in the file as a fix.
//
// WHAT THIS GUARD IS NOT. It does not ban clocks in tests, and it does not
// judge whether a bound is well-sized — a human does that when adding the
// allowlist entry. It enforces exactly one thing: that the set is enumerated,
// so the next addition is a reviewed decision rather than a habit, and so the
// list can be worked down deliberately.
//
// Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-1520-wall-clock-bounds-out-of-the-gate-plan.md
// (closed repo). Argument: ...-0847-wall-clock-assertions-in-the-unit-gate-followup.md

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Clock ARITHMETIC, not merely a clock read.
 *
 * `Date.now()` alone is overwhelmingly a timestamp in a fixture and says
 * nothing about load. `now() - x` is an elapsed duration; `now() + x` is a
 * spin-burn deadline (`refresh-cycle.test.ts`). Both make a test's verdict
 * depend on how fast the machine ran it, which is the property being
 * enumerated. Anchoring on the identifier instead — `elapsed`, `duration`, `ms`
 * — is what an earlier draft did, and it could not see `nine.ms`,
 * `holed / bare` or `slimMs`.
 */
const CLOCK_ARITHMETIC = /(performance|Date)\.now\(\)\s*[-+]/;

/** A numeric comparison assertion of any shape. */
const NUMERIC_ASSERTION =
  /expect\(.*\)\.(toBeLessThan|toBeGreaterThan|toBeLessThanOrEqual|toBeGreaterThanOrEqual)/;

/**
 * Every test file that measures a clock and asserts a number, with the reason
 * it is allowed to.
 *
 * Adding an entry is the point of the guard: it is cheap, and it is visible in
 * review. Adding one WITHOUT a reason fails below.
 */
const ALLOWLIST = new Map([
  // --- Deliberate discriminators with large margins (plan option 6) ---
  [
    'GpsPlusSlamJs_Osm/src/mesh/plates.test.ts',
    'Absolute budget with ~250x headroom: unclipped 2881 ms vs clipped ~2 ms against a 500 ms bound. Both designs measured; documented in-file.',
  ],
  [
    'GpsPlusSlamJs_Osm/src/model/multipolygon-builder.test.ts',
    'Absolute budget with ~90x headroom: 1063 ms vs 5.5 ms against 500 ms. The ratio form was tried and failed at 17x; the file records why.',
  ],
  [
    'GpsPlusSlamJs_Osm/src/mesh/triangulate.test.ts',
    'Ratio whose denominator is in milliseconds by construction, which is what makes a ratio meaningful here. Both designs measured by restoring the old code.',
  ],
  [
    'GpsPlusSlamJs_AppFramework/src/ar/floor-estimator.perf.test.ts',
    'A 50 ms ceiling against a measured best-of-15 of 0.44 ms (>100x). Minimum-of-N is load-robust: preemption can only inflate a sample.',
  ],
  [
    'GpsPlusSlamJs_AppFramework/src/ar/occupancy-grid.perf.test.ts',
    'Ratio WITH an absolute floor — max(4 * smallMs, 5) — so it degrades to a plain 5 ms ceiling exactly when the ratio would misfire. The model for option 3.',
  ],

  // --- Measured and reported, not asserted on the clock ---
  [
    'GpsPlusSlamJs_Osm/src/score/affordance-index.test.ts',
    'Measures and prints; every assertion is on counts, never on the duration.',
  ],
  [
    'GpsPlusSlamJs_Osm/src/score/merge-and-score-cost.test.ts',
    'Asserts the timing is FINITE rather than positive, because ">0" is itself a clock comparison on a coarse timer. The exemplar for this shape.',
  ],
  [
    'GpsPlusSlamJs_OsmDemo/src/refresh-cycle.test.ts',
    'Lower bound on a duration the test deliberately burned (spin to now()+20 ms). Load can only make the measured value larger, so the assertion cannot flake.',
  ],

  // --- Migrated 2026-08-20 (plan M2/M3), and the verdicts still pending ---
  [
    'GpsPlusSlamJs_Osm/src/elevation/terrarium.test.ts',
    'MIGRATED (M2): the absolute bound is replaced by the GAP between the two callers settle times. A shared budget releases both on one deadline (gap ~0); a per-caller budget settles the second ~200 ms later. Scheduler lateness moves both stamps equally and cancels.',
  ],
  [
    'GpsPlusSlamJs_AppFramework/src/state/persistence-middleware.performance.test.ts',
    'MIGRATED (M3): the ratio now accumulates a 200 ms measurement window instead of dividing by a ~1 ms one, which is what let a bound of 4 be observed at 9.53. Separately filed: the test does not appear to exercise the queue at all.',
  ],
  [
    'GpsPlusSlamJs_OsmDemo/src/refresh-payload.test.ts',
    'MIGRATED (M3): the zero-margin comparison and the small-denominator ratio are replaced by a payload-size assertion. The one clock left is a LOWER bound at the cap, which contention can only push away from failing.',
  ],
  [
    'GpsPlusSlamJs_Osm/src/mesh/poi-hosts-cost.test.ts',
    'VERDICT PENDING, plan M4: a 5 s smoke alarm with wide headroom, but the design it rejects is hypothetical rather than measured, so it meets only half the admission bar.',
  ],
  [
    'GpsPlusSlamJs_Osm/src/spatial/chunk-cost.test.ts',
    'VERDICT PENDING, plan M4: its comment says the per-chunk timing is "never asserted" and the next line asserts it is > 0. The comment, not the code, is what an earlier plan cited as a model.',
  ],
  [
    'GpsPlusSlamJs_Osm/src/testdata/sites/site-obstacle-index-cost.test.ts',
    'VERDICT PENDING, plan M4: asserts buildMs > 0 — a clock comparison in the same shape merge-and-score-cost rejected.',
  ],

  // --- Clock arithmetic present, but the assertions are not on it ---
  [
    'GpsPlusSlamJs_AppFramework/src/ar/occupancy-mesher.perf.test.ts',
    'Timing is measured for reporting; the numeric assertions are on bytes-per-cell and triangle counts.',
  ],
  [
    'GpsPlusSlamJs_AppFramework/src/ar/depth-unprojection.bench.test.ts',
    'Bench-style file that still runs in the unit gate; assertions are on output values, not on the clock.',
  ],
  [
    'GpsPlusSlamJs_AppFramework/src/ar/occupancy-mesher.bench.test.ts',
    'Bench-style file that still runs in the unit gate; assertions are on mesh structure, not on the clock.',
  ],
  [
    'GpsPlusSlamJs_RecorderApp/src/recording/recording-session-handlers.test.ts',
    'Durations are recorded into session metadata; assertions are on the recorded structure.',
  ],
  [
    'GpsPlusSlamJs_RecorderApp/src/state/occupancy-mesh-recording.integration.test.ts',
    'Timestamps drive the recording fixture; assertions are on counts and ordering.',
  ],
  [
    'GpsPlusSlamJs_RecorderApp/playwright-tests/session-summary.spec.js',
    'Elapsed values are rendered into the summary UI; assertions are on the rendered text.',
  ],

  // --- Clock arithmetic that only SYNTHESISES fixture timestamps ---
  // `Date.now() + i * 1000` builds a plausible series of GPS/event stamps. The
  // rule above catches it deliberately: the same expression can also express a
  // real deadline, and distinguishing them by pattern would put the guard back
  // to reading identifiers, which is exactly how the earlier draft went blind.
  // Four cheap entries are the price of a rule that cannot be fooled by a name.
  [
    'GpsPlusSlamJs_AppFramework/src/state/gps-event-coordinator.test.ts',
    'Date.now() + i * 1000 synthesises a GPS timestamp series; every assertion is on coordinator output values, never on a duration.',
  ],
  [
    'GpsPlusSlamJs_AppFramework/src/state/store-subscribers.test.ts',
    'Date.now() + 1000 stamps fixture events; assertions are on listener counts and dispatch behaviour, never on a duration.',
  ],
  [
    'GpsPlusSlamJs_RecorderApp/src/state/recorder-store.test.ts',
    'Date.now() + i * 1000 stamps fixture samples; assertions are on listener call counts and store state, never on a duration.',
  ],
]);

/** @returns {string[]} tracked test files that could run in a gate */
function trackedTestFiles() {
  const listed = execFileSync(
    'git',
    ['ls-files', '*.test.ts', '*.test.js', '*.test.mjs', '*.spec.js'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // A pure bench file is excluded by NOT being a test file at all — it has no
  // `.test.` segment, so it never matched above. Excluding `*.bench.*` by name
  // would be a hole: `depth-unprojection.bench.test.ts` and
  // `occupancy-mesher.bench.test.ts` DO run in the unit gate, and renaming
  // `foo.test.ts` to `foo.bench.test.ts` would otherwise be a one-token bypass.
  return listed.filter((file) => !file.endsWith('wall-clock-assertions.test.js'));
}

/** @returns {string[]} files whose verdict depends on how fast the machine ran */
function filesWithClockAssertions() {
  const found = [];
  for (const file of trackedTestFiles()) {
    let text;
    try {
      text = readFileSync(resolve(repoRoot, file), 'utf8');
    } catch {
      continue; // deleted-but-tracked mid-rebase; not this gate's job
    }
    if (CLOCK_ARITHMETIC.test(text) && NUMERIC_ASSERTION.test(text)) {
      found.push(file);
    }
  }
  return found;
}

describe('wall-clock assertions are enumerated, not habitual', () => {
  it('finds test files at all', () => {
    // Why this test matters: `git ls-files` returning nothing — a wrong cwd, a
    // detached worktree — would make every assertion below vacuously green.
    // `max-file-size.test.js` guards its own enumeration the same way.
    expect(trackedTestFiles().length).toBeGreaterThan(100);
  });

  it('detects every shape that has actually been written here', () => {
    // Why this test matters: an earlier draft of this guard matched the
    // ASSERTION (`expect(elapsed)...`), so it would have passed its own vacuity
    // check while blind to four live cases. `retracted-osm-figures.test.js`
    // records shipping a pattern that matched nothing that had ever been wrong;
    // these are the real lines, from the real files.
    const witnesses = [
      'const elapsed = performance.now() - started;',
      'const ms = performance.now() - started;',
      'const until = performance.now() + BURN_MS;',
      'expect(performance.now() - startedAt).toBeLessThan(3000);',
      'const dt = Date.now() - startedAt;',
    ];
    for (const witness of witnesses) {
      expect(witness).toMatch(CLOCK_ARITHMETIC);
    }

    const assertions = [
      'expect(elapsed).toBeLessThan(85);',
      'expect(nine.ms).toBeLessThan(5_000);',
      'expect(holed / bare).toBeLessThan(15);',
      'expect(slimMs).toBeLessThan(fullMs);',
      'expect(largeMs).toBeLessThan(Math.max(4 * smallMs, 5));',
      'expect(ratio).toBeLessThanOrEqual(MAX_SCALING_FACTOR);',
    ];
    for (const assertion of assertions) {
      expect(assertion).toMatch(NUMERIC_ASSERTION);
    }
  });

  it('does not fire on a clock read that is only a timestamp', () => {
    // The guard must stay narrow enough to be worth having. A fixture stamping
    // `Date.now()` into a record is not a load-sensitive test.
    expect('const point = { timestamp: Date.now() };').not.toMatch(
      CLOCK_ARITHMETIC
    );
  });

  it('has no unlisted file measuring a clock and asserting a number', () => {
    const unlisted = filesWithClockAssertions().filter(
      (file) => !ALLOWLIST.has(file)
    );

    expect(
      unlisted,
      'A test whose verdict depends on machine speed was added without a decision.\n' +
        'Either restate the claim without a clock (see the plan for the five\n' +
        'alternatives), or add it to ALLOWLIST here with the reason it must stay.\n' +
        'Widening an existing bound is not one of the alternatives.\n' +
        `Unlisted:\n  ${unlisted.join('\n  ')}`
    ).toEqual([]);
  });

  it('has no allowlist entry that no longer applies', () => {
    // Why this test matters: an allowlist that outlives its reason silently
    // grants permission nobody would grant today. `max-file-size.test.js`
    // enforces the same property for the same reason — an entry must still be
    // tracked AND still be doing the thing it was excused for.
    const live = new Set(filesWithClockAssertions());
    const stale = [...ALLOWLIST.keys()].filter((file) => !live.has(file));

    expect(
      stale,
      `These entries no longer measure a clock and assert a number — delete them:\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });

  it('gives every allowlist entry a reason', () => {
    const unexplained = [...ALLOWLIST.entries()]
      .filter(([, reason]) => typeof reason !== 'string' || reason.length < 40)
      .map(([file]) => file);

    expect(unexplained).toEqual([]);
  });
});
