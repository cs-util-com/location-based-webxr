# qr-anchor-mint.ts

## Purpose

One-line: turn "the camera saw this printed code eight times over three
minutes" into one geo pose a later visitor can relocalize against — or into an
honest refusal.

Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-C (DEC-4; DEC-3 superseded by the owner on 2026-10-02, see below).

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
  - `input.currentAlignment?: QrMintAlignmentNow` - every sighting is placed
    through it (position and rotation) when its matrix and zero exist and it
    is in the sightings' segment; otherwise through the newest sighting's own
    snapshot. Its zero, sample count and accuracy are the ones the level
    records. Optional, so a caller without a live session still mints.
  - **Never throws for a DATA condition**; the callers are a zip contributor
    and a summary panel, and both want a verdict rather than an exception.
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
- **Every sighting is placed through ONE alignment**: the session's at mint
  time (`currentAlignment`) when it describes the sightings' odometry
  segment, else the newest sighting's own snapshot.
  - **This superseded DEC-3** (each sighting through the alignment as it
    stood AT that sighting, the owner's original call), by the owner's
    decision of 2026-10-02, on these measurements from
    `qr-anchor-mint.start-at-code.test.ts` (real store and solver, 40
    recordings per cell, walks 15/30/60/120 m, 1-3 looks, yaw noise 1/3/5
    degrees):
    - **Heading.** An alignment's yaw is unobservable until the walk has a
      baseline, so a sighting taken as the recording starts was composed
      through an arbitrary yaw; the fixedness gate cannot see that (it runs
      in the odometry frame, where the sightings DO agree). Per-sighting
      composition gave 72 degrees p50 (p90 about 160) whenever the code was
      seen in only one or two looks; one alignment gives 1.0-4.9 degrees p50
      from 30 m walks up and 7-10 at 15 m. Same order as the M3a finding (89
      degrees p50).
    - **Position.** A code seen only at the start: 2.9 m p50 before, 1.3 m
      now, at every walk length and yaw noise. Seen again later: 1.4-1.7 m
      before at walks of 30 m or less, 1.3-1.4 m now; equal from 60 m up.
    - **What it costs.** With three looks the old rotation average over
      three alignments was up to 0.6 degrees better at p50 at 60 m walks (2.7
      at 15 m), while its p90 reached 121-146 degrees at 15 m where this rule
      stays at 12-14.
  - **The sample-count floor reads the alignment actually used.** A code
    seen only before the third GPS fix used to be refused (the floor read the
    sighting's own snapshot) although the alignment at save had seen the
    whole walk. (Separately, the 3 % of start-only codes the sweep refused
    before are all minted now; that cause was not traced.)
  - **Why the segment check.** After a tracking restart or a loop closure
    the live alignment describes another odometry frame, so placing older
    sightings through it would be wrong by however far the frame moved.
- **Position is recency-weighted; rotation is not.** The weighting is the
  part of DEC-3 still in force, and its reason went with the per-sighting
  alignment: it was "a later sighting carries a later, better alignment",
  and every sighting now shares one. What it still does is prefer the later
  viewpoints, which also carry more drift. In the sweep it changes nothing
  measurable (a half-life of 1e9 s gives the same p50 to 0.1 m and 0.1
  degrees), so it stays, unearned, until the field probe. The rotation is
  not weighted because the fixedness gate establishes agreement in the
  odometry frame, and through one alignment that is agreement in the world.
- **The unweighted answer is returned alongside.** The half-life is a guess;
  showing both is what lets the owner see on the phone whether the decision is
  doing anything, instead of trusting it.
- **A missing alignment is handled by construction, never by a cast** - the
  one alignment is chosen with its fields narrowed, because casting a null
  away is how it reaches the composition.

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

`qr-anchor-mint.test.ts` also pins which alignment places the code: the
mint-time one for the rotation and the position, with its sample count
stamped (and a sighting whose own snapshot was too young minted); the newest
sighting's when the session moved to another segment, when none is passed,
when the session has none, and for every position in that fallback. The
weighting tests make sightings disagree in the odometry frame, since they no
longer can through their own alignments.

`qr-anchor-mint.start-at-code.test.ts` - the start-at-code reproduction
against the real store and solver: a sanity pin (exact inputs, mature
alignment, heading under 1 degree), the reproduction (12 recordings, 30 m
walks: heading p50 under 10 degrees with 1 and 2 looks, position p50 under
2 m for a code seen only at the start), and the opt-in sweep of
the fix candidates (`QR_MINT_START_AT_CODE_SWEEP=1`; the table goes to
`QR_MINT_START_AT_CODE_SWEEP_OUT` when set, since vitest runs silent here).

No fixtures required.
