# code-device-fit.ts

## Purpose

Where a creator visit's OWN GPS puts a code, with every code's votes left
out: the visit's alignment refitted from its device fixes alone, and the
odometry pose of the code that fit is read at (the start and end sightings
of one code close the loop). The settle (`creator-settle.ts`) uses it for a
visit a stored code's votes lined up and still hold at its end. Pure.

Why: a stored code that lines a visit up casts "votes" (synthetic GPS
fixes saying the phone is where the stored code says), re-cast with every
device fix while the code is held. The store's alignment at the visit's end
is then held by the code, and the code seen through it sits where it is
stored by construction. The settle used to read that as a measurement: it
"replaced" the code with its own stored spot, stamped it with the walk's GPS
quality (so later visits kept it as good) and logged a perfect agreement. A
stored error of 10-15 m became permanent (the mixed-visit tests in
`creator-code-votes.test.ts` reproduce it).

## Public API

- `deviceFitAlignment(samples, reference): DeviceFit | null`
  - `samples`: the visit's device fixes (`displacementSamples`, which drops
    the votes).
  - `reference`: any alignment of the visit (odometry-NUE to world-NUE,
    yaw-only as the solver's are); the frame the fit is composed onto.
  - Returns `{ alignment, samples, spreadM, fixes, walkM }`: `alignment`
    is column-major, the fit's yaw and shift with the reference's height;
    `fixes` the samples it rests on; `walkM` the phone's own walk over
    them (the largest horizontal distance between two of their odometry
    points).
  - null: an unreadable reference, no fixes, or fixes spreading less than
    the moved-code rule's minimum (`CODE_MOVE_RULE.minSpreadM`, 2 m): no
    turn is fitted then, and the reference's heading would stand in.
- `fitSamples(samples)` - the fixes a fit uses: all but those reporting an
  accuracy more than 2 times (the private `FIT_ACCURACY_OUTLIER_FACTOR`) the median of
  the reported ones; a fix without an accuracy is kept.
- `codeDeviceFit({ samples, reference, quality, frameChanged })` - the
  settle's gate on the fit, over `fitSamples(samples)`: null unless at
  least `MIN_ALIGNMENT_SAMPLES` (3) fixes, a walk reliable for the
  accuracy by the GPS spread (`isReliable(quality)`, the keep-or-replace
  rule's own test: at least max(10 m, 4.77 x accuracy)) AND by the phone's
  tracking over those fixes, and no tracking restart in the visit.
- `deviceWalkMoreM(samples, quality)` - how much farther the walk had to
  go for that rule (0 when it went far enough), by the shorter of the GPS
  spread and the tracking; null without a known accuracy. The result
  line's hint when the gate refuses.
- `codeFitSightings(sightings, levelId)` - one code's kept sightings as
  `codeFitPose` reads them, oldest first, without those solved at a print
  size the creator has since replaced (`otherSize`).
- `codeFitPose(sightings, samples): { pose, loopClosed } | null` - the
  code's odometry pose to read the fit at:
  - between the first and last sightings, at `first + w (last - first)`,
    `w` the mean over the fit's fixes of each fix's moment in the window
    between the two looks, clamped to [0, 1]: `loopClosed: true`;
  - else the latest sighting (one sighting, two at one moment, a moment
    unknown, or no timed fix);
  - the heading is always the latest sighting's;
  - null without a sighting.

## Invariants & assumptions

- **The fit is the walk's own.** It reuses the moved-code check's rigid
  estimator (`estimateCodeDisplacement` with `CODE_MOVE_ESTIMATOR`, a 2D
  least squares of yaw and shift), pinned at the odometry origin through the
  reference. With a turn fitted, the least-squares rigid map of the
  odometry onto the fixes is unique, so the horizontal result does not
  depend on the reference at all (property test). That is what keeps a
  code's votes out: the reference is the vote-held alignment, and nothing of
  it but the height survives.
- **Height** stays the reference's: the fit is horizontal, and GPS altitude
  is poorer than a code's stored height. In a voted visit the reference's
  height is the stored code's blended with the GPS altitude, as the
  replace path always had.
- **The walk is read twice.** The GPS spread counts noise: near a door a
  phone's fixes jump 10-20 m while it hardly moves, and the spread alone
  would pass the rule for a walk whose heading is noise. The tracking does
  not jump, so the gate also needs the phone's own walk over the fixes.
  The settle judges and stamps a code through the fit with the shorter of
  the two.
- **Outlying fixes** (a phone coming back inside reports 30-50 m fixes)
  are left out rather than weighted: the estimator is unweighted, and the
  stamp's accuracy is the visit's median, which does not describe them.
  The factor 2 is not swept.
- **The loop closure** removes the AR drift of the walk, not GPS error. A
  fix carries the drift of its own moment, and the fit absorbs the mean
  drift of its fixes, so the code is read where its odometry pose carries
  that mean: `first + w (last - first)` with `w` the fixes' mean moment
  in the window. Fixes spread evenly over the window give the midpoint;
  fixes after the last look (a phone still reporting on its way in) weigh
  1, so the closure degrades smoothly instead of switching off. Time
  stands in for the distance walked, the drift's real driver: a creator
  standing still for long inside the window shifts `w` although no drift
  grew. It reads odometry poses and device fixes only; no vote enters it.
- Defensive: non-finite samples are skipped by the estimator and by the
  closure's weights; a non-finite result or reference gives null; a
  non-finite or empty sighting window never closes the loop.

## Examples

```ts
const fit = codeDeviceFit({
  samples: displacementSamples({ gpsPositions, odometryPositions, zero }),
  reference: selectAlignmentMatrix(state),
  quality: { extentM, accuracyM }, // device fixes only
  frameChanged,
});
const at = fit && codeFitPose(codeFitSightings(picks.sightings, id), fit.fixes);
const seen = at && throughAlignment(odomNueFromWebXr(at.pose), fit.alignment);
```

## Tests

- `code-device-fit.test.ts`: the walk's alignment recovered against a
  reference held elsewhere (height kept); refusals (no spread, no fixes, a
  bad reference); the gate (short walk, unknown accuracy, two fixes, a
  tracking restart, a GPS spread made by jumping fixes); outlying fixes
  left out; the walk hint; the loop closure's weights (before, inside and
  after the window) and that it removes a walk's drift the end sighting
  carries, also with fixes after the end look; the sightings' filter.
- `code-device-fit.property.test.ts`: exact fixes recover the truth for any
  reference; two references give the same horizontal alignment with noisy
  fixes.
- In the settle: `creator-code-votes.test.ts` ("a visit the stored code
  lined up, walked with GPS and the code seen again", and the sweep).
