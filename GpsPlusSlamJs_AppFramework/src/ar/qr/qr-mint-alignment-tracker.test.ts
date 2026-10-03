import { describe, expect, it } from 'vitest';
import {
  QR_MINT_MATURE_GPS_EXTENT_M,
  createQrMintAlignmentTracker,
} from './qr-mint-alignment-tracker.js';
import type { QrMintAlignmentNow } from './qr-anchor-mint.js';
import type { Matrix4 } from '../../core/index.js';

const ZERO = { lat: 48.1, lon: 11.5 };

/** A distinguishable alignment: translation x = `tag`. */
function alignment(
  tag: number,
  gpsExtentM: number,
  segment = 0
): QrMintAlignmentNow {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tag, 0, 0, 1] as Matrix4;
  return {
    alignmentMatrix: m,
    zero: ZERO,
    alignmentSampleCount: 10 + tag,
    gpsExtentM,
    segment,
  };
}
const tagOf = (a: QrMintAlignmentNow): number => a.alignmentMatrix?.[12] ?? -1;

const CODE = 'https://example.invalid/?qr=a';
const OTHER = 'https://example.invalid/?qr=b';
const MATURE = QR_MINT_MATURE_GPS_EXTENT_M;

describe('createQrMintAlignmentTracker (D28 revised: the first mature alignment at or after the last sighting)', () => {
  // Why this test matters: the measured reason for the 80 m floor lives in
  // the constant's doc; a silent edit would change every minted code.
  it('names 80 m as the maturity floor', () => {
    expect(QR_MINT_MATURE_GPS_EXTENT_M).toBe(80);
  });

  // Why this test matters: this is the rule. A code seen while the walk is
  // still short keeps following the alignment as it improves, and stops at
  // the first alignment whose GPS extent reaches the floor, so the SLAM
  // drift walked after that does not reach it (the left-behind regression of
  // "alignment at save", 8.6 m p50 at 500 m away).
  it('follows the alignment after the sighting and freezes at the first mature one', () => {
    const tracker = createQrMintAlignmentTracker();
    tracker.noteSighting(CODE, alignment(1, 2));
    tracker.noteAlignment(alignment(2, 30));
    tracker.noteAlignment(alignment(3, MATURE - 0.1));
    tracker.noteAlignment(alignment(4, MATURE));
    tracker.noteAlignment(alignment(5, 400));
    const live = alignment(6, 500);
    expect(tagOf(tracker.alignmentFor(CODE, live))).toBe(4);
  });

  // Why this test matters: a code seen after the walk has matured is placed
  // through the alignment of its own sighting, never a later one.
  it('freezes at the sighting itself when the alignment is already mature', () => {
    const tracker = createQrMintAlignmentTracker();
    tracker.noteSighting(CODE, alignment(1, 120));
    tracker.noteAlignment(alignment(2, 300));
    expect(tagOf(tracker.alignmentFor(CODE, alignment(3, 600)))).toBe(1);
  });

  // Why this test matters: the start-at-code fix must survive. A recording
  // saved before the alignment matures falls back to the alignment AT SAVE
  // (a2), the live one the caller passes, not the immature snapshot of the
  // sighting (72 degrees heading p50).
  it('falls back to the live alignment at save before maturity', () => {
    const tracker = createQrMintAlignmentTracker();
    tracker.noteSighting(CODE, alignment(1, 0.5));
    tracker.noteAlignment(alignment(2, 20));
    expect(tagOf(tracker.alignmentFor(CODE, alignment(3, 40)))).toBe(3);
  });

  // Why this test matters: "the LAST sighting" - a new sighting of the code
  // re-opens it, so it is placed through an alignment at or after the visit
  // that counts, not one frozen before it.
  it('re-opens a frozen code on a new sighting', () => {
    const tracker = createQrMintAlignmentTracker();
    tracker.noteSighting(CODE, alignment(1, 10));
    tracker.noteAlignment(alignment(2, MATURE));
    tracker.noteAlignment(alignment(3, 200));
    tracker.noteSighting(CODE, alignment(4, 250));
    tracker.noteAlignment(alignment(5, 300));
    expect(tagOf(tracker.alignmentFor(CODE, alignment(6, 400)))).toBe(4);
  });

  // Why this test matters: codes are tracked independently; one code's
  // sighting must not move another's frozen alignment.
  it('keeps each code to its own sightings', () => {
    const tracker = createQrMintAlignmentTracker();
    tracker.noteSighting(CODE, alignment(1, 100));
    tracker.noteSighting(OTHER, alignment(2, 5));
    tracker.noteAlignment(alignment(3, 150));
    expect(tagOf(tracker.alignmentFor(CODE, alignment(9, 900)))).toBe(1);
    expect(tagOf(tracker.alignmentFor(OTHER, alignment(9, 900)))).toBe(3);
  });

  // Why this test matters: after a tracking restart or a loop closure the
  // alignment describes another odometry frame. A code still waiting for
  // maturity is placed through the alignment its segment CLOSED with (the
  // M1 review fix), and an alignment of the next segment never reaches it.
  it('freezes a waiting code at its segment closing alignment', () => {
    const tracker = createQrMintAlignmentTracker();
    tracker.noteSighting(CODE, alignment(1, 3, 0));
    tracker.noteAlignment(alignment(2, 25, 0));
    tracker.closeSegment(alignment(3, 30, 0));
    tracker.noteAlignment(alignment(4, 200, 1));
    expect(tagOf(tracker.alignmentFor(CODE, alignment(5, 300, 1)))).toBe(3);
  });

  // Why this test matters: a code that matured BEFORE the restart keeps its
  // mature alignment; the closing one is later and carries more drift.
  it('keeps a mature alignment across a segment close', () => {
    const tracker = createQrMintAlignmentTracker();
    tracker.noteSighting(CODE, alignment(1, 3, 0));
    tracker.noteAlignment(alignment(2, MATURE, 0));
    tracker.closeSegment(alignment(3, 300, 0));
    expect(tagOf(tracker.alignmentFor(CODE, alignment(4, 0, 1)))).toBe(2);
  });

  // Why this test matters: an alignment with no matrix or no zero cannot
  // place anything, so it must neither freeze a code nor replace a usable
  // snapshot with an unusable one.
  it('ignores an alignment that cannot place a code', () => {
    const tracker = createQrMintAlignmentTracker();
    tracker.noteSighting(CODE, alignment(1, 5));
    tracker.noteAlignment({
      alignmentMatrix: null,
      zero: null,
      alignmentSampleCount: 0,
      gpsExtentM: 500,
      segment: 0,
    });
    tracker.noteAlignment(alignment(2, MATURE));
    expect(tagOf(tracker.alignmentFor(CODE, alignment(3, 900)))).toBe(2);
  });

  // Why this test matters: an alignment whose extent is unknown cannot be
  // called mature; it is followed but never frozen on.
  it('never treats an unknown extent as mature', () => {
    const tracker = createQrMintAlignmentTracker();
    const { gpsExtentM: _drop, ...noExtent } = alignment(1, 0);
    tracker.noteSighting(CODE, noExtent);
    tracker.noteAlignment({ ...alignment(2, 0), gpsExtentM: Number.NaN });
    expect(tagOf(tracker.alignmentFor(CODE, alignment(3, 10)))).toBe(3);
  });

  // Why this test matters: a code the tracker never saw (a caller that did
  // not report its sightings) still mints, through the live alignment.
  it('hands back the live alignment for a code it never saw', () => {
    const tracker = createQrMintAlignmentTracker();
    expect(tagOf(tracker.alignmentFor(CODE, alignment(7, 1)))).toBe(7);
  });

  // Why this test matters: a store swap discards the sightings; a frozen
  // alignment from the previous store must not outlive them.
  it('forgets everything on reset', () => {
    const tracker = createQrMintAlignmentTracker();
    tracker.noteSighting(CODE, alignment(1, 100));
    tracker.reset();
    expect(tagOf(tracker.alignmentFor(CODE, alignment(2, 3)))).toBe(2);
  });

  // Why this test matters: the floor is a parameter (swept 10-80 m in the
  // start-at-code measurement); a caller may set it.
  it('takes the floor as an option', () => {
    const tracker = createQrMintAlignmentTracker({ matureGpsExtentM: 20 });
    tracker.noteSighting(CODE, alignment(1, 5));
    tracker.noteAlignment(alignment(2, 20));
    tracker.noteAlignment(alignment(3, 30));
    expect(tagOf(tracker.alignmentFor(CODE, alignment(4, 40)))).toBe(2);
    expect(() =>
      createQrMintAlignmentTracker({ matureGpsExtentM: Number.NaN })
    ).toThrow(RangeError);
  });
});
