# qr-geo-pose-minting.ts

## Purpose

Anchor MINTING for a printed QR — the authoring half of the QR-pose loop
(plan `2026-08-25-1227-qr-pose-tour-relocalization-plan.md`, M1): compose
the code's GPS-world pose, as observed under the current session alignment,
into the `QrGeoPose` a level file carries.

## Public API

- `mintQrGeoPose(input: MintQrGeoPoseInput): QrGeoPose` — always carries the
  normalized `rotation`; adds the compat `headingDeg` only when the code is
  near-vertical (local +y within 10° of Up). Throws `RangeError` on
  non-finite inputs or a non-unit rotation.
- `interface MintQrGeoPoseInput { worldNuePosition; worldNueRotation; zero; zeroAltitude }`

## Invariants & assumptions

- **Frame contract:** inputs are GPS-world NUE (x=North, y=Up, z=East) —
  sampled from an object under an aligned `arWorldGroup` (e.g.
  `getWorldPosition()` of a QR-glued `qr-debug-view` object). A raw-WebXR
  pose fed here yields a plausible-looking result rotated about the zero —
  the silent frame bug both plan reviews flagged.
- **Honesty contract (plan §2):** the result inherits the session's
  alignment error — it buys visitors CONSISTENCY with the author's session,
  not absolute truth. Callers record measurement quality (GPS accuracy,
  alignment samples) in the level's opaque `content`.
- `alt` is absolute: `zeroAltitude + worldNuePosition.y` (the NUE Up is
  relative to the zero reference).
- A tilted/flat code gets NO `headingDeg` — a rotation-unaware reader then
  fails loud in `parseQrLevel` instead of silently placing it as a wall
  poster.

## Examples

```ts
const minted = mintQrGeoPose({
  worldNuePosition: qrObject.getWorldPosition(new Vector3()),
  worldNueRotation: nueQuaternionOf(qrObject),
  zero: selectZeroReference(store.getState())!,
  zeroAltitude: firstFixAltitude,
});
serializeQrLevel({ version: 1, qr: { physicalSizeM, geo: minted } });
```

## Tests

`qr-geo-pose-minting.test.ts` — position/altitude composition, rotation
normalization, heading derivation for vertical codes, heading omission for
face-up codes, the round-trip through `localPlaneOffset`, and input
validation.
