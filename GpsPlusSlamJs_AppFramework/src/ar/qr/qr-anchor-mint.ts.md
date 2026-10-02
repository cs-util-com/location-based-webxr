# qr-anchor-mint.ts

## Purpose

One-line: turn "the camera saw this printed code eight times over three
minutes" into one geo pose a later visitor can relocalize against — or into an
honest refusal.

Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-C (DEC-3, DEC-4).

## Public API

- `DEFAULT_MAX_FIXED_ROTATION_SPREAD_DEG`, `DEFAULT_RECENCY_HALF_LIFE_S` —
  both **guesses until the field probe measures them**.
- `maxPairwiseRotationDeg(rotations): number` — the outlier-inclusive
  cross-sighting rotation disagreement.
- `QrMintAlignmentNow` - the session's alignment at mint time
  (`alignmentMatrix`, `zero`, `alignmentSampleCount`, `gpsAccuracyM?`) plus
  the accumulator's `segment` it describes.
- `mintQrAnchorFromSightings(input): QrAnchorMintResult` — `{ ok: true, level,
quality }` or `{ ok: false, reason, detail }`.
  - `input.currentAlignment?: QrMintAlignmentNow` - every sighting's ROTATION
    is turned through it when its matrix is non-null and it is in the
    sightings' segment; otherwise through the newest placeable sighting's own
    alignment. Optional, so a caller without a live session still mints. **Never throws for a DATA
    condition**; the callers are a zip contributor and a summary panel, and both
    want a verdict rather than an exception.
  - `reason` ∈ `no-sightings | frame-changed | moved | no-alignment`; `detail`
    is a plain-words sentence, because every decline reaches a person.
  - **Throws `RangeError` for a caller BUG** — today only an
    `input.recencyHalfLifeS` that is not a positive finite number. Validated
    at the top of the function, BEFORE the refusal paths, so the bug cannot
    hide behind "those sightings were unusable anyway" and surface only on the
    sessions that would otherwise have succeeded.
    - Why loud rather than a silent fallback (PR #390 review): `0` gives the
      newest sighting a `NaN` weight and every older one `0`, and a negative
      value can give `Infinity`. `weightedMedian` drops all of those and falls
      back to the unweighted median — so the weighting silently does not run,
      **and** `quality.unweighted` then equals the weighted answer, making the
      summary screen report "weighting moved it 0 m". The one readout that
      would reveal the bug is the readout the bug suppresses.
    - "No decay" is expressible as a large finite half-life, so rejecting
      `Infinity` costs no capability and keeps the contract one number.

## Invariants & assumptions

- **The fixedness statistic is OUTLIER-INCLUSIVE, and must stay that way.**
  It is deliberately NOT `aggregateQrPose`/`averageRotation`: that spread is
  documented as the max angle among the **inliers** to its robust mean, with a
  12° inlier threshold. A poster re-hung at 20° is discarded as an outlier
  there, so the reported spread stays _small_ — which would make this gate
  blind to precisely the case it exists to catch. (Cold review, blocker 3.)
  `aggregateQrPose` remains correct and is still used **within** a burst.
- **The gate runs in the ODOMETRY frame**, so GPS never enters it: what is
  measured is SLAM drift plus real movement, not alignment churn.
- **Translation disagreement is reported, never gating.** Over a three-minute
  walk, drift and a genuinely moved poster produce the same magnitude, so that
  threshold cannot be set honestly before the field data exists.
- **Each sighting's POSITION is composed with its OWN alignment** (DEC-3),
  not with one final matrix.
- **Each sighting's ROTATION is turned through ONE alignment**: the session's
  at mint time (`currentAlignment`) when it describes the sightings'
  odometry segment, else the newest placeable sighting's own (2026-10-02,
  start-at-code fix).
  - **Why.** An alignment's yaw is unobservable until the walk has a
    baseline, so a sighting taken as the recording starts was composed
    through an arbitrary yaw. The fixedness gate cannot see that (it runs in
    the odometry frame, where the sightings DO agree), and the rotation
    average is unweighted, so one such sighting turned the anchor. Measured
    in `qr-anchor-mint.start-at-code.test.ts` (real store and solver, 40
    recordings per cell, walks 15/30/60/120 m, 1-3 looks, yaw noise 1/3/5
    degrees): per-sighting composition gave 69-74 degrees p50 (p90 about 160) whenever the code was seen only at the start, or at the start and
    once more; this rule gives 1.0-4.9 degrees p50 from 30 m walks up and
    7-10 at 15 m. Same order as the M3a finding (89 degrees p50).
  - **What it costs.** When the code was seen in three looks the old
    average over three alignments was slightly better at p50 (by up to 0.6
    degrees at 60 m walks, 2.7 at 15 m), but its p90 reached 121-146 degrees
    at 15 m where this rule stays at 12-14.
  - **Why only the rotation.** Where the POSITION is composed is the owner's
    DEC-3, and the heading defect does not need it reversed. Composing the
    position through the mint-time alignment too would cut the position
    error of a code seen only at the start from 3.0 m to 1.3 m p50 in the
    same sweep, and by at most 0.4 m when it was seen again later; that is left for
    the owner.
  - **Why the segment check.** After a tracking restart or a loop closure
    the live alignment describes another odometry frame, so turning older
    sightings through it would be wrong by however far the frame moved.
