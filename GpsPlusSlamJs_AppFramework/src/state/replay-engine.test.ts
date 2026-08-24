/**
 * Replay Engine — Unit Tests
 *
 * Why these tests matter: They verify the core replay engine that controls
 * timed playback of recorded sessions. This includes:
 * - extractActionTimestamp: pure function mapping heterogeneous action types
 *   to epoch timestamps (or null for unsupported types like depthSample)
 * - computeInterActionDelay: delay calculation with speed factor and max clamp
 * - ReplayEngine: async controller with play/pause/resume/speed-change
 *
 * Test data strategy: Uses minimal synthetic action fixtures (not real ZIPs)
 * for fast, deterministic tests that explicitly encode timestamp assumptions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Vector3, Quaternion } from 'gps-plus-slam-js';
import {
  extractActionTimestamp,
  computeInterActionDelay,
  ReplayEngine,
  DEFAULT_MAX_DELAY_MS,
} from './replay-engine';
import { createSlamAppStore } from './create-slam-app-store';
import { NullStorageBackend } from '../storage/null-storage-backend';
import type { StorageBackend } from '../storage/storage-backend';

const createRecorderStore = (opts?: { storageBackend?: StorageBackend }) =>
  createSlamAppStore({
    storageBackend: opts?.storageBackend ?? new NullStorageBackend(),
  });

// ---------------------------------------------------------------------------
// Synthetic action fixtures — explicitly encode timestamp assumptions
// ---------------------------------------------------------------------------

/** recordGpsEvent action with epoch timestamp in payload.rawGpsPoint.timestamp (new format) */
function makeGpsAction(timestamp: number) {
  return {
    type: 'gpsData/recordGpsEvent' as const,
    payload: {
      odomPosition: { x: 0, y: 0, z: 0 },
      odomRotation: { x: 0, y: 0, z: 0, w: 1 },
      rawGpsPoint: {
        id: `gps-${timestamp}`,
        latitude: 50.0,
        longitude: 8.0,
        timestamp,
      },
    },
  };
}

/** recordGpsEvent action with old gpsPoint field (backward compat for old recordings) */
function makeGpsActionOldFormat(timestamp: number) {
  return {
    type: 'gpsData/recordGpsEvent' as const,
    payload: {
      odomPosition: { x: 0, y: 0, z: 0 },
      odomRotation: { x: 0, y: 0, z: 0, w: 1 },
      gpsPoint: {
        id: `gps-${timestamp}`,
        zeroRef: { lat: 50.0, lon: 8.0 },
        latitude: 50.0,
        longitude: 8.0,
        coordinates: { x: 0, y: 0, z: 0 },
        weight: 1.0,
        timestamp,
      },
    },
  };
}

/** startSession action with epoch timestamp in payload.startTime */
function makeStartSessionAction(startTime: number) {
  return {
    type: 'recording/startSession' as const,
    payload: {
      scenarioName: 'Test Scenario',
      sessionName: 'test-session',
      startTime,
    },
  };
}

/** endSession action — no usable timestamp */
function makeEndSessionAction() {
  return {
    type: 'recording/endSession' as const,
  };
}

/**
 * depthSample action — uses performance.now() (relative), NOT epoch ms.
 * extractActionTimestamp MUST return null for this type to avoid mixing
 * clock domains (Risk R4).
 */
function makeDepthSampleAction(relativeTimestamp: number) {
  return {
    type: 'recording/recordDepthSample' as const,
    payload: {
      timestamp: relativeTimestamp,
      cameraPos: [0, 0, 0] as Vector3,
      cameraRot: [0, 0, 0, 1] as Quaternion,
      points: [],
    },
  };
}

/** markReferencePoint action with epoch timestamp */
function makeMarkRefPointAction(timestamp: number) {
  return {
    type: 'gpsData/markReferencePoint' as const,
    payload: {
      id: 'pointA',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      rawGpsPoint: {
        id: `gps-${timestamp}`,
        latitude: 50.0,
        longitude: 8.0,
        timestamp,
      },
      timestamp,
    },
  };
}

