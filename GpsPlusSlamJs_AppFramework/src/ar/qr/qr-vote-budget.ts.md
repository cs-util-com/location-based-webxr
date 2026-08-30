# qr-vote-budget.ts

**Purpose:** the per-code synthetic-vote budget shared by every app that wires
`createQrTrackingController`'s `dispatchVotes`.

## Public API

- `MAX_VOTED_LOCKS_PER_CODE = 10` — locked frames per code that actually vote.
- `createQrVoteBudget(maxLocksPerCode?): QrVoteBudget`
  - `tryConsume(text)` — charge one batch, `false` once the cap is reached.
    Does **not** charge when it returns `false`.
  - `spentFor(text)` — batches already spent, for status lines.
  - `reset()` — forget every code (store swap, session end).

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
  refused charge does not consume, `spentFor` tracks, `reset` clears.
