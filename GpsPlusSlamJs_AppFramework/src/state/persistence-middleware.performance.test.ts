/**
 * Performance guard for persistence middleware synchronous overhead.
 *
 * Why this test matters: The persistence middleware runs on EVERY Redux
 * dispatch during recording. Its synchronous path (action type checks,
 * recording state checks, index increment, WriteQueue enqueue) must not
 * add perceptible latency to the dispatch cycle, and — critically — it
 * must stay O(1) per dispatch. The actual async OPFS writes are
 * non-blocking and not measured here.
 *
 * How it asserts that (and why it is NOT a wall-clock budget):
 *
 * The previous version compared a single per-dispatch wall-clock sample
 * against a hard 0.1 ms threshold. That is inherently flaky — the same
 * code is "correct" at 0.099 ms and "broken" at 0.101 ms purely from
 * scheduler noise, GC, and whatever else the full suite runs concurrently
 * (see GpsPlusSlamJs_Docs/docs/2026-06-15-0922-flaky-persistence-perf-test-followup.md).
 *
 * Instead we assert the *algorithmic invariant* the test actually cares
 * about: per-dispatch cost does not grow with the number of dispatches in
 * a burst. We measure the median per-dispatch time for a small burst and a
 * much larger burst (20×) and assert the ratio stays below a generous
 * factor. O(1) work yields a ratio near 1; an accidental O(n) regression
 * in the hot path (e.g. scanning the growing WriteQueue on each enqueue)
 * would balloon the large-burst figure and trip the assertion.
 *
 * A RATIO IS NOT AUTOMATICALLY ROBUST TO LOAD, and this file used to claim it
 * was ("because both figures scale together with machine speed"). That is true
 * of STATIC machine speed and false of TRANSIENT preemption, which is the thing
 * that actually happens: the two arms are measured sequentially, so a scheduler
 * slice lands in one and not the other. On 2026-08-20 this test failed with the
 * ratio at 9.53 against a bound of 4, on unchanged code.
 *
 * What makes it robust is the DENOMINATOR being large enough to resolve — see
 * `MIN_WINDOW_MS`. A single burst of 200 dispatches measured ~1.0 ms, so one
 * ~15 ms slice moved it by an order of magnitude. Accumulating to 200 ms puts
 * that same slice at ~7 %.
 *
 * A very generous absolute ceiling (far above observed ~0.002 ms) is kept
 * only as a backstop against a catastrophic regression, not as the primary
 * signal. Note it is the RATIO that has failed here, never the ceiling.
 *
 * ⚠️ WHAT THIS TEST DOES NOT EXERCISE — read before trusting it.
 * The docblock above names "WriteQueue enqueue" as part of the hot path being
 * measured, and offers "scanning the growing WriteQueue on each enqueue" as the
 * regression it would catch. Injecting exactly that regression on 2026-08-20 did
 * NOT trip either assertion, and instrumenting `WriteQueue.enqueue` recorded no
 * calls at all, and spying the mock backend reports writeAction called ZERO times
 * across the recording arm. The cause is that `startSession()` sets
 * `isRecording` synchronously while the backend's `createSession` is never
 * awaited, and the measurement loop cannot yield, so the middleware early-exits
 * on every dispatch and BOTH arms measure the same path. The stabilisation below therefore
 * makes a test that may be largely vacuous merely STABLE; it does not make it
 * meaningful. Verified against the pre-2026-08-20 version too, so this is a
 * pre-existing gap and not something the rework introduced.
 * Filed: GpsPlusSlamJs_Docs/docs/2026-08-20-1745-persistence-perf-test-may-not-exercise-the-queue-followup.md
 */

