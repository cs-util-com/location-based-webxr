/**
 * The parallax size tally and the measured-size offer (QR size consensus
 * plan 2026-09-27-0350, §11-§13, S3a): one counting rule for every app that
 * reads a code's size from parallax - the QR demo's report and the
 * TourViewer's print check (DEC-H3). See qr-parallax-size-tally.ts.md.
 */

import type { QrParallaxSize } from './qr-size-parallax.js';
import { interpolatingMedian } from '../../utils/median.js';

/** One accepted parallax window. */
export type QrParallaxSizeWindow = Pick<
  QrParallaxSize,
  'sizeM' | 'lateralBaselineM' | 'views' | 'oldestTimestamp' | 'newestTimestamp'
>;

/** One sample: the estimate (null when it refused) and the code's motion. */
export interface QrParallaxSizeSample {
  parallax: QrParallaxSizeWindow | null;
  /** The motion detector read the code as turning: parallax needs it still. */
  turning: boolean;
}

export type QrParallaxSizeOutcome = 'accepted' | 'refused' | 'turning';

export interface QrParallaxSizeCounts {
  accepted: number;
  refused: number;
  turning: number;
}

export interface QrParallaxSizeTally {
  /** Count one sample of `text`; says where it went. */
  add(text: string, sample: QrParallaxSizeSample): QrParallaxSizeOutcome;
  counts(text: string): QrParallaxSizeCounts;
  /** Every accepted window of `text`, oldest first. */
  accepted(text: string): readonly QrParallaxSizeWindow[];
  /**
   * The accepted windows that are independent evidence, oldest first: each
   * starts after the previously kept one ended (consecutive windows over
   * the newest entries share most of them; plan §12 #1).
   */
  independent(text: string): readonly QrParallaxSizeWindow[];
  /** Forget one code, or all. */
  reset(text?: string): void;
}

interface CodeTally {
  counts: QrParallaxSizeCounts;
  accepted: QrParallaxSizeWindow[];
  independent: QrParallaxSizeWindow[];
}

export function createQrParallaxSizeTally(): QrParallaxSizeTally {
  const codes = new Map<string, CodeTally>();
  const codeOf = (text: string): CodeTally => {
    let c = codes.get(text);
    if (!c) {
      c = {
        counts: { accepted: 0, refused: 0, turning: 0 },
        accepted: [],
        independent: [],
      };
      codes.set(text, c);
    }
    return c;
  };
  return {
    add(text, sample) {
      const c = codeOf(text);
      if (sample.turning) {
        c.counts.turning += 1;
        return 'turning';
      }
      if (sample.parallax === null) {
        c.counts.refused += 1;
        return 'refused';
      }
      c.counts.accepted += 1;
      c.accepted.push(sample.parallax);
      const last = c.independent[c.independent.length - 1];
      if (!last || sample.parallax.oldestTimestamp > last.newestTimestamp) {
        c.independent.push(sample.parallax);
      }
      return 'accepted';
    },
    counts: (text) => ({ ...codeOf(text).counts }),
    accepted: (text) => codes.get(text)?.accepted ?? [],
    independent: (text) => codes.get(text)?.independent ?? [],
    reset(text) {
      if (text === undefined) codes.clear();
      else codes.delete(text);
    },
  };
}

export interface MeasuredSizeOfferOptions {
  /** Independent windows the offer waits for. Default 3 (plan §13). */
  windows?: number;
  /** How far past the typed size each must be, relative. Default 0.02 (plan §13). */
  tolerance?: number;
}

/**
 * The measured size to offer instead of `typedSizeM`, or null. Offers only
 * when the FIRST `windows` independent windows all lie past the tolerance
 * on the same side of the typed size, and then offers their median. Sized
 * by simulated creator sessions (plan §13): three windows at 2 % never
 * offered on a correct print (white jitter up to 1 cm, drift up to
 * 0.5 cm/s) and caught a 96.6 % print in 38-93 % of sessions; a missed
 * offer only leaves the typed size, a false one would make it worse.
 */
export function measuredSizeOffer(
  independent: readonly QrParallaxSizeWindow[],
  typedSizeM: number,
  options: MeasuredSizeOfferOptions = {}
): { sizeM: number } | null {
  const windows = options.windows ?? 3;
  const tolerance = options.tolerance ?? 0.02;
  if (!(typedSizeM > 0) || !Number.isFinite(typedSizeM)) return null;
  if (independent.length < windows) return null;
  const rel = independent
    .slice(0, windows)
    .map((w) => w.sizeM / typedSizeM - 1);
  const over = rel.every((e) => e > tolerance);
  const under = rel.every((e) => e < -tolerance);
  if (!over && !under) return null;
  return {
    sizeM: interpolatingMedian(
      independent.slice(0, windows).map((w) => w.sizeM)
    ),
  };
}