/** markReferencePoint with old gpsPoint field (backward compat) */
function makeMarkRefPointActionOldFormat(timestamp: number) {
  return {
    type: 'gpsData/markReferencePoint' as const,
    payload: {
      id: 'pointA',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      gpsPoint: {
        id: `gps-${timestamp}`,
        zeroRef: { lat: 50.0, lon: 8.0 },
        latitude: 50.0,
        longitude: 8.0,
        coordinates: { x: 0, y: 0, z: 0 },
        weight: 1.0,
        timestamp,
      },
      timestamp,
    },
  };
}

/** Unknown action type — extractActionTimestamp should return null */
function makeUnknownAction() {
  return {
    type: 'someSlice/unknownAction' as const,
    payload: { data: 'irrelevant' },
  };
}

// ===========================================================================
// extractActionTimestamp
// ===========================================================================

describe('extractActionTimestamp', () => {
  it('returns epoch ms from recordGpsEvent.payload.rawGpsPoint.timestamp', () => {
    // Why: GPS events are the primary timestamp source for replay pacing
    const ts = 1708300000000;
    expect(extractActionTimestamp(makeGpsAction(ts))).toBe(ts);
  });

  it('returns epoch ms from recordGpsEvent with old gpsPoint format', () => {
    // Why: Old recordings use gpsPoint instead of rawGpsPoint — must still extract timestamps
    const ts = 1708300000000;
    expect(extractActionTimestamp(makeGpsActionOldFormat(ts))).toBe(ts);
  });

  it('returns epoch ms from startSession.payload.startTime', () => {
    // Why: Session start provides the initial timestamp anchor
    const ts = 1708300000000;
    expect(extractActionTimestamp(makeStartSessionAction(ts))).toBe(ts);
  });

  it('returns epoch ms from markReferencePoint.payload.timestamp', () => {
    // Why: Reference points have explicit epoch timestamps
    const ts = 1708300005000;
    expect(extractActionTimestamp(makeMarkRefPointAction(ts))).toBe(ts);
  });

  it('returns null for recordQrDetection (shares depth performance.now domain)', () => {
    // The QR detection timestamp is in the same performance.now() domain as the
    // depth sample it pairs with on the derive-on-read as-of join, so it must be
    // excluded from epoch replay timing — same reasoning as recordDepthSample.
    expect(
      extractActionTimestamp({
        type: 'qrDetected/recordQrDetection',
        payload: { text: 'x', timestamp: 12345.67, corners: [] },
      })
    ).toBeNull();
  });

  it('returns null for depthSample (uses performance.now, not epoch)', () => {
    // Why: Risk R4 — depthSample uses performance.now() which is relative
    // to page load, NOT epoch ms. Mixing these produces garbage delays.
    expect(extractActionTimestamp(makeDepthSampleAction(12345.67))).toBeNull();
  });

  it('returns epoch ms from diagnostics/note.payload.atMs', () => {
    // Why: `atMs` is epoch ms BY CONTRACT (both real callers pass
    // `nowEpochMs()`, and `ar-entry-wiring.test.ts` pins it as "AN ABSOLUTE
    // TIMELINE, not the XR frame clock"). Without this case a sparse note
    // between two paced actions returned null on both sides of the pairwise
    // delay, so the whole real gap around it was silently skipped on replay —
    // found by claude[bot] review on PR #351.
    const ts = 1708300007000;
    expect(
      extractActionTimestamp({
        type: 'diagnostics/note',
        payload: { kind: 'ar-entry-ready', atMs: ts, detail: {} },
      })
    ).toBe(ts);
  });

  it('returns null for a diagnostics note whose atMs is not a number', () => {
    // Why: a non-finite atMs is persisted as JSON null; pacing must degrade to
    // "no delay" rather than compute with a non-number.
    expect(
      extractActionTimestamp({
        type: 'diagnostics/note',
        payload: { kind: 'ar-entry-ready', atMs: null, detail: {} },
      })
    ).toBeNull();
  });

  it('returns null for endSession (no timestamp)', () => {
    // Why: endSession has no timestamp in its payload
    expect(extractActionTimestamp(makeEndSessionAction())).toBeNull();
  });

  it('returns null for unknown action types', () => {
    // Why: Unknown types should be dispatched immediately (0 delay)
    expect(extractActionTimestamp(makeUnknownAction())).toBeNull();
  });

  it('returns null when rawGpsPoint is missing from recordGpsEvent', () => {
    // Why: Defensive — malformed actions shouldn't crash the replay engine
    const broken = { type: 'gpsData/recordGpsEvent', payload: {} };
    expect(extractActionTimestamp(broken)).toBeNull();
  });

  it('returns epoch ms from markReferencePoint with old gpsPoint fallback', () => {
    // Why: Old recordings use gpsPoint — timestamp extraction must still work
    const ts = 1708300005000;
    const action = makeMarkRefPointActionOldFormat(ts);
    // Remove top-level timestamp to force the gpsPoint fallback path
    delete (action.payload as Record<string, unknown>).timestamp;
    expect(extractActionTimestamp(action)).toBe(ts);
  });

  it('returns null when payload is missing entirely', () => {
    // Why: Defensive — some actions may be bare {type} objects
    const bare = { type: 'gpsData/recordGpsEvent' };
    expect(extractActionTimestamp(bare)).toBeNull();
  });
});

