/**
 * Property tests for the CameraFrameSource capture veto (QR perf plan
 * 2026-09-23, M3).
 *
 * Why these tests matter: the veto exists so that NO frame is read back from
 * the GPU while the detector is still busy (it would be dropped), while the
 * throttle still caps captures at one per interval, and while a detector that
 * frees up is fed again on the very next due frame. Example tests pin single
 * scenarios; this drives random frame rates and random decode latencies
 * through a simulated detector and checks all three invariants every time.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CameraFrameSource } from './camera-frame-source';
import type { RgbaImage } from './qr/qr-frontend';

const INTERVAL_MS = 125;
const IMAGE: RgbaImage = {
  data: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
};

describe('CameraFrameSource wantsFrame (property)', () => {
  it('never captures while busy, never faster than the interval, and never idles a free detector past its due frame', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(1000 / 30, 1000 / 60, 1000 / 72),
        fc.array(fc.integer({ min: 1, max: 600 }), {
          minLength: 5,
          maxLength: 40,
        }),
        (frameMs, latencies) => {
          let busyUntil = -Infinity;
          let decodeIndex = 0;
          const captures: number[] = [];
          let now = 0;
          const src = new CameraFrameSource(
            {
              capture: () => IMAGE,
              onCapture: () => {
                captures.push(now);
                const latency = latencies[decodeIndex % latencies.length]!;
                decodeIndex += 1;
                busyUntil = now + latency;
              },
            },
            { intervalMs: INTERVAL_MS }
          );
          src.setWantsFrame(() => now >= busyUntil);
          src.start();

          let lastCapture = -Infinity;
          const violations: string[] = [];
          for (let frame = 0; frame < 600; frame++) {
            now = frame * frameMs;
            const before = captures.length;
            const wasFree = now >= busyUntil;
            const due = now - lastCapture >= INTERVAL_MS;
            src.onFrame(now);
            const captured = captures.length > before;
            // 1. Only captured while the detector was free.
            if (captured && !wasFree) violations.push(`busy capture @${now}`);
            // 2. Never faster than the interval.
            if (captured && !due) violations.push(`early capture @${now}`);
            // 3. A free detector with a due slot is never left waiting.
            if (!captured && wasFree && due) violations.push(`idle @${now}`);
            if (captured) lastCapture = now;
          }
          expect(violations).toEqual([]);
        }
      ),
      { numRuns: 200 }
    );
  });
});
