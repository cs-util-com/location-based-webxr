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
- `QR_MINT_HEADING_UNCERTAIN_EXTENT_M = 10` - the GPS extent (m) under which
  a level is saved but marked `headingUncertain` (owner decision D31); the
  measured reason and the swept values (5 / 10 / 15 m) are in its doc comment.
- `qrMintHeadingMarker(gpsExtentM): { alignmentGpsExtentM?, headingUncertain? }`
  - THE D31 marker rule, for any level composed through an alignment with
    that session GPS extent: both fields for a finite, non-negative extent
    (`headingUncertain` when under the threshold), nothing otherwise (absent =
    unknown). This mint uses it, and so does the Tour Viewer's authoring
    settle when it re-mints a code through its own pick (review R7 of D33;
    DEC-H3: one rule, not a copy).
- `maxPairwiseRotationDeg(rotations): number` — the outlier-inclusive
  cross-sighting rotation disagreement.
- `QrMintAlignmentNow` - an alignment of the session (`alignmentMatrix`,
  `zero`, `alignmentSampleCount`, `gpsAccuracyM?`, `gpsExtentM?` - the
  session's GPS extent it rests on) plus the accumulator's `segment` it
  describes.
- `mintQrAnchorFromSightings(input): QrAnchorMintResult` — `{ ok: true, level,
quality }` or `{ ok: false, reason, detail }`.
  - `input.currentAlignment?: QrMintAlignmentNow` - the alignment the
    caller picked for this code (`qr-mint-alignment-tracker.ts`: the first
    mature one at or after its last sighting, else the alignment at save).
    Every sighting is placed through it (position and rotation) when its
    matrix and zero exist and it is in the sightings' segment; otherwise
    through the newest sighting's own snapshot. Its zero, sample count and
    accuracy are the ones the level records. Optional, so a caller without a
    live session still mints.
  - **The uncertain-heading marker (D31).** When that alignment is the one
    used and carries a finite, non-negative `gpsExtentM`, the level's
    `mintQuality` gets `alignmentGpsExtentM` and `headingUncertain`
    (`extent < QR_MINT_HEADING_UNCERTAIN_EXTENT_M`; exactly 10 m is not
    uncertain). The code is still written: refusing would lose the "scan
    the poster, stop" session. With no usable extent, or when the mint falls
    back to a sighting's own snapshot (whose extent nobody measured), both
    fields are absent: absent means unknown, never settled.
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
- **Every sighting is placed through ONE alignment**: the caller's
  `currentAlignment` when it describes the sightings' odometry segment, else
  the newest sighting's own snapshot. WHICH alignment the Recorder passes is
  owner decision D28, revised 2026-10-02 (`qr-mint-alignment-tracker.ts`):
  the FIRST MATURE alignment (40 m of session GPS extent, D34) at or after the
  code's last sighting; before maturity the alignment at save; after a
  frame change the one the code's segment closed with.
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
    whole walk. (Separately, the 2.5 % of start-only codes the sweep refused
    before are all minted now. Traced: one recording in 40 whose only look
    ended at 1.75 s on a detection dropout, so its own snapshot had seen 2
    fixes, under the floor of 3.)
  - **The floor does not check that the yaw is observable.** It counts
    fixes, not the walk behind them: with under 5 m of GPS extent at mint
    time the heading is 41 degrees p50 (151 p90), 5-10 m 7.3 / 22, 10-15 m
    3.5 / 8 (the `extent` sweep). Whether to refuse or flag below an extent
    floor is open with the owner:
    `../../../docs/2026-10-02-1552-qr-mint-yaw-observability-floor-followup.md`.
  - **Why the segment check.** After a tracking restart or a loop closure
    the live alignment describes another odometry frame, so placing older
    sightings through it would be wrong by however far the frame moved. The
    Recorder then passes the alignment the sightings' segment closed with
    (`qr-sighting-feeder.ts` keeps it at the frame change), so a
    start-at-code code followed by a restart is not sent back to its own
    immature snapshot (milestone review M1).
  - **Why not the alignment at save for every code (a2, shipped for one
    day; milestone review H1).** A code seen mid-recording and then walked
    away from inherits all SLAM drift after its sighting, because the
    alignment at save describes the END of the walk (the solver is
    recency-weighted). Integrated drift, 30 recordings
    per cell (`left` sweep): position p50 / p90 at 500 m away 2.9 / 4.3 m
    (0.5 % and 0.5 degree per 100 m), 8.6 / 11.6 m (1 %, 1 degree), 19.0 /
    21.5 m (2 %, 2 degrees), and 11.0 m walking 500 m out and back to the
    code; heading 3.5-7 degrees p50. Through the sighting's own snapshot
    (DEC-3) it is 1.7-1.8 m and 1.5-2.7 degrees in every cell. The first
    MATURE alignment at or after the last sighting (40-80 m of GPS extent)
    holds 1.1-1.7 m and 1.0-2.3 degrees there and stays within 0.3 degrees
    of the alignment at save for start-at-code recordings; a floor of 10-20 m
    is worse than that for those. 80 m shipped first (the session's
    recommendation: p90 heading 3-4 degrees at 2 % translation drift,
    against 5-6 at 40 m); the owner lowered it to 40 m (D34, 2026-10-04) so
    short walks mature too, with the real-data sweep filed as the check;
    the shipped rows are in the header of
    `qr-anchor-mint.start-at-code.test.ts`.
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
for (const text of accumulator.codes()) {
  // Includes the visit in progress without closing it (`flush()` would
  // split a visit that a periodic mint lands in).
  const sightings = accumulator.sightingsIncludingOpen(text);
  const result = mintQrAnchorFromSightings({
    sightings,
    spansFrameChange: accumulator.spansFrameChange(text),
    nowIso: new Date().toISOString(),
    // The first mature alignment at or after the code's last sighting, else
    // the alignment now (the Recorder's feeder: `alignmentFor(text)`, over
    // `createQrMintAlignmentTracker`).
    currentAlignment: tracker.alignmentFor(text, {
      alignmentMatrix: selectAlignmentMatrix(state),
      zero: selectZeroReference(state),
      alignmentSampleCount: selectGpsPositions(state).length,
      gpsExtentM: gpsExtent.update(selectGpsPositions(state)),
      segment: accumulator.currentSegment(),
    }),
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
when the session has none, and for every position in that fallback; and
that the zero, a sighting seen before the first fix (no matrix, no zero)
and the stamped GPS accuracy all come from the alignment used. The
weighting tests make sightings disagree in the odometry frame, since they no
longer can through their own alignments.

`qr-anchor-mint.start-at-code.test.ts` - the start-at-code reproduction
against the real store and solver: a sanity pin (exact inputs, mature
alignment, heading under 1 degree), the reproduction (12 recordings, 30 m
walks: heading p50 under 10 degrees with 1 and 2 looks, position p50 under
2 m for a code seen only at the start; both through the shipped
`createQrMintAlignmentTracker` path), the left-behind pin (6 recordings,
500 m away at 1 % and 1 degree per 100 m: the shipped path under 2.5 m p50,
the alignment at save over 5 m), the store extent agreeing with the
fixture's, two pins of the integrated drift
model (without drift it IS the pivot model; translation drift is the stated
share of the distance), and the opt-in sweeps
(`QR_MINT_START_AT_CODE_SWEEP=1` for all, or a comma list of `start`, the
fix candidates with the shipped `a3-40 shipped` column and the
uncertain-heading marker shares; `left`, a code left behind under integrated drift, about an
hour; `extent`, heading against GPS extent; `refusals`, the newest-snapshot
refusals traced). Tables go to `QR_MINT_START_AT_CODE_SWEEP_OUT` (plus a
suffix per sweep) when set, since vitest runs silent here.

No fixtures required.

The uncertain-heading marker (D31) has its own describe block in
`qr-anchor-mint.test.ts`: marked under 10 m, an explicit `false` at 80 m,
the boundary (10 m not marked, 9.99 m marked), and nothing stamped for an
unknown, non-finite or negative extent or for the sighting-snapshot
fallback. `qr-anchor-mint.property.test.ts` checks, for any finite
non-negative extent, that the written and re-parsed level says exactly
`extent < 10` and carries the extent.
