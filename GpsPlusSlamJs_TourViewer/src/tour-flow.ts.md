# tour-flow.ts

## Purpose

The page-level flow state and the copy derived from it (flows plan M1,
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-07-2259-tour-viewer-creator-and-visitor-flows-plan.md`).
The AR status line is the visitor's only feedback during a session
(`#error` sits outside the DOM overlay), so its composition lives here,
DOM-free and string-exact under test, instead of inline in `main.ts`.

## Public API

- `type TourFlowTour` - `{ kind: "none" } | { kind: "open"; levelCount:
number | null; hasRecording: boolean }`. `levelCount` is null while the
  tour's `qr/<id>.json` levels still load.
- `type PlacementState` - what the photo placement did: `idle` ·
  `placing { phase: "reading-walk" | "loading-photos"; done; total }` ·
  `placed { placedKind: "capture-spots"; count; fixes; gpsAccuracyMedianM }`
  · `declined { reason }` (the join's taxonomy reason; the ring is the
  fallback and the reason stays visible while it stands).
- `interface ArStatusInput` - mode, controller status, camera-frame count,
  the tour, the viewer pipeline's QR inputs (the `viewerStatusLine` shape),
  the `readiness` (the framework's `OnboardingGuidance` for the current
  tracking-quality report; null in author mode), the placement, and a
  placement error string.
- `isPlacementReady(report): boolean` - the placement trigger (flows plan
  M4, DEC-F3): true when `computeOnboardingGuidance(report).phase ===
"ready"`, i.e. the tracking-quality `ok` state. At the first GPS fix the
  alignment is the identity (no heading), so an earlier trigger could start
  the scene up to 180° wrong.
- `PlacementState` also carries `waiting-ready` (renders the readiness
  hint, or "Waiting for tracking to warm up…" without one) and
  `nothing-to-place` (a tour with neither a recording nor printed codes).
  `arStatusLine` DERIVES `nothing-to-place` from a `declined` placement on
  an open tour with `levelCount === 0` - whatever `hasRecording` says, since
  a decline already means the recording path is out and the ring needs a
  code (milestone review #1) - so the line follows the tour's facts at
  render time whatever order the decline and the levels arrived in.
- `qrSegment(input): string` - the printed-code line. Empty in author mode
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
- Pure: no DOM, no store; `main.ts` builds the input from its module state
  and writes the result into `#ar-status`.

## Examples

```ts
arStatusLine({
  authorMode: false,
  arStatus: "running",
  cameraFrames: 3,
  tour: { kind: "open", levelCount: 0, hasRecording: true },
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
// "Viewer mode — AR running · 3 camera frames · This tour has no printed codes. · nothing to place: this tour has no recording and no printed codes"
// (the decline on a code-less tour is DERIVED to nothing-to-place: a ring
// needs a code, so "photo ring (…)" would promise one forever - review #1)
```

## Tests

- `tour-flow.test.ts` - every branch of the line, string-exact, including
  the e2e-pinned prefix and the no-codes rule's scope.
- `tour-flow.property.test.ts` - the no-codes rule for every open-tour
  state and its absence with no tour; decline reasons verbatim; no
  non-idle placement renders as silence.
