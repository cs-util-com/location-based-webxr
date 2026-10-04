/**
 * The lock counts of a fused QR pose stream (QR near-frontal pose plan §66).
 *
 * Why these tests matter: the QR demo's `?qrperf` report and the
 * TourViewer's debug readout both say why a code was not stable, and the
 * owner compares those numbers across builds and apps. They must count by
 * ONE rule (DEC-H3): above all, a lock whose newest detection did not
 * advance (an ignored native frame, plan §54) is a re-read and counts
 * nothing else, or every such frame would add a lock and a reason twice.
 */
import { describe, expect, it } from 'vitest';
import type { QrFusedPose } from './qr-fused-pose';
import { createFusedPoseTally } from './qr-fused-pose-tally';

function result(over: Partial<QrFusedPose> = {}): QrFusedPose {
  return {
    status: 'stable',
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    method: 'joint',
    views: 6,
    droppedViews: 0,
    fitPx: 0.8,
    windowEntries: 6,
    averagedRotationDeltaDeg: 1,
    frameEpoch: 0,
    oldestTimestamp: 0,
    // NaN: no window time, so no result reads as a re-read unless a test
    // sets it.
    newestTimestamp: Number.NaN,
    motion: null,
    edgePx: 200,
    notStableReason: null,
    nativeIgnored: 0,
    ...over,
  };
}

const notStable = (
  reason: NonNullable<QrFusedPose['notStableReason']>,
  over: Partial<QrFusedPose> = {}
) => result({ status: 'measuring', notStableReason: reason, ...over });

describe('createFusedPoseTally', () => {
  it('counts the stable locks and each reason a lock was not stable', () => {
    const t = createFusedPoseTally();
    t.add(result());
    t.add(notStable('views'));
    t.add(notStable('fit'));
    t.add(notStable('fit'));
    t.add(notStable('fallback'));
    t.add(notStable('motion'));
    t.add(notStable('order'));
    expect(t.summary()).toEqual({
      locks: 7,
      reReads: 0,
      stable: 1,
      empty: 0,
      nativeIgnoredLocks: 0,
      notStable: { views: 1, fit: 2, fallback: 1, motion: 1, order: 1 },
    });
  });

  // Plan §57 #6: the same epoch and an EQUAL newest timestamp.
  it('counts a lock whose newest detection did not advance as a re-read, and nothing else', () => {
    const t = createFusedPoseTally();
    expect(t.add(result({ newestTimestamp: 100 }))).toBe(true);
    expect(
      t.add(notStable('order', { newestTimestamp: 100, nativeIgnored: 1 }))
    ).toBe(false);
    const s = t.summary();
    expect(s.reReads).toBe(1);
    expect(s.locks).toBe(1);
    expect(s.notStable.order).toBe(0);
    expect(s.nativeIgnoredLocks).toBe(0);
  });

  it('does not take a new epoch, an older timestamp or no timestamp for a re-read', () => {
    const t = createFusedPoseTally();
    t.add(result({ newestTimestamp: 100 }));
    expect(t.add(result({ newestTimestamp: 100, frameEpoch: 1 }))).toBe(true);
    expect(t.add(result({ newestTimestamp: 50, frameEpoch: 1 }))).toBe(true);
    expect(t.add(result({ frameEpoch: 1 }))).toBe(true);
    expect(t.add(result({ frameEpoch: 1 }))).toBe(true);
    expect(t.summary().reReads).toBe(0);
  });

  // An evaluation after a tracking restart sees no entries (plan §67 #7):
  // it is a lock with reason `views`, and also counted apart, so a readout
  // can tell "too few views" from "nothing in this frame yet".
  it('counts an empty (unknown) result as a views lock and as empty', () => {
    const t = createFusedPoseTally();
    t.add(
      result({
        status: 'unknown',
        pose: null,
        method: null,
        views: 0,
        notStableReason: 'views',
      })
    );
    const s = t.summary();
    expect(s.locks).toBe(1);
    expect(s.empty).toBe(1);
    expect(s.notStable.views).toBe(1);
  });

  it('counts the locks whose run had native entries ignored', () => {
    const t = createFusedPoseTally();
    t.add(result({ nativeIgnored: 2 }));
    t.add(result());
    expect(t.summary().nativeIgnoredLocks).toBe(1);
  });

  it('hands out a copy that later locks do not change', () => {
    const t = createFusedPoseTally();
    t.add(notStable('fit'));
    const before = t.summary();
    t.add(notStable('fit'));
    expect(before.locks).toBe(1);
    expect(before.notStable.fit).toBe(1);
  });
});
