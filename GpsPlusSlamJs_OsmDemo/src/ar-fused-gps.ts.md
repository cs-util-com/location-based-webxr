# `ar-fused-gps.ts`

## Purpose

Back-projects the AR camera's pose into GPS, so the readout can show where the
**alignment** thinks the user is beside where the **last fix** said they were.

Added for the fifteenth field session (J7): _"Man muss ja quasi einfach nur die
lokale Pose im AR-Space wieder zurückprojizieren in den GPS-Space, und dann hat
man eine saubere, stabile, über das Alignment gefus[t]e GPS-Koordinate."_

## Why the scene graph already has the answer

`ar-scene-hierarchy.ts` is
`scene (GPS-world NUE) → arWorldGroup (receives the alignment) → basisChangeNode
→ arpose → camera`. The camera is a **descendant** of the aligned group, so
`camera.getWorldPosition()` is already NUE metres about the framework's `zero`
with the alignment applied. Nothing is multiplied here — `fusedBearingDeg` in
`ar-measurements.ts` relies on exactly the same property.

## Public API

- `fusedGpsFrom(frame: EnuInverse, nue: NuePosition): {lat, lng} | undefined`
- `EnuInverse` — anything with `toLatLng({x, y})`. **Structural**, matching
  `ar-origin.ts`'s convention of not importing a type for a two-field shape.
- `NuePosition` — `{x: north, y: up, z: east}`, i.e. the scene root's frame.

## Invariants & assumptions

- **The axis swap is the whole reason this is a named function.** The scene root
  is NUE (`x` North, `y` Up, `z` East) and `EnuPoint` is `{x: east, y: north}` —
  transposed with respect to each other. A silent transposition yields a
  coordinate that looks entirely reasonable and points somewhere the user has
  never been. `ar-scene-hierarchy.ts` records two independent readers getting
  this frame backwards, which is why the test asserts a north-only displacement
  never moves longitude, as a property over the whole range rather than as one
  example.
- **`y` is deliberately unused and deliberately NOT validated.** It is height, it
  comes from a different source than the horizontal terms, and suppressing a good
  position because the altitude is unusable would hide the line exactly when the
  vertical solve is misbehaving — which is when it is most worth reading.
- **A non-finite horizontal term yields `undefined`, never a number.** The same
  rule as the rest of the readout: unmeasured is omitted, never rendered. A `NaN`
  would at least print visibly; an `Infinity` comes out of the frame as a
  real-looking coordinate, and this line exists to be trusted.
- **The caller guards on the alignment, not this module.** `ar-mode.ts` skips it
  while `arWorldGroup.matrix` is identity — the same guard `worldBaselineY` and
  `fusedBearingDeg` use, for the same reason: under identity the camera's world
  position is raw odometry, a perfectly plausible coordinate meaning "nothing has
  been aligned yet".

## Why not the library's `calcGpsCoords` / `fusedGpsFromOdom` (DEC-J10)

Both do this arithmetic, and both are wrapped in `gateFunction` →
`assertLicenseActive()`. That is satisfied at runtime — the demo's store
activates a licence — and **hostile in this package's unit tests**, which import
no library function and have no setup that activates one. Reaching for
`gps-plus-slam-js/internal`'s `_setLicenseActiveForTesting` would couple the
demo's tests to an `@internal` API to obtain six lines of flat-earth arithmetic.

`gps-plus-slam-osm`'s `enuFrameAt(origin).toLatLng(point)` is the same
approximation, already injected into `ArModeDeps` as `enuFrameAt`, ungated and
directly testable. **That is reuse, not re-implementation** — the rule's purpose
is served better by the ungated equivalent already in hand.

`ArModeDeps.enuFrameAt` had to be **widened** to declare `toLatLng`: it declared
`toEnu` only, and both fixtures supplied only that behind an `as ArModeDeps`
cast — so a missing member would have surfaced as
`frame.toLatLng is not a function` in `ar-mode.depth-wiring.test.ts`, a file this
work had no reason to touch. Cold review caught it before it landed.

## Examples

```ts
const frame = deps.enuFrameAt(toDemoLatLng(deps.origin));
const fused = fusedGpsFrom(frame, camera.getWorldPosition(scratch));
// → { lat, lng }, or undefined when the pose is unusable
```

## Tests

- `ar-fused-gps.test.ts` — the origin round-trips; `x` moves latitude only and
  `z` moves longitude only; `y` is ignored entirely; a northward sweep is
  monotonic in latitude; non-finite horizontal terms yield `undefined` while a
  non-finite `y` does not.
- `ar-mode.test.ts` — the wiring: absent under an identity alignment, present
  once one exists.
- `ar-measurements.test.ts` — the line renders directly beneath `raw gps`, is
  expanded-only, and appears even with no raw fix to pair it with.

## Related

- [`ar-measurements.ts`](./ar-measurements.ts.md) — where the line is rendered,
  and DEC-Y2/DEC-J9 on why `raw gps` keeps its name.
- [`ar-origin.ts`](./ar-origin.ts.md) — `toDemoLatLng`, the `{lat, lon}` →
  `{lat, lng}` adapter this call site needs.