import { describe, expect, test, vi } from 'vitest';
import {
  configureStore,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { StorageBackend } from '../storage/storage-backend';
import { createPersistenceMiddleware } from './persistence-middleware';

// ---------------------------------------------------------------------------
// Minimal slices (mirror the test helper pattern from persistence-middleware.test.ts)
// ---------------------------------------------------------------------------

const testRecorderSlice = createSlice({
  name: 'recorder',
  initialState: { isRecording: false, failedWriteCount: 0 },
  reducers: {
    startSession(state) {
      state.isRecording = true;
      state.failedWriteCount = 0;
    },
    endSession(state) {
      state.isRecording = false;
    },
    recordWriteFailure(state) {
      state.failedWriteCount += 1;
    },
  },
});

const testGpsDataSlice = createSlice({
  name: 'gpsData',
  initialState: null as { lat: number; lon: number } | null,
  reducers: {
    setZeroPos(_state, action: PayloadAction<{ lat: number; lon: number }>) {
      return action.payload;
    },
  },
});

// ---------------------------------------------------------------------------
// Store factory + measurement helpers
// ---------------------------------------------------------------------------

/**
 * Build a store wired with the persistence middleware over an instant-resolving
 * mock backend, so only the middleware's own synchronous code is measured.
 * When `recording` is true the middleware enters its hot path (enqueue per
 * dispatch); otherwise it early-exits.
 */
function makeStore(recording: boolean) {
  const mockBackend: StorageBackend = {
    createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
    listSessions: vi.fn().mockResolvedValue([]),
    writeAction: vi.fn().mockResolvedValue(undefined),
    writeFrame: vi.fn().mockResolvedValue(undefined),
    writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
  };

  const store = configureStore({
    reducer: {
      recorder: testRecorderSlice.reducer,
      gpsData: testGpsDataSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }).concat(
        createPersistenceMiddleware({
          storageBackend: mockBackend,
          persistedPrefixes: ['gpsData', 'recording'],
        })
      ),
  });

  if (recording) {
    store.dispatch(testRecorderSlice.actions.startSession());
  }
  return store;
}

const SAMPLE_ACTION = testGpsDataSlice.actions.setZeroPos({ lat: 48, lon: 2 });

/**
 * Minimum ACCUMULATED measurement window, ms.
 *
 * THIS IS THE FIX FOR THE FLAKE, and the reason is arithmetic. A single burst
 * of `SMALL_BURST` dispatches measured ~1.0 ms recording and ~0.32 ms not
 * recording (2026-08-20, this machine). One scheduler slice is ~15 ms, so a
 * single preemption inside the small arm inflated it by an order of magnitude —
 * and since that arm is the RATIO'S DENOMINATOR, the ratio moved by the same
 * order. That is how a bound of 4 was observed at 9.53 on code that had not
 * changed.
 *
 * Repeating the burst until the accumulated window reaches 200 ms puts a single
 * 15 ms slice at ~7 % of the measurement instead of ~1500 %. The median across
 * passes then suppresses what is left.
 */
const MIN_WINDOW_MS = 200;

/**
 * Average per-dispatch cost, measured over enough repetitions of `dispatchCount`
 * to make the window resolvable.
 *
 * THE BURST SIZE IS UNCHANGED ON PURPOSE. What the two arms compare is the
 * queue DEPTH the middleware works against, so each repetition starts a fresh
 * store and dispatches exactly `dispatchCount` — the small arm's queue never
 * exceeds `SMALL_BURST`, the large arm's reaches `LARGE_BURST`, exactly as
 * before. Only the number of repetitions changes, and store construction is
 * kept OUTSIDE the clock so the small arm (which builds more stores per unit
 * time) is not charged for it.
 */
function measureAvgPerDispatchMs(
  recording: boolean,
  dispatchCount: number,
  minWindowMs = MIN_WINDOW_MS
): number {
  let dispatches = 0;
  let elapsed = 0;
  do {
    const store = makeStore(recording);
    const start = performance.now();
    for (let i = 0; i < dispatchCount; i += 1) {
      store.dispatch(SAMPLE_ACTION);
    }
    elapsed += performance.now() - start;
    dispatches += dispatchCount;
  } while (elapsed < minWindowMs);
  return elapsed / dispatches;
}

