# qr-vote-budget.ts

**Purpose:** the per-code synthetic-vote budget shared by every app that wires
`createQrTrackingController`'s `dispatchVotes`.

## Public API

- `MAX_VOTED_LOCKS_PER_CODE = 10` — locked frames per code that actually vote.
- `createQrVoteBudget(maxLocksPerCode?): QrVoteBudget`
  - `tryConsume(text)` — charge one batch, `false` once the cap is reached.
    Does **not** charge when it returns `false`.
  - `spentFor(text)` — batches already spent, for status lines.
  - `isSpent(text)` — whether the code is at THIS budget's cap; the
    TourViewer and the recorder skip the fused-pose solve for it (QR
    near-frontal pose plan §71).
  - `reset()` — forget every code (store swap, session end).
  - `forget(text)` - forget one code, so its next lock may vote again while
    the others keep their spend; a code never charged is a no-op. The Tour
    Viewer re-arms a code whose kept pose outlived its hold (authoring plan
    2026-09-28-0953, M2b review).

## Invariants & assumptions

- **The cap exists because `onLocked` is per DETECTION, not per lock
  transition.** `detection-scheduler` fires it on every successful detection
  once locked, so at the camera-frame cadence one code in view produces a
  fresh vote batch several times a second, unbounded. Thousands of
  near-identical synthetic GPS points pin the alignment centroid to the
  poster.
- **Check "can the store accept this?" BEFORE charging.** `recordGpsEvent`
  silently no-ops until the session zero exists (the first real GPS fix), so
  charging for dropped votes both wastes the budget and over-reports what
  landed. The acceptance test itself stays app-side — it is app state — but
  the ORDER is part of this contract.
- **Shared rather than copied** (DEC-H3). The TourViewer grew this in its M4
  review; the RecorderApp wired the same controller with the same vote count
  and no budget at all until PR #385 caught it. That asymmetry mattered more
  in the recorder, whose alignment is what `qr-anchor-mint` mints every other
  code against — a pinned centroid propagates one code's error into every new
  `qr/<id>.json`.

## Tests

- `qr-vote-budget.test.ts` — the cap holds per code, codes are independent, a
  refused charge does not consume, `spentFor` tracks, `reset` clears,
  `isSpent` at the budget's own cap, `forget` re-arms one code only.
