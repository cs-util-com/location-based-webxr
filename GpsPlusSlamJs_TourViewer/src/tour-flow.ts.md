# tour-flow.ts

## Purpose

The page-level flow state and the copy derived from it (flows plan M1,
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-07-2259-tour-viewer-creator-and-visitor-flows-plan.md`).
The AR status line is the visitor's only feedback during a session
(`#error` sits outside the DOM overlay), so its composition lives here,
DOM-free and string-exact under test, instead of inline in `main.ts`.

## Public API

- `ArStatusInput["tour"]` (the module-private `TourFlowTour`) -
  `{ kind: "none" } | { kind: "open"; levelCount: number | null }`.
  `levelCount` is null while the tour's `qr/<id>.json` levels still load.
  (Whether the zip has a recording is NOT an input: a decline already says
  the recording path is out - M6 review #1.)
- `type PlacementState` - what the photo placement did: `idle` ·
  `placing { phase: "reading-walk" | "loading-photos"; done; total }`
  (`loading-photos`: the photos no station holds, decoding up front) ·
  `placed { placedKind: "capture-spots"; count; atStations?; fixes; gpsAccuracyMedianM }`
  · `placed { placedKind: "ring"; count; atStations? }` (`count`: the
  photos standing, decoded and drawn; `atStations`: the photos waiting at
  their stations, drawn only while one shows; absent: 0. Rendered "N photos
  at capture spots", "N photos at their stations", "A photos at capture
  spots and B at their stations", "N photos in a ring around the code[, at
  its station]")
  · `declined { reason }` (the join's taxonomy reason; the ring is the
  fallback and the reason stays visible while it stands).
- `interface ArStatusInput` - mode, controller status, camera-frame count,
  the tour, the viewer pipeline's QR inputs (the `viewerStatusLine` shape),
  the `readiness` (the framework's `OnboardingGuidance` for the current
  tracking-quality report; null in creator mode), the placement, a
  placement error string, `stationsAwaitHeading?` (the visitor guide
  waits for a heading, D34; read only by `visitorStatus`) and
  `awayFromStations?` (the tour placed, every piece of its content waiting
  at a station not shown now; read only by `visitorStatus`).
- `isPlacementReady(report): boolean` - the placement trigger (flows plan
  M4, DEC-F3): true when `computeOnboardingGuidance(report).phase ===
"ready"`, i.e. the tracking-quality `ok` state. At the first GPS fix the
  alignment is the identity (no heading), so an earlier trigger could start
  the scene up to 180° wrong. One exemption (QR-first M1): a code that
  placed the tour (`viewer-placement.ts` `codePlacedTour()`) triggers the
  placement before this gate - on votes alone the phase reads `degraded`.
  It cannot be 180° wrong: a voted lock's ring carries the code's saved
  heading, unlike a single GPS fix (`viewer-content-alignment.test.ts`
  places the pin to under 1 cm on votes alone).
- `codeLinedUp(qr): boolean` - a code's votes lined the tour up
  (`qr.lockedText` set and `qr.votedLocks > 0`; after the escape too, the
  gate staying "skipped"). Read by the visitor's status line and, through
  `visitor-stations.ts`, by the station guide, which then trusts the
  position whatever the raw fixes' accuracy.
- `codePlacedTour(ctx): boolean` - the gate passed via a code and
  `ctx.viewerVotedLocks > 0`: the walk's placement trigger runs whatever
  the tracking phase reads (`viewer-placement.ts`). Since r881 the veto
  sets the count to 0, so a tour whose votes were all taken back is no
  longer code-placed (review M1); an odometry-frame change sets it to 0 as
  well (`endCodeTrust`), until the code's next voted lock.
- `alignmentReady(report, qr): boolean` - `isPlacementReady(report) ||
codeLinedUp(qr)`: whether the station guide judges on the aligned frame
  (its position, the HUD's arrows, the breadcrumbs, the figure). The find
  re-reads it each tick, and while it is false judges by the fresh device
  fix instead (r881 review H1; readiness needs a walk with turns and may
  never come for a visitor standing or walking straight). What needs a
  heading latches its first `true` per AR entry, as the photos' trigger
  does, so a degraded dip does not take the arrows away (re-review L-B).
- `PlacementState` also carries `waiting-ready` (renders the readiness
  hint, or "Waiting for tracking to warm up…" without one) and
  `nothing-to-place` (a tour with neither a recording nor printed codes).
  `arStatusLine` DERIVES `nothing-to-place` from a `declined` placement on
  an open tour with `levelCount === 0` - whatever `hasRecording` says, since
  a decline already means the recording path is out and the ring needs a
  code (milestone review #1) - so the line follows the tour's facts at
  render time whatever order the decline and the levels arrived in.
- `contentSegment(content)` - "N placed objects (K could not load)" once
  the tour's `tour.json` content is rendered (M5).
- The composed line carries the scan gate's segment (`gateSegment`, from
  `scan-gate.ts`); while the gate scans, the placement segment (with its
  coaching hint) and the pipeline's generic scanning line are suppressed -
  "walk around" would contradict "stay at the code".
- `qrSegment(input): string` - the printed-code line. Empty in creator mode
  or before the pipeline reports a status.
- `placementSegment(placement, readiness = null): string` - the placement
  copy; `""` for idle; `waiting-ready` renders `readiness.hint` (or the
  generic wait); a placed ring renders "N photos in a ring around the code"
  (milestone review #2).
- `arStatusLine(input): string` - the whole `#ar-status` text.
- `clearCacheLabel(removed): string` - the Clear-cache confirmation
  ("Cache cleared - N stored tours removed", singular for 1, "nothing was
  stored" for 0). `removed` is the store's index length read BEFORE the
  open session's eviction (flows plan M2).

## A code the moved-code check ignores (D20, M5c)

`ArStatusInput.qr.ignoredCode` reaches `viewerStatusLine`, which then says
"This code seems to have been moved, so its position is not used. Showing
the tour by GPS." With the gate passed via `ignored`, that sentence stands
for both (the gate's short pass is dropped); without a code to name (a
re-entry) the gate's "Code ignored - placing the tour by GPS." replaces the
generic scanning line.

## Invariants & assumptions

- **The running prefix is a contract:** `"<mode> — AR running · N camera
frames"` is asserted literally by `playwright-tests/ar-mode.spec.js`.
- **No-codes rule (feedback F3):** with a tour OPEN, `levelCount === 0`, a
  reporting pipeline and nothing detected, the QR line is "This tour has no
  printed codes." - never "Scanning for the printed code…". A detected
  unknown/unusable code or a lock overrides it (those lines name the code).
- **DEC-T9 kept:** with NO tour open the scanning line stays - the pipeline
  runs from session start so a tour opened later still resolves.
- Segments are joined with `" · "`; empty segments are dropped, so the line
  never carries a dangling separator.
- The placement strings are the geo-join results doc's wording; the e2e
  specs match them by regex (`photos at capture spots (4 fixes`, `photo
ring`, `reading the walk`).
- Pure: no DOM, no store; `ar-entry.ts` builds the input from the session
  object and writes the result into `#ar-status`.

## Examples

```ts
arStatusLine({
  mode: "visitor",
  arStatus: "running",
  cameraFrames: 3,
  tour: { kind: "open", levelCount: 0 },
  qr: {
    status: scanning,
    unknownCode: null,
    unusableCode: null,
    votedLocks: 0,
    lockedText: null,
    reprojectionErrorPx: null,
  },
  readiness: null,
  placement: { kind: "declined", reason: "no recording in this tour" },
  planesError: null,
});
// "Visitor mode — AR running · 3 camera frames · This tour has no printed codes. · nothing to place: this tour has no recording and no printed codes"
// (the decline on a code-less tour is DERIVED to nothing-to-place: a ring
// needs a code, so "photo ring (…)" would promise one forever - review #1)
```

- `ArStatusInput.qr.fusedHint` carries the visitor hint through to
  `viewerStatusLine` (plan §66); it sits beside the gate's "Code
  recognised" line, which is why it reads as fine-tuning (§67 #6).
- `ArStatusInput.qr.hold` carries the code keep-alive's phase (authoring
  plan M2b) to `viewerStatusLine`: once the budget is spent the line says
  whether the code still holds the placement (with the seconds left), is
  fading, or has ended - never the old unconditional "placement holds".

## Tests

- `tour-flow.test.ts` - every branch of the line, string-exact, including
  the e2e-pinned prefix and the no-codes rule's scope; the placed wording
  with photos standing, at their stations, or both.
- `tour-flow.property.test.ts` - the no-codes rule for every open-tour
  state and its absence with no tour; decline reasons verbatim; no
  non-idle placement renders as silence.

## UI round 1 (2026-10-06)

- `arStatusLine` is now the CREATOR's line and a visitor's `?debug=1` line;
  a visitor otherwise reads `visitor-status.ts`'s one sentence. A failed
  start reads "<mode> — error: <cause>" (`ArStatusInput.arError`), since the
  start button only says "Try again" (U1 milestone review #1).