// ===========================================================================
// computeInterActionDelay
// ===========================================================================

describe('computeInterActionDelay', () => {
  it('returns (ts2 - ts1) / speedFactor for two timestamped actions', () => {
    // Why: Core delay computation — the fundamental replay pacing logic
    const delay = computeInterActionDelay(1000, 2000, 1);
    expect(delay).toBe(1000);
  });

  it('divides delay by speed factor', () => {
    // Why: Speed factor 10x should produce 1/10th the real-time delay
    const delay = computeInterActionDelay(1000, 2000, 10);
    expect(delay).toBe(100);
  });

  it('returns 0 when currentTs is null', () => {
    // Why: Actions without timestamps should dispatch immediately
    expect(computeInterActionDelay(null, 2000, 1)).toBe(0);
  });

  it('returns 0 when nextTs is null', () => {
    // Why: If the next action has no timestamp, dispatch immediately
    expect(computeInterActionDelay(1000, null, 1)).toBe(0);
  });

  it('returns 0 when both timestamps are null', () => {
    // Why: Both null → no timing info → dispatch immediately
    expect(computeInterActionDelay(null, null, 1)).toBe(0);
  });

  it('clamps to 0 when next timestamp is before current (negative)', () => {
    // Why: Negative delays are nonsensical (clock went backwards) → clamp to 0
    const delay = computeInterActionDelay(2000, 1000, 1);
    expect(delay).toBe(0);
  });

  it('clamps to maxDelay when gap exceeds threshold', () => {
    // Why: Prevent indefinite waits on stale recordings with large clock gaps
    const hugeGap = 120_000; // 2 minutes
    const delay = computeInterActionDelay(1000, 1000 + hugeGap, 1);
    expect(delay).toBe(DEFAULT_MAX_DELAY_MS);
  });

  it('applies speed factor before max delay clamp', () => {
    // Why: At 10x speed, a 60s gap becomes 6s — still under the 30s clamp
    const delay = computeInterActionDelay(0, 60_000, 10);
    expect(delay).toBe(6000);
  });

  it('handles fractional speed factors (0.5x = half speed = double delay)', () => {
    // Why: Speed < 1 should slow down playback
    const delay = computeInterActionDelay(1000, 2000, 0.5);
    expect(delay).toBe(2000);
  });

  it('accepts custom maxDelay', () => {
    // Why: Allow callers to configure the clamp threshold
    const delay = computeInterActionDelay(0, 60_000, 1, 10_000);
    expect(delay).toBe(10_000);
  });
});

// ===========================================================================
// ReplayEngine
// ===========================================================================

