# moved-code-check.ts

## Purpose

The viewer's per-AR-entry moved-code check (Tour Viewer authoring plan
2026-09-28-0953 §3.6, decision D20, milestone M5c): each scanned code is
pinned at its first voted lock and judged on every new device fix of the
store's GPS history with `moved-code-rule.ts` `judgeCodeMove`, until it
reads `moved` (reported once, with the detector's inputs) or its horizon
(`MOVED_CODE_HORIZON_S`, 300 s) passes. Pure of the page: the caller
(`viewer-placement.ts`) hands in the history and the page clock, and acts on
a verdict (the veto). No compass reading is taken (owner, 2026-10-02).

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
- `frameChanged(storedCount)` - the odometry frame changed: every check
  ends, and later pins fold only the history from `storedCount` on.
- `clear()` - end every check (a tour switch).
- `snapshot()` - the live checks (`MovedCodeCheckView`), for the `?debug=1`
  readout and tests.

`MovedCodeEvidence` (the `tourViewing/codeIgnored` payload's `evidence`):
`ruleVersion`, `decidedBy` (`position` or `turn`), `turnChecked`, `boundM`, `displacementM`,
`magnitudeM`, `yawDeg`, `spanS`, `spreadM`, `deviceFixes`,
`deviceAccuracyMedianM`, `storedAccuracyM`, `alignmentSampleCount`,
`settled`, `sinceScanS`.

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
- **A bounded fit window** (M5c review H2): only the device fixes stamped at
  most `MOVED_CODE_FIT_WINDOW_S` (300 s, `moved-code-rule.ts`) before the
  pin fold, and every one after it; a frame change cuts the history too.
  The window compares a fix's Geolocation stamp with the pin's page clock
  (`Date.now` in the viewer): both epoch milliseconds, as the measurement
  compared them. The real-walk visits were short (median 2.7 min), so the
  measured behaviour is the whole-visit fit; the window keeps a long session
  inside it.
- **No compass**: a code's turn is its rigid-fit yaw in GPS world space,
  read only for a settled save (`moved-code-rule.ts`).
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
code never; the horizon; the 300 s fit window, and old far-off fixes
that no longer veto; votes in the history change nothing; the settled
yaw; no turn check for an unsettled save; no compass input; a frame
change; a reset; the evidence; one pin per code; `clear()`),
`moved-code-check.property.test.ts` (slicing and vote-interleaving
invariance). The wired veto: `viewer-moved-code.test.ts`.
