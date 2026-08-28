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
- `mintQrAnchorFromSightings(input): QrAnchorMintResult` — `{ ok: true, level,
quality }` or `{ ok: false, reason, detail }`. **Never throws.**
  - `reason` ∈ `no-sightings | frame-changed | moved | no-alignment`; `detail`
    is a plain-words sentence, because every decline reaches a person.

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
- **Each sighting is composed with its OWN alignment** (DEC-3), not with one
  final matrix.
- **Position is recency-weighted; rotation is not.** The gate has just
  established that the sightings agree on rotation to within a few degrees, so
  weighting could only move it by less than the gate's own tolerance — while
  the robust average still rejects a single wild solve. Position is where the
  alignment's evolution actually shows, and that is what the weighting is for.
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

No fixtures required.
