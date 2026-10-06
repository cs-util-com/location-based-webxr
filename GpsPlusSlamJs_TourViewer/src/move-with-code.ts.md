# move-with-code.ts

## Purpose

When a code's saved position is IMPROVED (the same poster, measured
better), the pins and photos near it move with it, keeping exactly their
place relative to the code (UI round 1, U3; owner decision 2026-10-06:
"within about 40 m"). A scanning visitor's phone puts the code's saved
position on the real poster and shows each object at its saved position
relative to that; moving the code alone would shift every nearby object
against the poster (about 4 m at 6 m for the field recording's 41 degree
turn). A REAL move of the poster does not use this: pins stay at their
landmarks (D19). Pure.

## Public API

- `moveWithCode(object, oldCode, newCode): QrGeoPose` - the code
  correction (`visit-anchoring.ts` `codeCorrection`, D10b) from the old
  code pose to the new one, applied to the object in a local NUE frame at
  the old code: YAW AND POSITION ONLY. The two measurements' tilt
  difference is pose-solve noise the visitor's yaw-only frame never
  applies; turning objects by it would shift one 40 m away by about 0.7 m
  per degree (U3 milestone review #2, which also found this a duplicate of
  `codeCorrection`). A `rotation` stays a rotation; a heading-only pose
  gets its heading turned. Unchanged when the two code poses define no
  yaw (a half turn about a horizontal axis).
- `withinCodeReach(object, code): boolean` - horizontal distance at most
  `CODE_EVENT_REACH_M` (40 m), the same reach D33 ties notes to a code
  event with.

## Invariants & assumptions

- Positions go through the framework's `calcRelativeCoordsInMeters` (NUE)
  and its inverse `calcGpsCoords`, in a local frame at the old code.
- A pose without `rotation` reads its heading as the rotation of `-h`
  about Up (the QR geo-pose convention); headings come back in [0, 360).
- Earlier visits' objects count by DISTANCE to the code, not walked
  distance: the tour file does not record how far the author walked.
- The geodesy is licence-gated: the caller runs after the store is built.

## Examples

```ts
const moved = withinCodeReach(pin.geo, oldGeo)
  ? { ...pin, geo: moveWithCode(pin.geo, oldGeo, newGeo) }
  : pin;
```

## Tests

`move-with-code.test.ts`: the turn's direction (an offset in the code's
own frame kept), a tilt difference ignored, an object at the code lands on
the new code; the
field case (41 degrees at about 6 m, the chord); a property that the
distance to the code is kept and that moving back undoes it; the 40 m
reach.
