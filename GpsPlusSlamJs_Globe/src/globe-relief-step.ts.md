# globe-relief-step.ts - the clearance and the relief's update

- Purpose: the relief's per-frame work around the band, moved out of the
  globe lab's `updateFrame` (one-scene plan §3.4, frame-hitch plan H1) as a
  pure refactor.
- Public API:
  - `reliefClearance({ ellipsoid, group, camera, sampleGround, altitudeM,
clearanceM })` returns `{ groundM, clearedM, lift }`: the drawn ground under the
    camera (read at its place in the globe's frame; null where none is
    loaded) and how far the camera must rise to keep `clearanceM` above it
    (`clearedM`, from `clearedAltitudeM`; `lift` when it is above the altitude).
  - `liftAlongRadius(position, fromM, toM)`: moves an ECEF position along
    its geocentric radius from one altitude to another, in place, in the
    lab's own arithmetic (`(r + toM - fromM) / r`, bit-equal).
  - `updateRelief({ tiles, plugin, camera, renderer, resolution,
heightScale, onEStep, clock? })`: the relief's camera, the drawing
    buffer's resolution, the exaggeration and the tile update, in that
    order. An E change (each re-walks the tile tree) is timed with `clock`
    and reported to `onEStep(ms, e)`; an unchanged E is not assigned.
- Invariants: `clearedAltitudeM` throws RangeError on a non-finite altitude
  or ground. The caller decides when each runs (the lab: the clearance while
  the relief has pixels, the update while it draws or is wanted, not while
  the share is frozen).
- Tests: `globe-relief-step.test.ts` (the sample place in a moved frame, the
  lift, no ground, the radius lift, the update's order, E timed only on a
  change).
