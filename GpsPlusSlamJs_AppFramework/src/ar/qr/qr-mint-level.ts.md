# qr-mint-level.ts

## Purpose

One-line: turn a solved QR pose into an exportable level file — the odometry →
GPS-world composition, plus the level and quality assembly around
`mintQrGeoPose`.

`mintQrGeoPose` was already shared, but the two things wrapped around it — the
frame composition and the level assembly — lived in the tour viewer. A second
authoring surface (the recorder, minting from a whole recording) would
otherwise copy both, and the composition is the single easiest thing in this
stack to get wrong. Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-A / M-C.

## Public API

- `AUTHOR_DEFAULT_SIZE_M: number` — 0.16 m, the size that still fits an
  A4/Letter page once the quiet zone is added.
- `MIN_ALIGNMENT_SAMPLES: number` — GPS fixes required before a mint is
  allowed.
- `MintAlignmentInfo` — `{ hasMatrix, sampleCount, gpsAccuracyM? }`.
- `qrWorldPoseFromOdom(odomPose, alignmentMatrix): WorldNuePose` — the frame
  composition. Pure.
- `mintQrLevel(input): MintQrLevelResult` — `{ ok: true, level, json }` or
  `{ ok: false, error }`. **Never throws.**

## Invariants & assumptions

- **The basis factor is LEADING: `alignment · WEBXR_TO_NUE · pose`.** The
  input is a RAW WebXR/odometry pose, which is what the tracking controller
  composes with `getCameraPose`.
  - A **trailing** factor is correct for a different input — replayed STATE,
    whose quaternions are already basis-conjugated (`R_nue = B·R_webxr·B⁻¹`,
    so `A·B·R_webxr = A·R_nue·B`). That is why the capture-time geo join
    composes the other way round.
  - Applying the join's form here yaws every anchor by 90°. That exact bug
    shipped once in the join and was caught in review; do not "harmonise" the
    two compositions without re-reading this note.
- **The tests are DIRECTIONAL, by design.** They assert where the code's local
  +x POINTS as a compass bearing, not the components of the quaternion.
  Component assertions on a near-identity rotation are what let the original
  yaw bug through. Hand-computed: an identity-rotated code with an identity
  alignment faces **east** (bearing 90), because `WEBXR_TO_NUE` maps WebXR +X
  to NUE +Z and NUE is North-Up-East. The wrong composition gives 180.
- **The alignment matrix is the solved TARGET**, never the lerped visual
  transform: for minting, the converged solve is the honest frame.
- **A non-null alignment matrix is VACUOUS on its own.** The store ships an
  identity matrix from the first GPS fix, and minting on it stamps a heading
  wrong by the session's arbitrary WebXR yaw — hence `MIN_ALIGNMENT_SAMPLES`
  as defence in depth alongside the null checks.
- **`mintQrLevel` never throws.** Its callers are a UI panel and a zip
  contributor; both want a message. A zero or negative reported GPS accuracy
  is dropped from the quality block rather than failing the mint, since the
  schema would reject it.
- **`quality` is merged last**, so a session mint can add sighting counts and
  spreads without a second assembler. Only fields the schema knows survive
  serialization — see `qr-level.ts.md`.

## Examples

```ts
// live authoring, from the stable pose in the qrDetected slice
const result = mintQrLevel({
  odomPose: stablePose,
  alignmentMatrix: selectAlignmentMatrix(state),
  zero: selectZeroReference(state),
  alignment: { hasMatrix: true, sampleCount, gpsAccuracyM },
  sizeM: AUTHOR_DEFAULT_SIZE_M,
  nowIso: new Date().toISOString(),
});
if (result.ok) download(result.json);

// session minting reuses only the composition, per sighting
const world = qrWorldPoseFromOdom(sighting.odomPose, sighting.alignmentMatrix);
```

## Tests

`qr-mint-level.test.ts` — the three directional composition cases (identity →
bearing 90, a +90° alignment yaw → bearing 0, and the position mapping through
the basis); a mint that parses back; the three refusal cases (no matrix, no
zero, too few fixes); the session-quality fields asserted by name after a
round trip; the dropped-nonsense-accuracy case; and a non-finite pose reported
as an error rather than thrown.

No fixtures required.
