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
  - Returns `{ alignment, samples, spreadM }`: `alignment` is column-major,
    the fit's yaw and shift with the reference's height.
  - null: an unreadable reference, no fixes, or fixes spreading less than
    the moved-code rule's minimum (`CODE_MOVE_RULE.minSpreadM`, 2 m): no
    turn is fitted then, and the reference's heading would stand in.
- `codeDeviceFit({ samples, reference, quality, frameChanged })` - the
  settle's gate on the fit: null unless at least `MIN_ALIGNMENT_SAMPLES` (3)
  device fixes, a walk reliable for its accuracy (`isReliable(quality)`,
  the keep-or-replace rule's own test: extent at least max(10 m, 4.77 x
  accuracy)), and no tracking restart in the visit.
- `codeFitPose(sightings, samples): { pose, loopClosed } | null` - the
  code's odometry pose to read the fit at:
  - the midpoint of the first and last sightings when they bracket every
    fix (first seen before the first fix, last seen after the last):
    `loopClosed: true`;
  - else the latest sighting;
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
  is poorer than a code's stored height. In a voted visit that keeps the
  stored code's height.
- **The loop closure** removes the AR drift of the walk, not GPS error: the
  fixes between two sightings carry about half the drift on average, so the
  midpoint is the pose the fit describes. The midpoint form was chosen over
  spreading the gap along the path: the findings measured nearly the same
  gain for both, and the midpoint changes no fix. It reads odometry poses
  and device fixes only; no vote enters it.
- Defensive: non-finite samples are skipped by the estimator; a non-finite
  result or reference gives null; a non-finite sighting time never closes
  the loop.

## Examples

```ts
const fit = codeDeviceFit({
  samples: displacementSamples({ gpsPositions, odometryPositions, zero }),
  reference: selectAlignmentMatrix(state),
  quality: { extentM, accuracyM }, // device fixes only
  frameChanged,
});
const at = fit && codeFitPose(keptSightings, samples);
const seen = at && throughAlignment(odomNueFromWebXr(at.pose), fit.alignment);
```

## Tests

- `code-device-fit.test.ts`: the walk's alignment recovered against a
  reference held elsewhere (height kept); refusals (no spread, no fixes, a
  bad reference); the gate (short walk, unknown accuracy, two fixes, a
  tracking restart); the loop closure's choice of pose and that it removes
  a walk's drift the end sighting carries.
- `code-device-fit.property.test.ts`: exact fixes recover the truth for any
  reference; two references give the same horizontal alignment with noisy
  fixes.
- In the settle: `creator-code-votes.test.ts` ("a visit the stored code
  lined up, walked with GPS and the code seen again", and the sweep).