describe('ReplayEngine', () => {
  let engine: ReplayEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new ReplayEngine();
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  function createStore() {
    return createRecorderStore({
      storageBackend: new NullStorageBackend(),
    });
  }

  // --- Play: dispatches all actions in order ---

  it('dispatches all actions in order', async () => {
    // Why: The most basic contract — all recorded actions must be replayed
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [
      makeStartSessionAction(t0),
      makeGpsAction(t0 + 1000),
      makeGpsAction(t0 + 2000),
    ];

    const playPromise = engine.play(actions, store, 1);

    // Advance through all timers
    await vi.runAllTimersAsync();
    await playPromise;

    expect(dispatchSpy).toHaveBeenCalledTimes(3);
    expect(dispatchSpy).toHaveBeenNthCalledWith(1, actions[0]);
    expect(dispatchSpy).toHaveBeenNthCalledWith(2, actions[1]);
    expect(dispatchSpy).toHaveBeenNthCalledWith(3, actions[2]);
  });

  // --- Play with speed=1 uses real-time delays ---

  it('delays between actions match real-time timestamps at speed=1', async () => {
    // Why: At 1x speed, a 1-second gap between actions = 1-second delay
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 1000),
      makeGpsAction(t0 + 3000),
    ];

    const playPromise = engine.play(actions, store, 1);

    // First action dispatched immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // After 1000ms, second action
    await vi.advanceTimersByTimeAsync(1000);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);

    // After another 2000ms, third action
    await vi.advanceTimersByTimeAsync(2000);
    expect(dispatchSpy).toHaveBeenCalledTimes(3);

    await playPromise;
  });

  // --- Play with speed=10 divides delays by 10 ---

  it('divides delays by speed factor', async () => {
    // Why: 10x speed should dispatch 10x faster
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 10_000), // 10s gap → 1s at 10x
    ];

    const playPromise = engine.play(actions, store, 10);

    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // At 10x, 10s gap becomes 1s
    await vi.advanceTimersByTimeAsync(999);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);

    await playPromise;
  });

  // --- Actions without timestamps dispatch with 0 delay ---

  it('dispatches actions without timestamps with 0 delay', async () => {
    // Why: depthSample, endSession, unknown types → no wait
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeDepthSampleAction(123.45), // no epoch ts → 0 delay
      makeEndSessionAction(), // no ts → 0 delay
    ];

    const playPromise = engine.play(actions, store, 1);

    // All three should dispatch immediately (depth+end have 0 delay)
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(3);

    await playPromise;
  });

  // --- Max delay clamp ---

  it('clamps large timestamp gaps to max delay', async () => {
    // Why: Prevent hanging on recordings with 2+ minute gaps
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 120_000), // 2 minute gap → clamped to 30s
    ];

    const playPromise = engine.play(actions, store, 1);

    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Should NOT wait the full 120s — clamped to DEFAULT_MAX_DELAY_MS (30s)
    await vi.advanceTimersByTimeAsync(DEFAULT_MAX_DELAY_MS);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);

    await playPromise;
  });

  // --- Pause stops dispatch mid-sequence ---

  it('pause stops dispatch mid-sequence', async () => {
    // Why: Users must be able to pause replay to inspect state
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 5000),
      makeGpsAction(t0 + 10_000),
    ];

    void engine.play(actions, store, 1);

    // First action dispatched
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Pause before second action arrives
    engine.pause();

    // Advance well past when the second action should fire
    await vi.advanceTimersByTimeAsync(20_000);
    expect(dispatchSpy).toHaveBeenCalledTimes(1); // still just 1
  });

  // --- Resume continues from correct index ---

  it('resume continues from the paused action index', async () => {
    // Why: Resume must pick up where pause left off, not restart.
    // Note: On resume, the next action dispatches immediately (partial
    // delay from the paused wait is discarded). Subsequent actions
    // use normal timestamp-based delays.
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 5000),
      makeGpsAction(t0 + 10_000),
    ];

    void engine.play(actions, store, 1);

    // Dispatch first action
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Pause mid-delay (before second action arrives at 5000ms)
    engine.pause();

    // Resume — second action dispatches immediately (partial delay discarded)
    void engine.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);

    // Third action has 5000ms delay from action[1]
    await vi.advanceTimersByTimeAsync(5000);
    expect(dispatchSpy).toHaveBeenCalledTimes(3);
  });

  // --- Speed change mid-playback ---

  it('speed change takes effect on next delay', async () => {
    // Why: Mid-playback speed adjustment is a key UX feature (Issue 3)
    // Speed change via setSpeed() updates the closure variable. It takes
    // effect when the NEXT delay is computed (after the current timer fires
    // and the next action is dispatched).
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 1000), // 1s gap
      makeGpsAction(t0 + 11_000), // 10s gap → will be 1s at 10x
    ];

    void engine.play(actions, store, 1);

    // First dispatched immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Change speed to 10x while first delay is in progress
    engine.setSpeed(10);

    // First delay was computed at speed=1 (before setSpeed), so still 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);

    // After action[1] dispatched, delay to action[2] is computed at speed=10
    // 10s gap / 10 = 1s
    await vi.advanceTimersByTimeAsync(1000);
    expect(dispatchSpy).toHaveBeenCalledTimes(3);
  });

  // --- onProgress callback ---

  it('calls onProgress after each dispatch with (current, total)', async () => {
    // Why: UI needs progress info for "Action 45/111" display
    const store = createStore();
    const progressCallback = vi.fn();
    engine.onProgress(progressCallback);

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 1000),
      makeGpsAction(t0 + 2000),
    ];

    const playPromise = engine.play(actions, store, 1);
    await vi.runAllTimersAsync();
    await playPromise;

    expect(progressCallback).toHaveBeenCalledTimes(3);
    expect(progressCallback).toHaveBeenNthCalledWith(1, 1, 3);
    expect(progressCallback).toHaveBeenNthCalledWith(2, 2, 3);
    expect(progressCallback).toHaveBeenNthCalledWith(3, 3, 3);
  });

  // --- onComplete callback ---

  it('calls onComplete when all actions dispatched', async () => {
    // Why: UI needs to know when replay finishes to update state
    const store = createStore();
    const completeCallback = vi.fn();
    engine.onComplete(completeCallback);

    const t0 = 1708300000000;
    const actions = [makeGpsAction(t0), makeGpsAction(t0 + 1000)];

    const playPromise = engine.play(actions, store, 1);
    await vi.runAllTimersAsync();
    await playPromise;

    expect(completeCallback).toHaveBeenCalledTimes(1);
  });

  it('does not call onComplete when paused mid-replay', async () => {
    // Why: Pausing should not trigger completion
    const store = createStore();
    const completeCallback = vi.fn();
    engine.onComplete(completeCallback);

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 5000),
      makeGpsAction(t0 + 10_000),
    ];

    void engine.play(actions, store, 1);
    await vi.advanceTimersByTimeAsync(0);
    engine.pause();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(completeCallback).not.toHaveBeenCalled();
  });

  // --- Edge cases ---

  it('handles empty action list gracefully', async () => {
    // Why: Edge case — no actions in the recording
    const store = createStore();
    const completeCallback = vi.fn();
    engine.onComplete(completeCallback);

    const playPromise = engine.play([], store, 1);
    await vi.runAllTimersAsync();
    await playPromise;

    expect(completeCallback).toHaveBeenCalledTimes(1);
    expect(store.getState().recording.isRecording).toBe(false);
  });

  it('handles single action', async () => {
    // Why: Edge case — recording with only one action
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');
    const completeCallback = vi.fn();
    engine.onComplete(completeCallback);

    const playPromise = engine.play(
      [makeStartSessionAction(1708300000000)],
      store,
      1
    );
    await vi.runAllTimersAsync();
    await playPromise;

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(completeCallback).toHaveBeenCalledTimes(1);
  });

  it('getState returns current replay state', () => {
    // Why: Consumers need to query engine state (playing, paused, etc.)
    expect(engine.getState()).toBe('idle');
  });

  it('state transitions: idle → playing → paused → playing → completed', async () => {
    // Why: State machine must follow expected transitions
    const store = createStore();
    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 1000),
      makeGpsAction(t0 + 2000),
    ];

    expect(engine.getState()).toBe('idle');

    void engine.play(actions, store, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getState()).toBe('playing');

    engine.pause();
    expect(engine.getState()).toBe('paused');

    const resumePromise = engine.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getState()).toBe('playing');

    await vi.runAllTimersAsync();
    await resumePromise;
    expect(engine.getState()).toBe('completed');
  });

  it('dispose stops playback and prevents further operations', async () => {
    // Why: Clean resource release pattern
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [makeGpsAction(t0), makeGpsAction(t0 + 5000)];

    void engine.play(actions, store, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    engine.dispose();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(dispatchSpy).toHaveBeenCalledTimes(1); // no more dispatches
    expect(engine.getState()).toBe('idle');
  });

  it('getCurrentActionIndex returns 0 before play', () => {
    // Why: Index state before replay starts
    expect(engine.getCurrentActionIndex()).toBe(0);
  });

  it('getCurrentActionIndex tracks progress during replay', async () => {
    // Why: Needed for "Action 2/5" display and resume-from-correct-index
    const store = createStore();
    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 1000),
      makeGpsAction(t0 + 2000),
    ];

    void engine.play(actions, store, 1);

    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getCurrentActionIndex()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.getCurrentActionIndex()).toBe(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.getCurrentActionIndex()).toBe(3);
  });

  // --- Error handling (Risk R7) ---

  it('catches dispatch errors and continues replay', async () => {
    // Why (R7): A malformed action should not crash the entire replay loop.
    // The engine must catch per-action errors and continue with the next action.
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actions = [
      makeGpsAction(t0),
      { type: 'WILL_THROW', payload: 'bad' }, // will cause dispatch to throw
      makeGpsAction(t0 + 2000),
    ];

    // Make dispatch throw on the second action
    dispatchSpy.mockImplementationOnce(() => actions[0]); // first: OK
    dispatchSpy.mockImplementationOnce(() => {
      throw new Error('Malformed action');
    });
    dispatchSpy.mockImplementationOnce(() => actions[2]); // third: OK

    const playPromise = engine.play(actions, store, 1);
    await vi.runAllTimersAsync();
    await playPromise;

    // All 3 dispatches attempted; engine did not crash
    expect(dispatchSpy).toHaveBeenCalledTimes(3);
    expect(engine.getState()).toBe('completed');
  });

  it('calls onError callback when dispatch throws', async () => {
    // Why (R7): UI needs to show toast messages for failed actions.
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');
    const errorCallback = vi.fn();
    engine.onError(errorCallback);

    const t0 = 1708300000000;
    const actions = [makeGpsAction(t0), { type: 'BAD_ACTION', payload: null }];

    dispatchSpy.mockImplementationOnce(() => actions[0]);
    dispatchSpy.mockImplementationOnce(() => {
      throw new Error('Parse error');
    });

    const playPromise = engine.play(actions, store, 1);
    await vi.runAllTimersAsync();
    await playPromise;

    expect(errorCallback).toHaveBeenCalledTimes(1);
    expect(errorCallback).toHaveBeenCalledWith(
      2, // action index (1-based)
      expect.any(Error)
    );
  });

  it('auto-pauses after 10 consecutive dispatch errors', async () => {
    // Why (R7): Too many consecutive errors likely indicates a corrupt recording.
    // Auto-pausing prevents the engine from churning through garbage silently.
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');
    const errorCallback = vi.fn();
    engine.onError(errorCallback);

    const t0 = 1708300000000;
    // 12 actions that all throw
    const actions = Array.from({ length: 12 }, (_, i) =>
      makeGpsAction(t0 + i * 1000)
    );

    dispatchSpy.mockImplementation(() => {
      throw new Error('Corrupt');
    });

    void engine.play(actions, store, 1);
    await vi.runAllTimersAsync();

    // After 10 errors, engine should auto-pause
    expect(engine.getState()).toBe('paused');
    // Only 10 dispatches attempted (not 12)
    expect(dispatchSpy).toHaveBeenCalledTimes(10);
    expect(errorCallback).toHaveBeenCalledTimes(10);
  });

  it('resets consecutive error count on successful dispatch', async () => {
    // Why (R7): If a successful dispatch happens, the consecutive error
    // counter resets so the 10-error auto-pause threshold starts over.
    const store = createStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    // 5 bad, 1 good, 5 bad = should NOT auto-pause (never 10 consecutive)
    const actions = Array.from({ length: 11 }, (_, i) =>
      makeGpsAction(t0 + i * 1000)
    );

    let callCount = 0;
    dispatchSpy.mockImplementation(() => {
      callCount++;
      if (callCount <= 5 || callCount > 6) {
        throw new Error('Bad');
      }
      // callCount === 6: succeeds
      return actions[5];
    });

    const playPromise = engine.play(actions, store, 1);
    await vi.runAllTimersAsync();
    await playPromise;

    // All 11 dispatched because the success at position 6 reset the counter
    expect(dispatchSpy).toHaveBeenCalledTimes(11);
    expect(engine.getState()).toBe('completed');
  });
});

