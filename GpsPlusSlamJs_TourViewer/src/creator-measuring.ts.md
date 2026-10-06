# creator-measuring.ts

## Purpose

The creator's measuring of the code: the QR pipeline an AR entry starts,
the print-size offer, each detection's sighting, and the automatic
measurement of the code in view (UI round 1, U3) with the one
classification the panel's line and the measurement share. Split out of
`creator-setup.ts` unchanged in the code book refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`);
M4 replaces its one code in hand with the code book.

## Public API

- `wireCreatorMeasuring({ ctx, arStore, seams, dom, codes, wizard, codeTour, alignmentPicks, draft, sessionLive, alignmentInfo, placeEarlierObjects, render }): CreatorMeasuring`
  - `dom` (`CreatorMeasuringDom`): `sizeInput`, `finishButton` (held off
    while a measurement runs), `sizeOffer`, `sizeOfferText`,
    `sizeOfferUse`, `sizeOfferKeep` (whose clicks this module handles).
  - `seams`: `createQrFrontEnd`, `solveQrPose`, `getIntrinsics`.
  - `codeTour`: scan-to-open's `onDetection`, `tourOf`, `relation`.
- `CreatorMeasuring`:
  - `start()` - validate the printed size (revealing step 2 when it is
    unusable) and start the QR pipeline with a fused-pose source for this
    AR entry; false, with the reason in the panel, keeps AR unstarted.
  - `renderSizeOffer()` - the offer, or the confirmation after adopting.
  - `outcome(text)` / `maybeMeasure(canMint, measure)` - the
    classification below, and the measurement it asks for.
  - `inFlight()` - a measurement is running (Finish waits).
  - `endVisit()` - the visit's tries go.
- The code in hand, the stored codes' sightings and the levels a Finish
  wrote live in `creator-codes.ts` since M4a; this module reads and writes
  them through it.

## Invariants & assumptions

- **Mint:** reads the STABLE pose from the `qrDetected` slice, the
  alignment TARGET matrix and the zero; the level's identity is the async
  `qrCodeId` of the exact printed text, guarded by `ctx.mintGeneration` so
  a stale hash cannot install an older level. Until it lands the finish
  button stays off.
  - **A stored pose stays the reference** (D10b, M2c review #5): the level
    in hand before the tap is captured, and once the id lands
    `measurementRole` (`visit-settle.ts`) decides - with the hosted zip's
    `qr/<id>.json` read through `hostedLevelJson` (`session.loadEntryText`,
    under the text cap, K0 milestone review R10) when nothing of this code
    is in hand (ignored if another tour was opened meanwhile). A kept
    reference stays `mintedLevel` (so Finish writes the hosted file back
    byte for byte), the measurement becomes this visit's sighting, the
    line says "Code seen - its saved position stays, and this visit is
    lined up with it", and `setupHint` says "Saved position kept" rather
    than "replaces". `tourAuthoring/codeMeasured` logs which happened
    (`kept`). A failed identity hash restores the level in hand. A hosted
    level whose file cannot be read, or carries no geo, is not a
    reference: the measurement is, as before.
- **Automatic measuring** (UI round 1, U3; plan review #1; U3 milestone
  review #6, #7): there is no "Save the measured position" button. Each
  render classifies the code in view (`codeOutcome`), and the same answer
  feeds the line (`authorStatusLine`'s `ready`) and the measurement
  (`maybeMeasure`), so the line never claims a measurement that does not
  happen:
  - the code in hand: `measured`;
  - a measurement in flight, or a code still being read: `measuring`;
  - with a code in hand, another STORED code (or one not identified
    yet): `seen` - a sighting for the visit log; taking it in hand would
    change what this visit's objects are corrected through;
  - with a code in hand that is not saved in the tour yet (neither
    hosted nor written by a Finish of this page, `creator-codes.ts`'s
    `isSaved`), a
    new code: `finish-first` - each Finish writes the ONE code in hand,
    so measuring past it would silently drop it;
  - with no tour open: `seen`;
  - a code the open tour may not take (`autoMeasureAllowed`):
    `not-measured`, and scan-to-open's "added to the open tour" line is
    left out so the two do not contradict;
  - otherwise it is measured, once per visit and code (`autoMeasured`,
    cleared at the visit's end and when a measured print size is
    adopted), never during a Finish.

  A measurement that lost the gate is tried again; one the mint or the
  identity refused is not, and its reason becomes the panel's note (the
  only note a measurement writes - it clears none, and no failed
  Finish's line). It keeps the level in hand while its identity is
  derived (an emptied hand refused every placement in that window) and
  holds Finish off while it runs (`inFlight`). The once-per-visit rule
  replaces the tap's "measure again": the settle refines a code measured
  here through its own pick (D33), not through later sightings.

- **Each detection** records the event, feeds scan-to-open and the
  print-size check, evaluates the fused pose (after EVERY detection: the
  motion detector counts detections) and notes a stable sighting: the code
  in hand's (or any code's, with none measured) becomes the visit's
  sighting and re-places the earlier visits' objects; any code with a
  stored pose is also kept for the visit log. A text's level id is derived
  once (`qrCodeId`, async); without Web Crypto there is no sighting.
- **The creator pipeline's fused evaluations are counted** per code into
  `ctx.fusedTallies` for the `?debug=1` readout (plan §66), from the
  source's `onEvaluated`.

- **The print-size check** (QR size consensus plan S3a, `print-size-check.ts`):
  every detection feeds it (through the `estimateQrPrintSize` seam, so the
  e2e can show an offer); its offer renders in its own element, first in the panel,
  (`dom.sizeOffer`, with "Use" / "Keep"), because `status` is rewritten on
  every dispatch. **Adopting** writes the measured size into the size field,
  invalidates a position saved this session (`mintGeneration` bump,
  `mintedLevel` null, draft meta re-written), ends the QR pipeline, clears the
  code's detections (`clearQrMarker` - solved at the old size) and starts the
  author pipeline again at the new size; a note says so until the code is
  stable again. While the check has no answer, the ready line asks for a
  sideways step (the mint is not held).

## Tests

Composed, through `wireCreatorSetup`: `fused-pose-wiring.test.ts` (the
pipeline, the fused pose, the measurement and its identity, Finish held
while one runs, a new print size), `authoring-settle.test.ts` (automatic
measuring, the classification, the sightings) and `creator-setup.test.ts`
(the size offer). The sampled mutants of the regions "measuring", "size
offer" and "sightings" (`scripts/fixtures/creator-setup.mutants.json`) are
killed or judged equivalent.
