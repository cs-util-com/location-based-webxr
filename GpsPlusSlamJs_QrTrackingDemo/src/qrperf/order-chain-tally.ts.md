# order-chain-tally.ts

## Purpose

The `?qrperf` tally of the framework's chained corner order (QR near-frontal
pose plan 2026-09-23-2314, §42 S4). The chain carries a code's corner order
from frame to frame when the finder patterns cannot be read; a chained frame
is labelled `memory` whether its order is right or wrong, so the native
share alone cannot tell whether the chain works. The audit can: on a
finder frame that follows a chained one, the canonicaliser reports what the
chain would have picked (finder-to-finder steps are not audited since the
milestone review of 2026-09-25, #2 - they were never the chain's). The
audit is counted per hit; `?qrperf`'s `orderSources` count per accepted
solve, so the two totals differ.

## Public API

- `createOrderChainTally()` -> `{ add(detection), summary() }`.
  - `add`: one detection (a hit) with its `orderSource` and `orderAudit`;
    detections without an order source are ignored for the runs.
  - `summary()` -> `{ audit: { agree, disagree, reject }, unsureRuns: { r1,
r2to4, r5to8, r9plus } }`: the audit counts (a `disagree` is a frame the
    chain would have got wrong; `reject` one where it would have ended) and
    the lengths of the runs of `memory` / `native` detections between finder
    ones (an open run counts as it stands).

## Invariants & assumptions

- One detection per `add`, in detection order; misses are not detections.
- One code: the runs are not keyed by payload (field tests use one code).

## Tests

`qrperf-instrument.test.ts` ("tallies the corner-order audit and the runs of
unsure frames"): the audit counts, run lengths including an open run, and
the report line.
