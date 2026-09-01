# qr-author-mode.ts

## Purpose

Author mode's view-model (QR-pose plan M3): the tracking-controller
configuration for authoring against a printed code, the mint gate readout,
and the mint itself — raw-WebXR stable pose → GPS-world NUE →
`QrGeoPose` → exportable `qr/<id>.json`.

## Public API

- `AUTHOR_DEFAULT_SIZE_M = 0.2` — prefill for the printed-size input.
- `syntheticAuthorLevel(sizeM): QrLevel` — `{version:1, qr:{physicalSizeM}}`;
  throws on a non-positive/non-finite size.
- `buildAuthorControllerConfig(sizeM, deps: AuthorPipelineDeps)` — deps:
  `{ frontEnd, solvePose, getCameraPose, getIntrinsics, recordDetection }`.
- `MIN_ALIGNMENT_SAMPLES = 3` — the mint gate's alignment floor. A non-null
  matrix is VACUOUS (the store ships an identity matrix from the first GPS
  fix), so the gate counts solved-in fixes (milestone review #1).
- `authorStatusLine(detectedText, stability, alignment: AuthorAlignmentInfo)`
  → `{ text; canMint }` — the mint gate's only UI; each blocked state names
  what is missing, including the fix count.
- `buildAuthorControllerConfig` wires `onError` too — a throwing detector
  must surface, not leave the panel saying "point the camera" forever.

## Invariants & assumptions

- **The synthetic level is GEO-LESS and local** (plan deltas #1/#8): the
  decoded QR text is a printed launch URL (an HTML page); a real fetch
  would fail validation and flap the status at the detection cadence. A
  geo-less level makes the controller emit detections without voting, and
  the printed size is an INPUT — no depth, no corner-based sizing.
- **`minIntervalMs: 0`**: the camera-frame source is the single cadence
  owner (Option A); two equal throttles in series drop ~1 frame per cycle.
- **Minting reads the STABLE pose** (delta #2) in RAW WebXR/odom space (the
  frame the controller composes with `getCameraPose`); the conversion is
  `alignment × WEBXR_TO_NUE × pose`, using the alignment TARGET matrix
  (`selectAlignmentMatrix`), not the lerped visual transform — for a mint,
  the converged solve is the honest frame.
- **The mint refuses without alignment or zero** in plain words — minting
  earlier would stamp a garbage anchor into the printed code forever.
- The geodesy is licence-gated; production activates via the app's
  `createSlamAppStore` at boot (tests do the same).

## Examples

```ts
const config = buildAuthorControllerConfig(0.2, {
  frontEnd,
  solvePose,
  getCameraPose,
  getIntrinsics,
  recordDetection: (e) => store.dispatch(recordQrDetection(e)),
});
// … detections accumulate; once selectQrPoseStability says 'stable':
const result = mintQrLevel({
  odomPose: stablePose,
  alignmentMatrix,
  zero,
  alignment,
  sizeM,
  nowIso,
}); // from the framework — see qr-mint-level.ts.md
```

## Tests

`qr-author-mode.test.ts` — the geo-less/local fetch pins, the cadence pin,
the frame-conversion round-trips (identity and translation+yaw alignments,
hand-computed), the parser round-trip of the export, the mint-gate table,
and the plain-language refusals. The composed flow (real controller, slice,
stability, alignment solve, mint, export) is proven by
`playwright-tests/ar-mode.spec.js`'s author spec.