- **Position is recency-weighted; rotation is not.** The fixedness gate
  establishes that the sightings agree on rotation in the ODOMETRY frame,
  and since every rotation is turned through one alignment they agree in
  the world frame too, so weighting could only move it by less than the
  gate's tolerance. (Before the start-at-code fix this did not hold: each
  rotation went through its own alignment, so sightings that agreed in the
  odometry frame could disagree in the world by the alignments' yaw
  difference, which is what made the heading wrong.)
- **The unweighted answer is returned alongside.** The half-life is a guess;
  showing both is what lets the owner see on the phone whether the decision is
  doing anything, instead of trusting it.
- **The counter-argument to DEC-3 is recorded, not hidden:** later sightings
  have seen more GPS _and_ carry more accumulated drift. The field probe is
  what settles it.
- **A sighting is narrowed by construction, never by a cast** — a `filter`
  does not tell the compiler the alignment is non-null, and casting one away
  is how a null reaches the composition.

## Examples

```ts
accumulator.flush(); // an open burst is never reported
for (const text of accumulator.codes()) {
  const result = mintQrAnchorFromSightings({
    sightings: accumulator.sightings(text),
    spansFrameChange: accumulator.spansFrameChange(text),
    nowIso: new Date().toISOString(),
  });
  if (result.ok && result.level.ok) {
    await addFile(qrLevelEntryName(await qrCodeId(text)), result.level.json);
  } else if (!result.ok) {
    showOnSummaryScreen(result.detail);
  }
}
```

## Tests

`qr-anchor-mint.test.ts` — the outlier-inclusive statistic proven against the
eight-agreeing-plus-one-turned case that the robust aggregate would hide; a
drifting-but-fixed code accepted and a re-hung one refused in plain words;
translation spread reported without gating; each decline reason with a
non-empty explanation; a still code placed exactly at its alignment's own
translation, decoded back through `calcRelativeCoordsInMeters`; the weighted
combine leaning to the LATER sighting (a test that fails if the weights are
ignored, where the others would not); the unweighted answer returned
alongside; the quality block reaching the level; and the median printed size.

`recencyHalfLifeS` validation is covered by its own describe block: each
rejected value (`0`, negatives, `NaN`, `±Infinity`) throwing `RangeError`, two
positive controls so a validation that rejected everything would be caught
(a positive explicit value, and an omitted one falling back to the default),
and one test pinning that the rejection happens BEFORE the refusal paths — the
ordering is the part a later refactor could quietly lose.

`qr-anchor-mint.test.ts` also pins which alignment turns the rotation: the
mint-time one; the newest sighting's when the session moved to another
segment, when none is passed, and when the session has none; and that the
POSITION still follows each sighting's own alignment.

`qr-anchor-mint.start-at-code.test.ts` - the start-at-code reproduction
against the real store and solver: a sanity pin (exact inputs, mature
alignment, heading under 1 degree), the reproduction (12 recordings, 30 m
walks, 1 and 2 looks: heading p50 under 10 degrees), and the opt-in sweep of
the fix candidates (`QR_MINT_START_AT_CODE_SWEEP=1`; the table goes to
`QR_MINT_START_AT_CODE_SWEEP_OUT` when set, since vitest runs silent here).

No fixtures required.
