/**
 * As-of depth resolver for the recorder live-QR debug viz (WS-5).
 *
 * The derive-on-read size join (`ar/qr/qr-derived-pose.ts`) needs, for each QR
 * detection, the depth-sampling context that was active **at that detection's
 * timestamp**. The recorder records depth in its own stream (`recordDepthSample`),
 * but the store only keeps the LATEST sample — so this module keeps a small,
 * bounded history of depth samples and answers `resolveDepthAt(timestamp)` with
 * the sample whose timestamp is the latest `≤ timestamp` (the as-of join). It
 * then delegates to the shared framework {@link createQrSizeDepthContext} to
 * build the {@link QrSizeDepthContext} the size measurer consumes (unprojector +
 * bilinear grid lookup) — the SAME factory the QR demo's live `getDepthContext`
 * uses, so the two cannot diverge; this module only adds the time addressing.
 *
 * The **time-addressing** here is the one genuinely new piece WS-5 needs (the
 * demo only ever needs the latest sample). It runs identically live
 * and on replay: `append` is fed every recorded depth sample (live: the capture
 * callback; replay: the re-dispatched `recordDepthSample` reflected in the
 * store's `latestDepthSample`), so the join reproduces the live result.
 *
 * **Clock domain (load-bearing):** depth timestamps are EPOCH ms
 * (`DepthSample.timestamp = performance.timeOrigin + frameTs`, `ar/depth-sampler.ts`),
 * and QR detections MUST carry the same epoch clock - since QR perf plan M4 the
 * frame's capture time, `performance.timeOrigin + xrTime` (plan open topic A). The lookup is a pure numeric `≤` over those stamps; if the QR
 * producer used relative `performance.now()` instead, every join would silently miss.
 *
 * @see gps-plus-slam-app-framework/ar/qr/qr-derived-pose — the consumer of `resolveDepthAt`.
 * @see qr-debug-controller.ts — drives `append` + renders the derived placement.
 */

// Deep subpath (NOT the `…/ar` barrel) — avoid pulling heavy transitive deps
// into main.ts's partially-mocked wiring tests (see qr-debug-view's rationale).
// The shared factory builds the unprojector + bilinear grid lookup; this module
// only adds the as-of time addressing on top.
import {
  createQrSizeDepthContext,
  type QrSizeDepthContext,
} from 'gps-plus-slam-app-framework/ar/qr/qr-size-depth-context';
import type { DepthSample } from 'gps-plus-slam-app-framework/types/ar-types';

/** Default cap on retained depth samples — matches the recorder QR history (100). */
const DEFAULT_QR_DEPTH_HISTORY = 100;

export interface QrDepthResolver {
  /**
   * Add one recorded depth sample to the history (oldest dropped past the cap).
   * Idempotent on identity: appending the same sample object twice is a no-op,
   * so a store subscriber can call it on every change without de-duping itself.
   */
  append(sample: DepthSample): void;
  /**
   * The depth context active at `timestamp` (the latest sample with
   * `sample.timestamp ≤ timestamp`), or `null` when no such sample exists or it
   * lacks a usable projection (no unprojector). Best-effort — never throws.
   */
  resolveDepthAt(timestamp: number): QrSizeDepthContext | null;
  /** Drop all retained samples (e.g. on session end / replay reset). */
  reset(): void;
}

/**
 * Create an as-of depth resolver. Samples are expected to arrive in roughly
 * non-decreasing timestamp order (the capture/replay cadence), but the lookup
 * scans for the latest `≤ timestamp` regardless of insertion order, so a
 * momentarily out-of-order append is tolerated.
 */
export function createQrDepthResolver(options?: {
  maxSamples?: number;
}): QrDepthResolver {
  const maxSamples = options?.maxSamples ?? DEFAULT_QR_DEPTH_HISTORY;
  const samples: DepthSample[] = [];
  let last: DepthSample | null = null;
  // F-9 (2026-07-10 quality review): the same depth sample is typically
  // resolved 4–8× per sample per marker; rebuilding the context each time
  // was redundant. Memo keyed on the resolved sample's identity.
  let lastResolvedSample: DepthSample | null = null;
  let lastContext: QrSizeDepthContext | null = null;

  return {
    append(sample: DepthSample): void {
      if (sample === last) return; // same object → already recorded
      last = sample;
      samples.push(sample);
      // In-place trim (no fresh array per overflowing sample).
      while (samples.length > maxSamples) {
        samples.shift();
      }
    },
    resolveDepthAt(timestamp: number): QrSizeDepthContext | null {
      // Latest sample at or before the query timestamp (the as-of join).
      let best: DepthSample | null = null;
      for (const s of samples) {
        if (s.timestamp <= timestamp) {
          if (!best || s.timestamp > best.timestamp) best = s;
        }
      }
      if (!best) return null;
      if (best === lastResolvedSample) return lastContext;
      lastResolvedSample = best;
      lastContext = createQrSizeDepthContext(best);
      return lastContext;
    },
    reset(): void {
      samples.length = 0;
      last = null;
      lastResolvedSample = null;
      lastContext = null;
    },
  };
}
