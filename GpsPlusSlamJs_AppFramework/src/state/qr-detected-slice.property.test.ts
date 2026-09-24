/**
 * `qrDetected` slice — property tests.
 *
 * Why this test matters: the two load-bearing invariants are "the ring buffer
 * NEVER exceeds maxHistory regardless of the dispatch sequence" (the no-leak
 * guarantee a naive overlay relies on) and "the latest entry is always the
 * most-recently recorded one" (the overlay-persistence source). Both must hold
 * for arbitrary interleavings of detections across arbitrary payloads.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  qrDetectedReducer,
  recordQrDetection,
  selectLatestQrDetection,
  medianQrPosition,
  type QrDetectedState,
  type QrDetectionEntry,
} from './qr-detected-slice';

function entry(text: string, t: number, x: number): QrDetectionEntry {
  return {
    text,
    qrPoseWorld: { position: [x, 0, 0], rotation: [0, 0, 0, 1] },
    qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
    reprojectionErrorPx: 0,
    timestamp: t,
  };
}

describe('qrDetected ring-buffer invariants', () => {
  it('never exceeds maxHistory for any dispatch sequence', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom('A', 'B', 'C'), fc.integer()), {
          maxLength: 200,
        }),
        fc.integer({ min: 0, max: 16 }),
        (events, cap) => {
          let s: QrDetectedState = {
            maxHistory: cap,
            markers: {},
          };
          let t = 0;
          for (const [text] of events) {
            s = qrDetectedReducer(s, recordQrDetection(entry(text, t++, 0)));
          }
          for (const marker of Object.values(s.markers)) {
            expect(marker.detections.length).toBeLessThanOrEqual(cap);
          }
        }
      )
    );
  });

  it('keeps the newest detection per marker as the latest', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('A', 'B'), { minLength: 1, maxLength: 50 }),
        (texts) => {
          let s: QrDetectedState = { maxHistory: 8, markers: {} };
          const lastT: Record<string, number> = {};
          let t = 0;
          for (const text of texts) {
            t += 1;
            lastT[text] = t;
            s = qrDetectedReducer(s, recordQrDetection(entry(text, t, 0)));
          }
          for (const [text, expected] of Object.entries(lastT)) {
            expect(
              selectLatestQrDetection({ qrDetected: s }, text)?.timestamp
            ).toBe(expected);
          }
        }
      )
    );
  });
});

describe('medianQrPosition robustness', () => {
  it('lands within the inlier range when inliers are the majority', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.integer({ min: 3, max: 20 }),
        (inlierX, inlierCount) => {
          const entries: QrDetectionEntry[] = [];
          for (let i = 0; i < inlierCount; i++) {
            entries.push(entry('A', i, inlierX));
          }
          // Fewer outliers than inliers → median must stay at the inlier value.
          const outliers = Math.floor((inlierCount - 1) / 2);
          for (let i = 0; i < outliers; i++) {
            entries.push(entry('A', 1000 + i, inlierX + 1000));
          }
          const m = medianQrPosition(entries);
          expect(m?.[0]).toBeCloseTo(inlierX, 9);
        }
      )
    );
  });
});

describe('qrDetected frame-epoch invariant (M3b b2)', () => {
  // Why this test matters: the fused QR window trusts that two detections
  // share a coordinate frame exactly when their `frameEpoch` is equal. For
  // any interleaving of detections and frame changes, each entry's epoch
  // must equal the number of frame changes dispatched before it.
  it('stamps each entry with the count of earlier frame changes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc
              .constantFrom('A', 'B')
              .map((text) => ({ kind: 'det' as const, text })),
            fc
              .constantFrom(
                'gpsData/odometryTrackingRestarted',
                'gpsData/arLoopClosureDetected',
                'tracking/clearLastRestartedPayload',
                'qrDetected/qrFrameChanged',
                'gpsData/unrelated'
              )
              .map((type) => ({ kind: 'act' as const, type }))
          ),
          { maxLength: 40 }
        ),
        (ops) => {
          let s: QrDetectedState = { maxHistory: 100, markers: {} };
          let changes = 0;
          const expected: Record<string, number[]> = {};
          ops.forEach((op, i) => {
            if (op.kind === 'det') {
              s = qrDetectedReducer(
                s,
                recordQrDetection({
                  text: op.text,
                  timestamp: i,
                  qrPoseWorld: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
                })
              );
              (expected[op.text] ??= []).push(changes);
            } else {
              s = qrDetectedReducer(s, { type: op.type });
              if (op.type !== 'gpsData/unrelated') changes++;
            }
          });
          for (const [text, epochs] of Object.entries(expected)) {
            expect(
              s.markers[text]!.detections.map((d) => d.frameEpoch)
            ).toEqual(epochs);
          }
          expect(s.frameEpoch ?? 0).toBe(changes);
        }
      )
    );
  });
});
