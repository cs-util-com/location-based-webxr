# A floor on how much walk the QR mint's alignment rests on - followup

Status: open, a product decision for the owner. Filed 2026-10-02 from the
milestone review of the Recorder code-heading fix (finding M2). Nothing was
changed in code for it.

## The gap

`MIN_ALIGNMENT_SAMPLES = 3` (`../src/ar/qr/qr-mint-level.ts`) is the only
check on the alignment a code is minted through, and it counts GPS fixes,
not the walk behind them. A heading needs a baseline: a recording where the
author scanned the code and barely walked has many fixes and an alignment
whose yaw is GPS noise. The fixedness gate cannot see it either, because it
runs in the odometry frame.

## Measured

`qr-anchor-mint.start-at-code.test.ts`, opt-in `extent` sweep
(`QR_MINT_START_AT_CODE_SWEEP=extent`): a recording that starts at the code,
3 looks, two out-and-back walks of 0, 2, 4, 6, 8, 10, 15, 20 or 30 m, 40
seeds each (360 recordings), GPS accuracy 5 m, real store and solver; the
shipped mint, binned by the GPS extent at mint time (the largest distance
between two fixes so far, noise included):

- extent 0-5 m (129 recordings): heading 41 degrees p50, 151 p90
- extent 5-10 m (138): 7.3 / 22
- extent 10-15 m (52): 3.5 / 8
- extent 15-20 m (38): 3.4 / 8
- extent 20-30 m (3): 2.7 / 4

Every one of them passes the 3-fix floor. A floor on the extent would, on
these recordings:

- at 5 m: refuse 36 %, kept heading 4.9 / 16
- at 10 m: refuse 74 %, kept 3.4 / 8
- at 15 m: refuse 89 %, kept 3.4 / 8

The refusal shares describe this deliberately short-walk test set, not real
recordings; how many real recordings fall under each floor is not known.

Parameters this rests on, and what would move it: the GPS accuracy (5 m;
noise alone produces 3-5 m of extent while standing still, so at 2-3 m
accuracy the 5 m bin would mean a real walk and the numbers shift down),
and the noise model (Gauss-Markov wander 0.25 x accuracy over 60 s plus
white 0.15 x accuracy). A field recording with the author standing at a
code is what would confirm the 0-5 m bin.

## Why it is not added as a guard

A floor refuses codes an author expects to be written: a code scanned in a
recording that never walked 5-10 m, which is exactly the "scan the poster,
stop" session. That is a visible behaviour change (a refusal on the summary
screen, no `qr/<id>.json`), so it is the owner's call, not a pure guard.

## Options

- **A - no floor (today).** A short recording mints a heading that can be
  anything; the level's `mintQuality.alignmentSampleCount` does not reveal
  it.
- **B - refuse below an extent floor (5 m, or 10 m),** with a plain-words
  reason ("walk a few metres with GPS before stopping"). Needs the extent
  carried with the alignment the mint uses (the feeder can compute it from
  the store's GPS list), and the summary screen shows the refusal.
- **C - mint, but stamp the extent** into `mintQuality` so a viewer can
  distrust or ignore the heading of a code below the floor. No refusal, no
  repair.
- B and C combine; the same extent is what candidate (a3) of the left-behind
  measurement uses as its maturity floor (40 m or more there), so one
  "extent so far" helper would serve both.

## Related

- `2026-10-02-1551-qr-level-re-mint-path-followup.md` (the other follow-up
  from the same review).
- `../src/ar/qr/qr-anchor-mint.ts.md` and the header of
  `../src/ar/qr/qr-anchor-mint.start-at-code.test.ts` (all measurements).