describe('abortableDelay listener cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes abort listener when timeout completes normally', async () => {
    // Why: Without cleanup, each completed delay leaks an 'abort' listener
    // on the AbortSignal. Over 1000+ actions in a long replay, stale
    // listeners accumulate, wasting memory and slowing eventual abort.
    const store = createRecorderStore({
      storageBackend: new NullStorageBackend(),
    });
    const engine = new ReplayEngine();
    const removeEventListenerSpy = vi.spyOn(
      AbortSignal.prototype,
      'removeEventListener'
    );

    const actions = [
      makeStartSessionAction(1000),
      makeGpsAction(2000),
      makeGpsAction(3000),
      makeGpsAction(4000),
    ];

    const playPromise = engine.play(actions, store, 1);
    await vi.runAllTimersAsync();
    await playPromise;

    expect(engine.getState()).toBe('completed');

    // 3 delays between 4 actions — each should clean up its listener
    const abortRemovals = removeEventListenerSpy.mock.calls.filter(
      ([event]) => event === 'abort'
    );
    expect(abortRemovals.length).toBeGreaterThanOrEqual(3);

    removeEventListenerSpy.mockRestore();
  });

  // --- Issue 2: play() must cancel existing playback before starting new ---

  it('cancels existing playback when play() is called again', async () => {
    // Why: Without cancelling, calling play() twice creates two concurrent
    // runLoop() instances sharing the same mutable state, producing
    // double-dispatched actions and race conditions.
    const store = createRecorderStore({
      storageBackend: new NullStorageBackend(),
    });
    const engine = new ReplayEngine();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    const t0 = 1708300000000;
    const actionsA = [
      makeGpsAction(t0),
      makeGpsAction(t0 + 5000), // 5s delay
      makeGpsAction(t0 + 10000),
    ];
    const actionsB = [makeStartSessionAction(t0), makeGpsAction(t0 + 1000)];

    // Start first playback
    const firstPromise = engine.play(actionsA, store, 1);

    // Advance past first action but not second
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1); // actionsA[0]

    // Start second playback — should cancel the first
    dispatchSpy.mockClear();
    const secondPromise = engine.play(actionsB, store, 1);

    // Run all timers
    await vi.runAllTimersAsync();
    await firstPromise;
    await secondPromise;

    // Only actionsB should have been dispatched (2 items), not leftover actionsA
    const dispatched = dispatchSpy.mock.calls.map((call) => call[0].type);
    expect(dispatched).toEqual([
      'recording/startSession',
      'gpsData/recordGpsEvent',
    ]);
  });
});