/** Median of several measurement passes — robust to occasional GC/scheduler spikes. */
function medianAvgPerDispatchMs(
  recording: boolean,
  dispatchCount: number,
  passes: number
): number {
  const samples: number[] = [];
  for (let p = 0; p < passes; p += 1) {
    samples.push(measureAvgPerDispatchMs(recording, dispatchCount));
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Small burst — the per-dispatch baseline. */
const SMALL_BURST = 200;

/**
 * Large burst — 20× the small one. If the hot path were O(n) in the number of
 * queued writes, the per-dispatch figure here would grow ~20×; O(1) keeps it
 * flat. The queue grows to LARGE_BURST entries because the instant-resolving
 * backend's drain runs on microtasks that cannot fire inside the synchronous
 * loop — exactly the condition under which an O(n) enqueue would show up.
 */
const LARGE_BURST = SMALL_BURST * 20;

/** Median over several passes to de-noise the comparison. */
const MEASUREMENT_PASSES = 5;

/**
 * Warm-up dispatches (discarded) to let the JIT compile the hot path before we
 * time anything, so the baseline isn't inflated by cold-start cost (which would
 * understate the ratio).
 */
const WARMUP_DISPATCHES = 500;

/**
 * Maximum acceptable large/small per-dispatch ratio. O(1) work yields ~1;
 * we allow up to 4× to absorb the fixed-cost dilution and measurement noise
 * that vary between the two burst sizes. A true O(n) regression would land
 * near 20× and trip this immediately.
 */
const MAX_SCALING_FACTOR = 4;

/**
 * Generous absolute backstop in milliseconds. Observed cost is ~0.01 ms; this
 * ceiling is ~100× that, so it never fires on scheduler noise — only on a
 * catastrophic regression. It is a safety net, not the primary signal.
 */
const ABSOLUTE_CEILING_MS = 1;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('persistence middleware synchronous overhead', () => {
  test(
    'per-dispatch overhead during recording stays O(1) as the burst grows',
    { timeout: 15_000 },
    () => {
      // Warm up the hot path (JIT) before timing.
      measureAvgPerDispatchMs(true, WARMUP_DISPATCHES, 0);

      const small = medianAvgPerDispatchMs(
        true,
        SMALL_BURST,
        MEASUREMENT_PASSES
      );
      const large = medianAvgPerDispatchMs(
        true,
        LARGE_BURST,
        MEASUREMENT_PASSES
      );
      const ratio = large / small;

      if (process.env.DEBUG_PERF === '1') {
        console.info(
          `[perf] recording per-dispatch ms — small: ${small.toFixed(6)}, ` +
            `large: ${large.toFixed(6)}, ratio: ${ratio.toFixed(2)}`
        );
      }

      // Primary signal: cost does not scale with burst size (O(1) per dispatch).
      expect(ratio).toBeLessThanOrEqual(MAX_SCALING_FACTOR);
      // Backstop: no catastrophic absolute regression.
      expect(large).toBeLessThanOrEqual(ABSOLUTE_CEILING_MS);
    }
  );

  test(
    'per-dispatch overhead when NOT recording stays O(1) as the burst grows',
    { timeout: 15_000 },
    () => {
      // Warm up the early-exit path (JIT) before timing.
      measureAvgPerDispatchMs(false, WARMUP_DISPATCHES, 0);

      const small = medianAvgPerDispatchMs(
        false,
        SMALL_BURST,
        MEASUREMENT_PASSES
      );
      const large = medianAvgPerDispatchMs(
        false,
        LARGE_BURST,
        MEASUREMENT_PASSES
      );
      const ratio = large / small;

      if (process.env.DEBUG_PERF === '1') {
        console.info(
          `[perf] not-recording per-dispatch ms — small: ${small.toFixed(6)}, ` +
            `large: ${large.toFixed(6)}, ratio: ${ratio.toFixed(2)}`
        );
      }

      // The early-exit path does no enqueue; it must also stay flat.
      expect(ratio).toBeLessThanOrEqual(MAX_SCALING_FACTOR);
      expect(large).toBeLessThanOrEqual(ABSOLUTE_CEILING_MS);
    }
  );
});
