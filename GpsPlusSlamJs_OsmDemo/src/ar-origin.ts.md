# `ar-origin.ts`

## Purpose

Where AR mode anchors the city, and the two conversions between the demo's
world and the framework's.

## Why it is its own module

Both conversions are one-liners, and both are the kind of one-liner that stays
wrong for months because both fail **silently and as something else**:

- the framework spells it `lon` and this demo spells it `lng`, so a slip reads
  as a city in the Gulf of Guinea rather than as a type error;
- the geoid sign turns an orthometric DEM height into the ellipsoidal one the
  GPS-world frame is measured in, and getting it backwards puts everything ~2N
  — about 94 m at Cologne — out of place. `geoid.ts` says what that looks like:
  _"not a bug in this file … a bug in the GPS+SLAM fusion, which is a much more
  expensive place to go looking."_

Neither belongs in `ar-mode.ts`, which owns a session lifecycle, and both need
testing without a WebXR session, a renderer or a DOM.

## Public API

- `FrameworkLatLong` — `{ lat, lon }`, the framework's shape.
- `toDemoLatLng(origin): LatLng` — `{lat, lon}` → `{lat, lng}`. The adapter
  DEC-R11-6 asks for. The two shapes are structurally incompatible, so the
  failure is a compile error — **as long as nobody reaches for a cast.** This is
  the alternative to that cast.
- `absoluteDatumFor(undulationMetres): number` — the value
  `terrain-field.ts`'s `absoluteDatum` wants, so the caller never has to
  remember the sign.
- `canEnterAr(origin): boolean` — whether a GPS fix has landed.

## Invariants & assumptions

- **The origin is the framework's `zero`, never the demo's position.** The demo
  picks a start from a place-picker and moves it on every map click; `zero`
  comes from the first GPS fix and is immutable for the session. The alignment
  matrix the fusion produces is expressed against `zero`, so anchoring anywhere
  else means the camera and the city disagree by however far the two drifted.
- **AR entry WAITS for a fix rather than falling back.** `zero` is `null` until
  one arrives, and DEC-R11-6 rejected re-anchoring on the first non-null
  `zero` — so entering early and correcting later is not available, because
  there is nothing to correct to.
- **`canEnterAr` is a null check, not a truthiness check.** `{ lat: 0, lon: 0 }`
  is Null Island: a real coordinate that a truthy test would refuse. Pinned.
- **The datum is `−N` because `heightAt` SUBTRACTS the datum.** The composed
  property is `surfaceHeight − datum = DEM_orthometric + N`, and the test
  asserts that end-to-end rather than the sign alone — the sign is precisely
  what a reader cannot check by eye.
- ⚠️ **The datum conversion is half a handshake, and the other half is
  Android-only.** Raising the DEM to ellipsoidal is correct only because the
  frame it meets is ellipsoidal — which holds because Android/Chrome reports
  `GeolocationCoordinates.altitude` against the ellipsoid and nothing in the
  framework or the library normalises it.
  - If iOS is ever supported and its altitude is orthometric (CoreLocation's
    MSL, as widely reported), this conversion **doubles** the error instead of
    cancelling it: DEM up by N, GPS still at MSL, city ~2N — about 94 m at
    Cologne — out of place. Same magnitude and same misleading signature as
    getting the sign backwards.
  - Fix belongs at the sensor boundary (`GpsPlusSlamJs_AppFramework/src/sensors/gps.ts`),
    never here — otherwise the DEM datum and `applyAltitudeOverride` each need
    their own copy of the rule.
- Pure. No clock, no DOM, no session, no three.js.

## Examples

```ts
const origin = selectZeroReference(store.getState());
if (!canEnterAr(origin)) return; // wait for the first fix

const anchor = toDemoLatLng(origin);
const geoid = egm96Geoid();
worker.call("terrain", {
  centre: anchor,
  frameOrigin: anchor,
  extentM,
  spacingM,
  geoidUndulationM: geoid.undulationMetres(anchor),
});
```

## Tests

`ar-origin.test.ts` — the adapter (including a fixture whose lat and lng are
far apart and differently signed, so a transposition cannot pass), the datum
sign, the composed `DEM + N` arithmetic, `ZERO_GEOID` passing through as a
no-op, and Null Island being allowed rather than refused.

## `nueBearingDeg` — the geographic bearing of a direction

Degrees clockwise from north, given a direction's **north** (`x`) and **east**
(`z`) components in the GPS-world NUE frame. `undefined` for a degenerate
(vertical) direction, because reporting `0` there would be a confident "facing
north" while the phone points at the ground.

⚠️ **Take the direction in WORLD space.** The hierarchy is
`scene (GPS-world NUE) → arWorldGroup (receives the alignment) → basisChangeNode
→ arpose → camera`, so the camera is a **descendant** of the aligned group and
its world transform already carries the alignment. A direction taken _relative
to_ `arWorldGroup` is in the AR-odometry frame — the alignment's **domain**, i.e.
un-aligned — and yields a plausible number that is not north.
`ar-scene-hierarchy.ts` records two earlier readers getting this backwards, and
an AR HUD review draft made it three; the function exists so the next reader
inherits the answer instead of the trap.

Tests cover the four cardinals, a **clockwise**-from-north case at 45° (a
swapped `atan2` passes N/S/E/W and fails only off-axis), the `[0, 360)` range,
and the degenerate refusals.

## `fieldMatchesArDatum` — is the held terrain AR's, or still the desktop's?

A **type guard** (so the caller keeps its `Heightfield` methods after the check)
answering whether a held field was sampled against AR's datum, i.e. whether its
`datum` is `absoluteDatumFor(N)` exactly.

**Why it exists (PR #311 review, finding 3).** Between AR entry and the entry
pass landing, the app still holds the **desktop** field — sampled against the
window-centre height, so `heightAt` returns **relief**, not an ellipsoidal
height. Publishing a GPS-altitude residual against that prints a confident number
tens of metres out: _the same magnitude as the ~10 m symptom the residual exists
to diagnose_. Being wrong by exactly the quantity under measurement is the worst
available failure, so it is checked rather than assumed. The check is an identity
comparison and closes on its own once the AR field lands.
