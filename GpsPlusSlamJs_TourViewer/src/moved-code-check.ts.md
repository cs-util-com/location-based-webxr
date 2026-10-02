# moved-code-check.ts

## Purpose

The viewer's per-AR-entry moved-code check (Tour Viewer authoring plan
2026-09-28-0953 §3.6, decision D20, milestone M5c): each scanned code is
pinned at its first voted lock and judged on every new device fix of the
store's GPS history with `moved-code-rule.ts` `judgeCodeMove`, until it
reads `moved` (reported once, with the detector's inputs) or its horizon
(`MOVED_CODE_HORIZON_S`, 300 s) passes. Pure of the page: the caller
(`viewer-placement.ts`) hands in the history, the page clock and the compass
readings, and acts on a verdict (the veto).

## Public API

`createMovedCodeChecks(): MovedCodeChecks`

- `pin({ text, levelId, level, qrPoseWorld, atMs, zero })` - start checking
  `levelId` from the stable pose (raw WebXR) its first voted lock was built
  from, onto the level's geo through `zero`. No-op for a level already
  checked in this frame, a level without geo, no zero, a non-finite time,
  or a pose pair with no yaw.
- `update({ gpsPositions, odometryPositions, zero }, nowMs)` - fold the
  history's new device fixes into every live check and judge it; returns
  the codes that read `moved` now (`{ text, levelId, evidence }`), each
  once: its check ends. A check past its horizon ends silently.
- `compass(arNorthDeg, atMs)` - a compass reading; the first one at or after
  a code's pin is kept as its compass turn (`compassTurnDeg`).
- `frameChanged(storedCount)` - the odometry frame changed: every check
  ends, and later pins fold only the history from `storedCount` on.
- `clear()` - end every check (a tour switch).
- `snapshot()` - the live checks (`MovedCodeCheckView`), for the `?debug=1`
  readout and tests.

`MovedCodeEvidence` (the `tourViewing/codeIgnored` payload's `evidence`):
`ruleVersion`, `decidedBy`, `turnChannel`, `boundM`, `displacementM`,
`magnitudeM`, `yawDeg`, `spanS`, `spreadM`, `deviceFixes`,
`deviceAccuracyMedianM`, `storedAccuracyM`, `alignmentSampleCount`,
`settled`, `outdoor`, `compassTurnDeg`, `sinceScanS`.

## Invariants

- **Device fixes only** (§7j #3): the history goes through
  `displacementSamples` (`deviceSamples`). The code's own votes agree with
  its pin by construction and would dilute a move towards zero; a test and a
  property pin that votes in the history change nothing.
- **Incremental, slicing-invariant**: each check remembers how much of the
  history it folded and folds only the rest (O(1) per fix); however the
  growth is sliced the estimate is the same (property). A history that
  SHRANK (a reset, e.g. the veto's own recovery) is folded again from its
  start, so no fix counts twice.
- **The whole history, as measured**: the real-walk pairs fit every device
  fix of the visit, those before the scan too; only a frame change cuts it.
- **The compass at the scan**: a reading before the pin is never used.
- Accuracies are the folded device fixes' reported ones (median by sorted
  insert); the saved level's are read from `mintQuality`.

## Example

```ts
const checks = createMovedCodeChecks();
checks.pin({ text, levelId, level, qrPoseWorld, atMs: lockMs, zero });
// on every store change that grew the GPS history:
for (const v of checks.update(
  { gpsPositions, odometryPositions, zero },
  Date.now(),
)) {
  veto(v); // viewer-placement: ignore, retract the votes, log
}
```

## Tests

`moved-code-check.test.ts` (a 40 m move read once after 60 s; an unmoved
code never; the horizon; votes in the history change nothing; the settled
yaw; the compass at the scan, not indoors and not before the pin; a frame
change; a reset; the evidence; one pin per code; `clear()`),
`moved-code-check.property.test.ts` (slicing and vote-interleaving
invariance). The wired veto: `viewer-moved-code.test.ts`.
