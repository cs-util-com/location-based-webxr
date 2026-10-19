# visitor-position.ts

## Purpose

Where the visitor is, for the station run (tour kit plan K4): the camera
in the session's GPS-world NUE (the raw AR pose through the solved
alignment - the frame the tour's content and the wayfinding HUD use) and
the measured accuracy (the median of the latest device fixes). Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `visitorPosition({ alignment, arPose, gpsPositions, zero? }): VisitorPosition`
  - `nue` - `[north, up, east]`, or null without an alignment, an AR pose,
    a finite pose, or a readable alignment;
  - `accuracyM` - the median reported accuracy of the latest
    `ACCURACY_WINDOW_FIXES` (10) device fixes, or null.
  - `fixNue` - where the latest DEVICE fix alone puts the visitor
    (`[north, up, east]` from the zero), or null without a zero or a device
    fix. Never moved by a code's votes, which pull `nue` onto the code's
    saved spot: the station guide judges a code lock by it (K4 review R1).
  - `aligned` - the session has a usable alignment (16 finite numbers): a
    null `nue` then means only a tracking drop (no AR pose), never "no
    alignment yet". The station guide's raw fix stands in only without
    one (M5a review M3).
  - `fixAtMs` - the latest device fix's own time (its Geolocation
    timestamp, epoch ms), or null exactly when `fixNue` is: the guide
    ignores a fix older than `FIX_MAX_AGE_MS`.
  - `fixAccuracyM` - the latest device fix's own reported accuracy (m),
    or null when `fixNue` is or that fix states none (missing, zero,
    negative, not finite). Where the fix alone is the position, the guide
    judges it by the worse of this and `accuracyM`: one ±40 m Wi-Fi fix
    after a run of ±5 m GPS fixes leaves the median at 5 m (r881
    re-review M-A).

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
  median of the latest ten device fixes, votes and older fixes ignored;
  `aligned` with a dropped pose and without an alignment, and the latest
  device fix's time (never a vote's).
