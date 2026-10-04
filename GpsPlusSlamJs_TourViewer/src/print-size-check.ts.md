# print-size-check.ts

## Purpose

The creator's print-size check (QR size consensus plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0350-qr-size-consensus-plan.md`,
§11-§13, S3a). Printed codes come out smaller than asked when a print
dialog's fit-to-page shrinks them (the owner's 16 cm print measured
15.45 cm), and the level then states the wrong size to every visitor. While
the creator walks at a code in the AR step, this measures the print by
parallax and offers the measured size when it parts from the typed one.

## Public API

- `createPrintSizeCheck({ estimate })` → `PrintSizeCheck`
  - `estimate(text)`: the parallax estimate over the code's current
    entries (in the app, `estimateQrSizeFromParallax(selectQrFusedEntries(...))`).
  - `onDetection(text, fused, typedSizeM)`: one detection - measured unless
    the fused result reads the code as turning; once three independent
    windows exist, either an offer or a quiet "confirmed".
  - `offer()` → `{ text, sizeM } | null`; `pending(text)` - no answer yet
    (the ready line asks for a sideways step); `answer(text, "kept" |
"adopted")`; `reset()` (a new AR session or tour).

## Invariants & assumptions

- **The rule is the framework's** (`createQrParallaxSizeTally`,
  `measuredSizeOffer`: three independent windows past 2 % on one side).
  Sized by simulated creator sessions (plan §13): no false offer on a
  correct print for tracker jitter up to 1 cm and drift up to 0.5 cm/s; a
  96.6 % print caught in 38-93 % of sessions. A miss only leaves the typed
  size.
- **Once per code per session:** after an answer (kept, adopted or the
  quiet confirmation) the code is not measured again; an offer waiting for
  the creator is not replaced.
- **The evidence does not depend on the typed size** (nominal-size solves),
  so an adoption - which restarts the measuring - does not reset the check.
- The measured size carries the author phone's own scale error to every
  visitor (plan §12 #9); the offer asks for a ruler check.

## Tests

`print-size-check.test.ts` - the offer after three agreeing windows, the
quiet confirmation, no measuring while turning, once per code (kept),
evidence kept across an adoption, codes apart and reset.
`fused-pose-wiring.test.ts` - the creator feeds every detection to it,
shows the offer, adopting restarts at the measured size (new controller, old
detections cleared, a saved position invalidated), keeping dismisses it.
