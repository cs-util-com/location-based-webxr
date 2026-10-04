# visitor-position.ts

## Purpose

Where the visitor is, for the station run (tour kit plan K4): the camera
in the session's GPS-world NUE (the raw AR pose through the solved
alignment - the frame the tour's content and the wayfinding HUD use) and
the measured accuracy (the median of the latest device fixes). Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `visitorPosition({ alignment, arPose, gpsPositions }): VisitorPosition`
  - `nue` - `[north, up, east]`, or null without an alignment, an AR pose,
    a finite pose, or a readable alignment;
  - `accuracyM` - the median reported accuracy of the latest
    `ACCURACY_WINDOW_FIXES` (10) device fixes, or null.

## Invariants & assumptions

- **Device fixes only** (authoring plan §3.6, §7j #3): the viewer's code
  votes carry their own fixed accuracy and would make a phone in an urban
  canyon look precise; a fix without a usable accuracy is skipped.
- The window is about 10 s at 1 Hz; the median, so one outlier neither
  widens nor shrinks every station. 3 would follow single bad fixes; 30
  would keep a narrow radius for about 15 s after the sky closed (not
  swept: its effect is bounded by the band of `station-bands.ts`).
- The camera position goes through `throughAlignment(odomNueFromWebXr(...))`
  (`visit-anchoring.ts`), the composition the settle uses.

## Examples

```ts
const p = visitorPosition({
  alignment: selectAlignmentMatrix(state),
  arPose: seams.getArPose(),
  gpsPositions: selectGpsPositions(state),
});
```

## Tests

- `visitor-position.test.ts` - a real store aligned by a shifted walk puts
  the camera where the shift says; no position without each input; the
  median of the latest ten device fixes, votes and older fixes ignored.
