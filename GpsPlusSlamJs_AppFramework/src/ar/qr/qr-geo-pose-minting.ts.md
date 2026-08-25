# qr-geo-pose-minting.ts

## Purpose

Anchor MINTING for a printed QR — the authoring half of the QR-pose loop
(plan `2026-08-25-1227-qr-pose-tour-relocalization-plan.md`, M1): compose
the code's GPS-world pose, as observed under the current session alignment,
into the `QrGeoPose` a level file carries.

## Public API

- `mintQrGeoPose(input: MintQrGeoPoseInput): QrGeoPose` — always carries the
  normalized `rotation`; adds the compat `headingDeg` only when the code is
  near-vertical (local +y within 3° of Up — derived from the wide-baseline
  error budget, see the constant's docblock). Throws `RangeError` on
  non-finite inputs or a non-unit rotation.
- `deriveVerticalHeading(rotation): number | undefined` — the compat-bearing
  derivation, exported for `qr-level.ts`'s both-fields consistency check.
- `interface MintQrGeoPoseInput { worldNuePosition; worldNueRotation; zero }`

## Invariants & assumptions

- **Frame contract:** inputs are GPS-world NUE (x=North, y=Up, z=East) —
  sampled from an object under an aligned `arWorldGroup` (e.g.
  `getWorldPosition()` of a QR-glued `qr-debug-view` object). A raw-WebXR
  pose fed here yields a plausible-looking result rotated about the zero —
  the silent frame bug both plan reviews flagged.
- **Honesty contract (plan §2):** the result inherits the session's
  alignment error — it buys visitors CONSISTENCY with the author's session,
  not absolute truth. Callers record measurement quality (GPS accuracy,
  alignment samples) in the level's typed `qr.mintQuality` block.
- `alt` is absolute and equals `worldNuePosition.y`: GPS points enter
  alignment with the zero-altitude term hardcoded 0 (`gpsDataSlice`), so
  GPS-world Up IS absolute altitude. The first version added a
  `zeroAltitude` on top — a double-count worth hundreds of metres at
  synthetic-vote weight, caught by the M1 milestone review; the test suite
  now pins the semantics with a round-trip through
  `calcRelativeCoordsInMeters`.
- Measurement quality goes in the level's typed `qr.mintQuality` block
  (`qr-level.ts`), not in opaque content.
- A tilted/flat code gets NO `headingDeg` — a rotation-unaware reader then
  fails loud in `parseQrLevel` instead of silently placing it as a wall
  poster.

## Examples

```ts
// qrObject rides qr-debug-view's WEBXR_TO_NUE node under an ALIGNED
// arWorldGroup, so its world transform is GPS-world NUE.
const q = qrObject.getWorldQuaternion(new Quaternion());
const minted = mintQrGeoPose({
  worldNuePosition: qrObject.getWorldPosition(new Vector3()),
  worldNueRotation: [q.x, q.y, q.z, q.w],
  zero: selectZeroReference(store.getState())!,
});
serializeQrLevel({
  version: 1,
  qr: { physicalSizeM, geo: minted, mintQuality: { gpsAccuracyM } },
});
```

## Tests

`qr-geo-pose-minting.test.ts` — the altitude ROUND-TRIP through the
consumer conversion (the test the first version failed), rotation
normalization, heading derivation for vertical codes, heading omission for
face-up AND tilted codes (a composite-axis rotation exercising the
quaternion cross-terms), the round-trip through `localPlaneOffset`, and
input validation.