// ===========================================================================
// Issue 3: setSpeed() validation
// ===========================================================================

describe('ReplayEngine.setSpeed() validation', () => {
  it('rejects zero speed factor', () => {
    // Why: speed=0 ⇒ division by zero in computeInterActionDelay ⇒ Infinity delay
    const engine = new ReplayEngine();
    expect(() => engine.setSpeed(0)).toThrow(RangeError);
  });

  it('rejects negative speed factor', () => {
    // Why: negative speed produces negative delays, clamped to 0 ⇒ instant replay
    const engine = new ReplayEngine();
    expect(() => engine.setSpeed(-1)).toThrow(RangeError);
  });

  it('rejects NaN speed factor', () => {
    // Why: NaN propagates through delay calc, breaking setTimeout
    const engine = new ReplayEngine();
    expect(() => engine.setSpeed(NaN)).toThrow(RangeError);
  });

  it('rejects Infinity speed factor', () => {
    // Why: Infinity ⇒ zero delay always ⇒ busy-loop dispatch
    const engine = new ReplayEngine();
    expect(() => engine.setSpeed(Infinity)).toThrow(RangeError);
  });

  it('accepts valid positive finite speed factor', () => {
    // Why: sanity check — normal use cases should not throw
    const engine = new ReplayEngine();
    expect(() => engine.setSpeed(0.5)).not.toThrow();
    expect(() => engine.setSpeed(1)).not.toThrow();
    expect(() => engine.setSpeed(10)).not.toThrow();
  });
});
