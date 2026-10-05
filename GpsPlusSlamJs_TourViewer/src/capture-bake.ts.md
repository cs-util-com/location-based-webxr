# capture-bake.ts

## Purpose

The capture join, baked (scan-pass plan
`2026-10-05-1240-tour-scan-pass-desktop-editor-and-partial-download-plan`,
S1 and owner decision S-D11): replay a tour's recording once, place each
recorded photo through the first settled alignment after it was taken, and
return the spots `tour.json` carries as `captureSpots`. The creator's
Finish writes them; a visitor places them and never downloads or replays
the walk. The viewer runs the same function over a tour never finished
since S1, so a baked tour and an unbaked one show the photos at the same
spots.

## Public API

- `bakeCaptureSpots(source, options?) -> Promise<CaptureBake>`
  - `source`: `loadSessionMeta`, `loadRecordingActions` and `entries`
    (`{ filename, isImage }`) - a `TourSession` fits.
  - `options.shouldContinue()`: asked before each replay chunk; `false`
    stops the replay and the result is `{ kind: "declined", reason:
"stopped" }` (a partial state is never assessed).
  - `options.onChunk(done, total)`: the replay's progress.
  - `options.extentOf(state)`: the pick tracker's GPS-extent measure
    (`createCapturePickTracker`'s own option); production leaves it unset.
  - Result: `{ kind: "baked", spots }` or `{ kind: "declined", reason }`.
- `posesOfCaptureSpots(spots) -> CaptureWorldPose[]`: the spots as the
  join's poses for the viewer's one placing path (`alt` becomes
  `altitude`); a spot without a rotation is left out.

## Invariants & assumptions

- **Every decline is the live join's own** (`preflightCaptureJoin`: no
  recording, era, segmenting actions; `assessReplayedJoin`: no GPS, too
  few fixes, an unsolved or malformed alignment, no captures), plus one:
  no photo file left. A declined bake writes nothing, so the tour keeps
  the live join, exactly as before S1.
- **Only photos the zip carries as images are baked**: the live join's
  decode skips a missing frame, and a spot naming no file would show
  nothing.
- `fixes` and `gpsAccuracyMedianM` are the walk's (the final assessment's),
  as the live join's status line reported them; `null` stays `null`.
- Errors thrown by the session's reads (a cap's refusal, a failed
  integrity check) propagate; the callers decide (the Finish rethrows
  those two and keeps the live join for anything else).

## Examples

```ts
const bake = await bakeCaptureSpots(session, {
  shouldContinue: () => ctx.session === session,
});
if (bake.kind === "baked") manifest = { ...manifest, captureSpots: bake.spots };
```

## Tests

`capture-bake.test.ts`, over the repo's real sample recording (the
PhysicsDemo fixture): five spots of six photos that the visitor's reader
accepts; each photo through ITS pick (with every moment declared settled
the spots move off the end-of-walk join, which a bake ignoring the picks
cannot do - the sample walk alone never settles and could not tell them
apart); a missing photo file dropped and none left declined; the live
join's declines (no recording, an old era, a stopped replay); and the pose
conversion. The Finish's use is pinned in `creator-finish.test.ts`, the
viewer's in `playwright-tests/ar-mode.spec.js` (a baked tour without a
recording) and `replay-abort-wiring.test.ts`.
