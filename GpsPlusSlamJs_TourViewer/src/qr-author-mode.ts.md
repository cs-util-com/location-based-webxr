# qr-author-mode.ts

## Purpose

Author mode's view-model (QR-pose plan M3): the tracking-controller
configuration for authoring against a printed code, the mint gate readout,
and the mint itself — raw-WebXR stable pose → GPS-world NUE →
`QrGeoPose` → exportable `qr/<id>.json`.

## Public API

- `AUTHOR_DEFAULT_SIZE_M` (re-exported from the framework, **0.16 m**) —
  what `creator-setup.ts` writes into the printed-size input at wiring
  time, on every load. It is essentially the A4 ceiling, not a taste
  choice: the footprint is the side times `QR_PRINT_FOOTPRINT_FACTOR` (the
  quiet zone on both edges, stated once in the framework's
  `qr-quiet-zone.ts`), so anything much larger is clipped and does not
  scan. The
  `value` attribute in `index.html` must carry the SAME number - it is
  overwritten by the assignment above, so a differing one is dead text
  that reads like a decision (`printed-size-default.test.ts`). See
  `GpsPlusSlamJs_Docs/docs/2026-09-08-tour-viewer-improvements/2026-09-09-0740-printed-code-size-ceiling-followup.md`.
- `syntheticAuthorLevel(sizeM): QrLevel` — `{version:1, qr:{physicalSizeM}}`;
  throws on a non-positive/non-finite size.
- `buildAuthorControllerConfig(sizeM, deps: AuthorPipelineDeps)` — deps:
  `{ frontEnd, solvePose, getIntrinsics, recordDetection }`. No pose reader:
  the controller solves each frame against its own capture pose
  (`CapturedCameraFrame.cameraPose`, QR perf plan 2026-09-23 M4).
