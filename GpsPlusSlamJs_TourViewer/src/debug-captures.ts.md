# debug-captures.ts

## Purpose

The walk's debug camera captures in the world: replay a tour's recording
once, place each camera capture through the first settled alignment after
it was taken, and return where each one stands. They are debug data (the
plan `2026-10-20-1159-debug-captures-and-codes-in-store-plan`, M1): no
station holds them, a visitor never sees them, and no page writes them into
`tour.json`. The desktop editor draws them as its debug layer, once the
tour has opened. The module began as the bake that seated the captures in
stations at the open (`capture-bake.ts`); that half went with M1.

## Public API

- `debugCapturesOf(source, options?) -> Promise<DebugCapturesRead>`
  - `source`: `loadSessionMeta`, `loadRecordingActions` and `entries`
    (`{ filename, isImage }`) - a `TourSession` fits.
  - `options.shouldContinue()`: asked before each replay chunk; `false`
    stops the replay and the result is `{ kind: "declined", reason:
"stopped" }` (a partial state is never assessed).
  - `options.onChunk(done, total)`: the replay's progress.
  - `options.extentOf(state)`: the pick tracker's GPS-extent measure
    (`createCapturePickTracker`'s own option); production leaves it unset.
  - Result: `{ kind: "placed", captures }` (`DebugCaptures`: `fixes`,
    `gpsAccuracyMedianM`, and `captures`, each `{ image, geo }` in capture
    order) or `{ kind: "declined", reason }`.
- Types: `DebugCapture`, `DebugCaptures`, `DebugCapturesRead`,
  `DebugCaptureSource`, `DebugCaptureOptions`.

## Invariants & assumptions

- **Every decline is the join's own** (`preflightCaptureJoin`: no
  recording, era, segmenting actions; `assessReplayedJoin`: no GPS, too
  few fixes, an unsolved or malformed alignment, no captures), plus the
  ones decided right after the replay, before the GPS verdict, when the
  walk names no capture file the tour carries:
  - "the recording contains no camera captures": a recording of a known
    era (`NEWEST_KNOWN_ODOM_COORD_VERSION`) with no `CAPTURE_ACTION`.
  - "none of the camera captures could be placed": a newer era (its
    replay may show this build none of its captures, PR #638 review), or
    captures the replay turned into no place (taken before the GPS zero).
    The era is NARROWED, never cast: a hand-edited string version
    compares as a number in JavaScript ("3" <= 5; PR #640 review).
  - "no camera capture file in this tour": the walk placed captures, none
    of whose files the zip carries.
  - and, after the solve, "none of the camera captures could be placed"
    for files the tour carries none of which could be placed (no unit test
    reaches it - the sample's solve places every frame whose file it
    names).
- **Only captures the zip carries as images are placed**: one naming no
  file would show nothing.
- **One per file**: a file captured again keeps its last pose, as the zip
  keeps its last write (S1 milestone review #7).
- `fixes` and `gpsAccuracyMedianM` are the walk's (the final assessment's);
  `null` stays `null`.
- Errors thrown by the session's reads (a cap's refusal, a failed
  integrity check) propagate; the caller words them.
- Pure of the page: no DOM, no store; the replay runs once per call.

## Examples

```ts
const read = await debugCapturesOf(session, {
  shouldContinue: () => stillOpen(session),
  onChunk: (done, total) => showProgress(done, total),
});
if (read.kind === "placed") drawLayer(read.captures.captures);
else showLine(`No debug camera captures: ${read.reason}.`);
```

## Tests

`debug-captures.test.ts`, over the repo's real sample recording (the
PhysicsDemo fixture): five places of six frames, each finite and naming a
file of the tour; each through ITS pick (with every moment declared settled
the places move off the end-of-walk join, which a join ignoring the picks
cannot do - the sample walk alone never settles and could not tell them
apart); a file captured twice named once; a missing file dropped and none
left declined, also when the only file left is the frame the recording
never placed; a walk with no capture taken, with GPS that solves and with
no fix at all; a newer era and captures the replay placed none of; the
join's own declines (no recording, an old era, an absent or string era, a
stopped replay).
