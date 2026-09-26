/**
 * Properties of `createFusedPoseTally` (QR near-frontal pose plan §66-§67).
 *
 * Why these tests matter: the readouts are read as shares ("stable 12 of
 * 40, fit 20"), which is only honest when every lock lands in exactly one
 * bucket and every add is either a lock or a re-read, never both.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { QrFusedPose } from './qr-fused-pose';
import { createFusedPoseTally } from './qr-fused-pose-tally';

const reasons = ['views', 'fit', 'fallback', 'motion', 'order'] as const;

/** A fused result as the tracker can produce it: a reason iff not stable. */
const resultArb: fc.Arbitrary<QrFusedPose> = fc
  .record({
    stable: fc.boolean(),
    reason: fc.constantFrom(...reasons),
    epoch: fc.integer({ min: 0, max: 2 }),
    newest: fc.oneof(fc.constant(Number.NaN), fc.integer({ min: 0, max: 3 })),
    nativeIgnored: fc.integer({ min: 0, max: 2 }),
  })
  .map(({ stable, reason, epoch, newest, nativeIgnored }) => ({
    status: stable ? 'stable' : 'measuring',
    pose: null,
    method: null,
    views: 5,
    droppedViews: 0,
    fitPx: 1,
    windowEntries: 5,
    averagedRotationDeltaDeg: Number.NaN,
    frameEpoch: epoch,
    oldestTimestamp: 0,
    newestTimestamp: newest,
    motion: null,
    edgePx: null,
    notStableReason: stable ? null : reason,
    nativeIgnored,
  }));

describe('createFusedPoseTally properties', () => {
  it('puts every add in exactly one of lock or re-read, and every lock in one bucket', () => {
    fc.assert(
      fc.property(fc.array(resultArb, { maxLength: 60 }), (results) => {
        const t = createFusedPoseTally();
        let counted = 0;
        for (const r of results) {
          const before = t.summary();
          const isLock = t.add(r);
          const after = t.summary();
          if (isLock) counted += 1;
          expect(after.locks - before.locks).toBe(isLock ? 1 : 0);
          expect(after.reReads - before.reReads).toBe(isLock ? 0 : 1);
        }
        const s = t.summary();
        const reasonSum = reasons.reduce((sum, k) => sum + s.notStable[k], 0);
        expect(s.locks).toBe(counted);
        expect(s.locks + s.reReads).toBe(results.length);
        expect(s.stable + reasonSum).toBe(s.locks);
      })
    );
  });
});
