/**
 * Replay occupancy subscriber — folds a replayed depth-sample stream into an
 * occupancy grid and drives its visualizers, for the single-store desktop
 * replay case (`startReplaySession`).
 *
 * Background: the framework's recording slice stores the newest depth sample in
 * `state.recording.latestDepthSample`. During desktop replay the
 * {@link ReplayEngine} re-dispatches the recorded `recordDepthSample` actions
 * into ONE store (no store-swap — unlike the RecorderApp's live/replay store
 * swap), so this subscriber only needs to observe that one store by reference,
 * fold each new sample into the grid, and refresh the caller's visualizers on a
 * throttle (replay re-dispatches samples far faster than the ~2 Hz live cadence,
 * so an un-throttled refresh would rebuild the cubes/mesh on every action).
 *
 * This is deliberately a LEANER sibling of the RecorderApp's
 * `wire-occupancy-grid-subscribers.ts`: no `StoreRef`/store-swap, no
 * cells-over-time telemetry, no revision/camera-move skip guard — a fresh replay
 * consumer needs none of those. Unifying the two (promoting the recorder's
 * wirer + `store-ref` into the framework and generalizing the store type) is a
 * deliberate follow-up; see the 2026-07-15 replay-harness Part A follow-ups doc.
 *
 * @see occupancy-cubes-visualizer.ts (a `ViewerPose` consumer)
 * @see replay-session.ts (the composer that uses this)
 */

import type { DepthSample } from '../types/ar-types.js';
import type { ViewerPose } from '../visualization/occupancy-cubes-visualizer.js';

/** Default minimum delay between two visualizer refreshes (ms). */
const DEFAULT_REFRESH_INTERVAL_MS = 250;

/** The part of `OccupancyGrid` this subscriber feeds. */
export interface OccupancyGridSink {
  addSample(sample: DepthSample): number;
  clear(): void;
}

/**
 * The minimal store shape this subscriber reads — satisfied by the framework's
 * `SlamAppStore` and the RecorderApp's `RecorderStore` alike (both carry the
 * framework recording slice). Kept structural so no concrete store type leaks
 * into the framework replay composition.
 */
export interface DepthSampleStore {
  getState(): {
    readonly recording: { readonly latestDepthSample: DepthSample | null };
  };
  subscribe(listener: () => void): () => void;
}

export interface ReplayOccupancySubscriberOptions {
  /** The single replay store whose `recording.latestDepthSample` is observed. */
  readonly store: DepthSampleStore;
  /** The grid each new sample is folded into. */
  readonly grid: OccupancyGridSink;
  /**
   * Redraw the visualizers from the (now-updated) grid. Called on the leading
   * edge of a quiet period and once on the trailing edge of a burst, with the
   * newest sample's head pose (raw WebXR) so an over-cap cube refresh can pick
   * the cells nearest the viewer (Issue B1). Errors are routed to `onError`.
   */
  readonly onRefresh: (viewerPose?: ViewerPose) => void;
  /** Minimum delay between two refreshes (ms). Defaults to 250. */
  readonly refreshIntervalMs?: number;
  /** Best-effort error sink for a throwing `addSample`/`onRefresh`. */
  readonly onError?: (err: unknown) => void;
}

/**
 * Attach the subscription. Returns a dispose function that detaches the store
 * subscription and cancels any pending trailing refresh.
 *
 * Leading + trailing throttle: the first sample after a quiet period refreshes
 * immediately; a burst coalesces into a single trailing refresh per interval so
 * the final settled state is always rendered.
 */
export function subscribeReplayOccupancy(
  options: ReplayOccupancySubscriberOptions
): () => void {
  const {
    store,
    grid,
    onRefresh,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
    onError,
  } = options;

  let disposed = false;
  let lastRefreshTime = -Infinity;
  let pendingRefresh: ReturnType<typeof setTimeout> | null = null;
  // Newest sample's head pose (raw WebXR), forwarded to the refresh so an
  // over-cap cube repaint can rank cells by distance to the viewer.
  let lastViewerPose: ViewerPose | null = null;

  // Isolate a throwing error handler so it can never break the store
  // subscription this promises to protect.
  const reportError = (err: unknown): void => {
    try {
      onError?.(err);
    } catch {
      // A broken error handler is unreportable by definition; swallow it.
    }
  };

  const cancelPendingRefresh = (): void => {
    if (pendingRefresh !== null) {
      clearTimeout(pendingRefresh);
      pendingRefresh = null;
    }
  };

  const refreshNow = (): void => {
    lastRefreshTime = nowMs();
    try {
      onRefresh(lastViewerPose ?? undefined);
    } catch (err) {
      reportError(err);
    }
  };

  const scheduleRefresh = (): void => {
    if (pendingRefresh !== null) {
      return;
    }
    const elapsed = nowMs() - lastRefreshTime;
    if (elapsed >= refreshIntervalMs) {
      refreshNow();
      return;
    }
    pendingRefresh = setTimeout(() => {
      pendingRefresh = null;
      if (!disposed) {
        refreshNow();
      }
    }, refreshIntervalMs - elapsed);
  };

  const handleSample = (sample: DepthSample): void => {
    try {
      grid.addSample(sample);
    } catch (err) {
      reportError(err);
      return;
    }
    // Keep the freshest pose even when the refresh is throttled, so the
    // trailing refresh ranks cubes around the latest camera position.
    lastViewerPose = {
      cameraPos: sample.cameraPos,
      cameraRot: sample.cameraRot,
    };
    scheduleRefresh();
  };

  // Seed: a sample already present in the store (e.g. dispatched before wiring)
  // is folded in once.
  let lastSample = store.getState().recording.latestDepthSample;
  if (lastSample) {
    handleSample(lastSample);
  }

  const unsubscribe = store.subscribe(() => {
    if (disposed) {
      return;
    }
    const next = store.getState().recording.latestDepthSample;
    if (next === lastSample) {
      return;
    }
    lastSample = next;
    if (next) {
      handleSample(next);
    }
  });

  return () => {
    disposed = true;
    cancelPendingRefresh();
    unsubscribe();
  };
}

/**
 * `Date.now` indirection — replay throttling is wall-clock based. Isolated so a
 * test can spy/stub it; production uses the real clock.
 */
function nowMs(): number {
  return Date.now();
}