- `MIN_ALIGNMENT_SAMPLES = 3` — the mint gate's alignment floor. A non-null
  matrix is VACUOUS (the store ships an identity matrix from the first GPS
  fix), so the gate counts solved-in fixes (milestone review #1).
- `authorStatusLine(detectedText, fused: QrFusedPose | null, alignment: AuthorAlignmentInfo)`
  → `{ text; canMint }` — the mint gate's only UI; each blocked state names
  what is missing, including the fix count. Since QR near-frontal pose plan
  §60 it reads the FUSED pose: while it is not stable the line names what it
  waits for, in plain words per `notStableReason` ("walk slowly around the
  code", "keep moving slowly", "the views disagree", "the code seemed to move, keep it in view",
  "code not read clearly, move closer"), never the view threshold and never
  "hold steady" - moving the camera is what resolves the tilt (§61 #11). The copy is the creator
  setup's guidance since the guided-setup plan M3 ("Hold the phone on the
  printed code…", "Measured and stable - save the position.").
- `setupHint({ measured, tourOpen, hadLevel })` - what the panel says once
  measured: "Position saved." when no tour is open (`codeTourLine` then
  says what is happening to the code's tour; scan-to-open plan §9 #9), that
  the measurement replaces a code the tour already carried, else place
  content or finish.
- `codeTourLine(status: CodeTourStatus): string` - the scan-to-open status
  of the code in view (`scan-open.ts`) in plain words: opening, does not
  point to a tour, could not open (a short cause, and either "keep the
  code in view" or "fix the link, then restart AR"), the level in hand was
  measured for another tour (named), another tour's code is added to the
  open tour (plan §13), cannot tell; "" when
  quiet. At most 110 characters: it shares the panel with the readout.
- `finishReadiness({ measured, tourOpen })` → `"ready" | "not-measured" |
"no-tour"` - the finish button's gate.
- `MISSING_SIZE_MESSAGE` - what a creator reads when the printed-size
  field is empty at AR entry. The example inside it is interpolated from
  `AUTHOR_DEFAULT_SIZE_M`, so the two cannot drift.
- `reprintOrphanWarning(linkCodeIds, measuredCodeIds)` - the warning shown
  before printing when NO code number the current link can produce reaches
  any measurement the open tour already holds, or `null` when nothing would
  be lost.
  - **The question is about the LINK, not the poster.** One tour can carry
    several codes and each has its own identity, so asking only about the
    code in front of the creator told anyone re-printing poster 1 of a tour
    measured on poster 2 that their link had changed - advice to undo
    something they never did.
  - **The failure it makes visible is silent and expensive.** A printed
    code's identity is a hash of its text, and the measured pose is filed
    under that identity in the hosted zip. Change the text - re-print after
    moving the file,
    swap in a short link, add a tracking parameter - and the code asks for
    an id the archive does not hold. The visitor's app reads that as "this
    code has no level", says nothing, and waits out the scan gate into a
    location-only experience. The creator's walk is gone with no signal
    anywhere.
  - **It warns rather than refuses**, because re-printing under a new link
    is legitimate and only the creator knows whether the measurement was
    worth keeping. What they must not have is silence.
- `FINISH_LABELS` - the finish step's copy through its async cycle
  (reading, rebuilding N of M, ready, failed, download, saving, saved as,
  not saved) AND the share route's own (share, sharing, shared, nothing
  was shared).
  A Drive tour has its own two: `readyDrive(bytes, filename)` carries the
  "delete any older copy first" warning - the only moment it can prevent a
  repeat download's "name (1).zip" - and `savedToPhone(filename)` names
  Downloads and the Drive steps.
- `driveReplaceSteps(name, nameKnown)` - the numbered Drive steps shown
  after the save: an optional rename/check-the-name step, then a check that
  the saved file is not "name (1).zip" (if it is: delete every copy, save
  again - picking "name.zip" beside it would upload the OLD zip), the new
  tab with "Desktop site", the folder upload, "Replace existing file".
- `finishIdleLabel(canShare)`, `finishBusyLabel(canShare)`,
  `finishHandoffStatus({ route, delivered }, filename, drive)` - the
  button's words and the status line, as pure functions.
  - They are pure, and here rather than inline in the click handler,
    because THREE of the four outcomes cannot be reached in an e2e run: a
    headless browser has no share sheet, so this is the only place the
    share copy is ever checked.
  - The rule they encode: `saved` promises that the link and the printed
    code stay the same, which is true when the creator overwrites the
    hosted file and false when they share - sharing normally creates a new
    file with a new id while the printed code still points at the old one.
    `shared` therefore promises nothing and asks them to check.
  - And `notShared` does not say "you cancelled": the Web Share API reports
    a cancelled sheet and a failed share as the same error, so any such
    copy would be a guess stated as a fact.
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
- **Minting reads the STABLE fused pose** (delta #2; plan §60) in RAW WebXR/odom space (the
  frame the controller composes with each frame's capture pose); the conversion is
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
  getIntrinsics,
  recordDetection: (e) => store.dispatch(recordQrDetection(e)),
});
// … detections accumulate; once the fused pose (createFusedQrPoseSource) is 'stable':
const result = mintQrLevel({
  odomPose: stablePose,
  alignmentMatrix,
  zero,
  alignment,
  sizeM,
  nowIso,
}); // from the framework — see qr-mint-level.ts.md
```

- `waitingFor(reason)` is exported: the visitor hint
  (`qr-debug-readout.ts`) reads the same copy (plan §66, DEC-H3).

- `authorStatusLine(..., sizeCheckPending?)` adds "Take a step sideways to
  check the print size." to the ready line while the print-size check has no
  answer; `sizeOfferView(measuredM, typedM)` and `adoptedSizeNote(sizeM)`
  are the offer's copy (QR size consensus plan S3a): approximate, the ruler
  as arbiter, the field's unit (metres) beside the centimetres.

## Tests

`qr-author-mode.test.ts` — the geo-less/local fetch pins, the cadence pin,
the frame-conversion round-trips (identity and translation+yaw alignments,
hand-computed), the parser round-trip of the export, the mint-gate table,
and the plain-language refusals. The composed flow (real controller, slice,
stability, alignment solve, mint, export) is proven by
`playwright-tests/ar-mode.spec.js`'s author spec.
