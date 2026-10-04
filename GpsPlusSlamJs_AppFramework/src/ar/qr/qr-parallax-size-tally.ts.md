# qr-parallax-size-tally.ts

## Purpose

One counting rule for a QR code's size from parallax (QR size consensus plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0350-qr-size-consensus-plan.md`,
§11-§13, S3a), shared by the QR demo's `?qrperf` report and the
TourViewer's print check (DEC-H3), and the rule for offering a measured size
in place of a typed one.

## Public API

- `createQrParallaxSizeTally()` → per code text:
  - `add(text, { parallax, turning })` → `'accepted' | 'refused' |
'turning'`: a window read while the code turned is counted, never kept
    (parallax needs a still code); a null estimate is refused; anything else
    is accepted.
  - `counts(text)`, `accepted(text)` (every accepted window, oldest first),
    `independent(text)` (the accepted windows that start after the last kept
    one ended), `reset(text?)`.
- `measuredSizeOffer(independent, typedSizeM, { windows = 3, tolerance =
0.02 })` → `{ sizeM } | null`: the median of the FIRST `windows`
  independent windows, offered only when all of them lie past the tolerance
  on the same side of the typed size.

## Invariants & assumptions

- **Independent, not every window:** the estimate runs after every
  detection over the newest ~32 entries, so consecutive windows share most
  of their views; only a window starting after the last kept one ended is
  new evidence (plan §12 #1). At 8 Hz that is one window per ~4 s of views.
- **The offer errs toward silence** (plan §13): simulated creator sessions
  (40 cm sweeps, 0.8-1.5 m, 1 px) gave 0/60 false offers on a correct print
  with three windows at 2 % for white tracker jitter up to 1 cm and drift up
  to 0.5 cm/s (2-4/60 at 1 cm/s), and caught a 96.6 % print in 38-93 % of
  sessions. One window at 2 % offered on up to 40 % of correct prints.
- The FIRST windows decide, so a later wild window cannot flip an answer.
- The tally holds only what it is given; each consumer computes its own
  statistics over `accepted` (the demo's nearest-rank percentiles).

## Tests

`qr-parallax-size-tally.test.ts` - the three outcomes per code, the
independence rule, reset; the offer's median, its silence below three
windows, within the tolerance, across both sides and with one window inside,
a larger print, other settings, first windows over later ones, an unusable
typed size. The independence, same-side and window-count rules are
mutation-checked.
