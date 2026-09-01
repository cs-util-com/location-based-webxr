/**
 * The per-code synthetic-vote budget — ONE implementation, shared by every
 * app that wires `createQrTrackingController`'s `dispatchVotes`.
 *
 * Why it is shared (DEC-H3: shared behaviour carrying a contract is unified):
 * `onLocked` fires on EVERY successful detection once locked, not once per
 * lock transition. At the camera-frame cadence that is a fresh vote batch
 * several times a second, for as long as a code stays in view — so a visitor
 * (or an author) standing at a poster injects thousands of near-identical
 * synthetic GPS points and pins the alignment centroid to the poster.
 *
 * The TourViewer learned this in its own M4 review and grew a budget; the
 * RecorderApp wired the same controller with the same vote count and no
 * budget at all (PR #385 review), which matters more there: the recorder's
 * alignment is what `qr-anchor-mint` mints every OTHER code in the session
 * against, so a pinned centroid propagates one code's error into every new
 * `qr/<id>.json`.
 *
 * @see qr-vote-budget.ts.md
 */

/**
 * Locked frames per code that actually vote.
 *
 * Ten batches at four correspondences each is enough to move an alignment
 * without dominating it. Tuned by the TourViewer's M5 work; a consumer may
 * pass its own cap, but the default is deliberately the same in both apps.
 */
export const MAX_VOTED_LOCKS_PER_CODE = 10;

/** Per-code vote accounting for one session. */
export interface QrVoteBudget {
  /**
   * Charge one vote batch to `text`, returning whether it may proceed.
   *
   * Returns `false` once the code has spent its budget, and does NOT charge
   * in that case — so a code at its cap stays at its cap rather than
   * counting frames it never voted on.
   */
  tryConsume(text: string): boolean;
  /** Batches already spent by `text` — for status lines. */
  spentFor(text: string): number;
  /** Forget every code (store swap, session end). */
  reset(): void;
}

export function createQrVoteBudget(
  maxLocksPerCode: number = MAX_VOTED_LOCKS_PER_CODE
): QrVoteBudget {
  const spent = new Map<string, number>();
  return {
    tryConsume(text) {
      const used = spent.get(text) ?? 0;
      if (used >= maxLocksPerCode) return false;
      spent.set(text, used + 1);
      return true;
    },
    spentFor: (text) => spent.get(text) ?? 0,
    reset: () => {
      spent.clear();
    },
  };
}
