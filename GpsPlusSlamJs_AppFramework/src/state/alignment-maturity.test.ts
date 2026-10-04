import { describe, expect, it } from 'vitest';
import {
  MATURE_GPS_EXTENT_M,
  advanceMatureAlignmentPick,
  checkMatureGpsExtentM,
  isMatureAlignment,
  isUsableAlignment,
  openMatureAlignmentPick,
  type AlignmentMoment,
} from './alignment-maturity.js';

const ZERO = { lat: 48.1, lon: 11.5 };

/** A distinguishable moment: translation x = `tag`. */
function moment(
  tag: number,
  gpsExtentM: number | undefined,
  options: { matrix?: boolean; zero?: boolean } = {}
): AlignmentMoment & { tag: number } {
  return {
    tag,
    alignmentMatrix:
      options.matrix === false
        ? null
        : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tag, 0, 0, 1],
    zero: options.zero === false ? null : ZERO,
    ...(gpsExtentM === undefined ? {} : { gpsExtentM }),
  };
}

describe('alignment maturity (D28 revised, D33): the first mature alignment at or after an event', () => {
  // Why this test matters: the reason for the 40 m floor (the owner's D34,
  // lowered from 80 m) lives in the constant's doc, and three callers (the QR mint, the GPS anchor's
  // mature-alignment start-up, the Tour Viewer's authoring settle) read
  // this ONE value; a silent edit would move every minted code and settled
  // note.
  it('names 40 m as the maturity floor', () => {
    expect(MATURE_GPS_EXTENT_M).toBe(40);
  });

  // Why this test matters: the floor is the only evidence that the yaw is
  // observable. An unknown, NaN or infinite extent must never pass it, and
  // an alignment without a matrix or a zero cannot place anything at all.
  it('calls an alignment mature only with a matrix, a zero and a finite extent at the floor', () => {
    expect(isMatureAlignment(moment(1, MATURE_GPS_EXTENT_M))).toBe(true);
    expect(isMatureAlignment(moment(1, MATURE_GPS_EXTENT_M - 0.001))).toBe(
      false
    );
    expect(isMatureAlignment(moment(1, undefined))).toBe(false);
    expect(isMatureAlignment(moment(1, Number.NaN))).toBe(false);
    expect(isMatureAlignment(moment(1, Number.POSITIVE_INFINITY))).toBe(false);
    expect(isMatureAlignment(moment(1, 500, { matrix: false }))).toBe(false);
    expect(isMatureAlignment(moment(1, 500, { zero: false }))).toBe(false);
    expect(isMatureAlignment(moment(1, 40), 40)).toBe(true);
    expect(isUsableAlignment(moment(1, undefined))).toBe(true);
    expect(isUsableAlignment(moment(1, 5, { zero: false }))).toBe(false);
  });

  // Why this test matters: a caller-supplied floor that is zero, negative
  // or not finite would make every alignment mature (or none), silently.
  it('refuses a floor that is not a positive, finite number of metres', () => {
    expect(checkMatureGpsExtentM(undefined)).toBe(MATURE_GPS_EXTENT_M);
    expect(checkMatureGpsExtentM(12.5)).toBe(12.5);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => checkMatureGpsExtentM(bad)).toThrow(RangeError);
    }
  });

  // Why this test matters: this is the rule. An object placed while the
  // walk is still short follows the alignment as it improves and stops at
  // the first mature one, so the SLAM drift walked after that does not
  // reach it (the left-behind regression: 8.4 m at 500 m and 1 % / 1 deg).
  it('follows the alignment after the event and freezes at the first mature one', () => {
    let pick = openMatureAlignmentPick(moment(1, 2));
    expect(pick.mature).toBe(false);
    for (const [tag, extent] of [
      [2, 30],
      [3, MATURE_GPS_EXTENT_M - 0.1],
      [4, MATURE_GPS_EXTENT_M],
      [5, 400],
    ] as const) {
      pick = advanceMatureAlignmentPick(pick, moment(tag, extent));
    }
    expect(pick.mature).toBe(true);
    expect(pick.alignment.tag).toBe(4);
  });

  // Why this test matters: an object placed after the walk has matured is
  // fixed through the alignment of its own moment, never a later one.
  it('freezes at the event itself when the alignment is already mature', () => {
    let pick = openMatureAlignmentPick(moment(1, 120));
    pick = advanceMatureAlignmentPick(pick, moment(2, 300));
    expect(pick.alignment.tag).toBe(1);
  });

  // Why this test matters: a GPS gap or a reset store (no matrix, no zero)
  // must not overwrite the last alignment the object could be placed
  // through - the fallback at the visit's end needs a usable one.
  it('keeps the last usable alignment through an unusable one', () => {
    let pick = openMatureAlignmentPick(moment(1, 10));
    pick = advanceMatureAlignmentPick(pick, moment(2, 90, { matrix: false }));
    pick = advanceMatureAlignmentPick(pick, moment(3, 95, { zero: false }));
    expect(pick.mature).toBe(false);
    expect(pick.alignment.tag).toBe(1);
  });

  // Why this test matters: the floor is the caller's to vary (the
  // measurements sweep 40 m and 80 m), and the pick must honour it. The
  // caller floor (20 m) differs from the default, so the default could not
  // pass for it: under 40 m the pick would follow on to the 90 m alignment.
  it('honours a caller floor', () => {
    let pick = openMatureAlignmentPick(moment(1, 10), 20);
    pick = advanceMatureAlignmentPick(pick, moment(2, 21), 20);
    pick = advanceMatureAlignmentPick(pick, moment(3, 90), 20);
    expect(pick.alignment.tag).toBe(2);
  });
});
