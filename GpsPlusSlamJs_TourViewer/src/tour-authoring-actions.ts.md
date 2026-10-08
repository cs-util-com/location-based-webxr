# tour-authoring-actions.ts

## Purpose

The `tourAuthoring/*` actions: what the creator setup dispatches so the
troubleshooting recording holds each placement, the code measurement and the
finish WITH the raw inputs they were computed from. Log-only - no reducer
reads them (the framework's `diagnostics/note` precedent). Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, M1a.

## Public API

- `objectPlaced(payload)` - `tourAuthoring/objectPlaced`: `object` (the
  manifest record), `arVisitIndex` (AR sessions ended before this one),
  `atMs` (epoch), `reticleOdomNue` (a pin: the reticle in the world group's
  local frame, NUE odometry; null for a photo or without a group),
  `cameraOdomPose` (a photo: the frame's capture pose, raw WebXR odometry;
  null for a pin), `alignmentMatrix` (the store's, the solve's target),
  `arWorldGroupMatrix` (a pin: the group's rendered matrix, which lags the
  target while it lerps), `code` (the code last in view: text, fused status,
  fused pose or null), `codeSizeM` (the anchor code's printed size in metres
  the setup worked with, `ctx.activeSizeM` - known even with no code in
  view; a code's solved pose scales with it).
- `codeMeasured(payload)` - `tourAuthoring/codeMeasured`: `levelId`, `text`,
  `fusedOdomPose` (the stable fused pose minted from), `sizeM`,
  `alignmentMatrix`, `alignment` (the mint gate's info), `levelJson` (the level
  as written), `arVisitIndex`, `atMs`, and `kept` (M2c review #5): what the
  measurement became - `measurement` (the code's reference), or a sighting
  that kept the stored pose in hand (`level-in-hand`) or the hosted zip's
  (`hosted-level`). Optional in the type only because recordings made
  before it lack it.
- `visitSettled(payload)` - `tourAuthoring/settled` (M2c, plan §3.2): an AR
  visit's settle - `arVisitIndex`, `atMs`, `trigger` (`visit-end`,
  `finish`, or `late-arrival` - a photo of an already settled visit, minted
  through that visit's settle when its encode landed), `basis` (`visit-settle.ts`), `visitAlignment` (the store's, read
  before the teardown), `usedAlignment` (what the geo went through),
  `sighting` (the LATEST sighting of the code the end choice went through -
  the code seen last since M5a - when it was code-corrected, or null), `levels`
  (since M5a, optional): every level the settle re-minted, with its
  alignment; since D33 each object is corrected through
  the sighting nearest it, whose pose is not logged), `objects` (each
  settled object's `id` and new `geo`, and since D33 its own `basis`,
  `usedAlignment` and `refusedCorrection`: each object goes through the
  first mature alignment after its own moment, so the top-level
  `usedAlignment` is the choice for an object placed at the visit's end -
  what a late arrival uses; these three are optional and absent in
  recordings made before D33, and no reader parses them yet: the entry is
  only checked for its place in the action order), `level` (the re-minted
  code, or null) with `levelAlignment` (the measurement's own alignment,
  D33; optional, absent before D33), `referenceLevel` (the code the end choice went through - the code seen
  last since M5a - before any re-mint: the stored pose a code correction
  maps onto) and `zero` (M2c
  review #7): with `visitAlignment` and `sighting` a replay recomputes the
  END choice's code-corrected `usedAlignment` through `correctedAlignment`
  (pinned by the cross-visit test in `authoring-settle.test.ts`), but not
  the per-object choices of D33, whose picks and sightings are not logged:
  a replay reads those from `objects[].usedAlignment`, and `refusedCorrection`
  (a code correction the plausibility bound refused - its horizontal size,
  yaw and the bounds - after which the visit settled through its plain
  alignment; null otherwise; M2c review #2). The tap-time geo of `objectPlaced`/`codeMeasured` is what a killed
  tab keeps; this is what the zip carries, so a replay needs it.
- `authoringFinished(payload)` - `tourAuthoring/finished`: `levelId` (the
  code in hand, null for a desk edit), `levelIds` (every level the Finish
  wrote, M4 milestone review #6), `manifest` (what the rebuilt zip
  carries), `atMs`.
- Editing (plan §3.4, M4; `object-editing.ts`):
  - `objectEdited(payload)` - `tourAuthoring/objectEdited`: `before`,
    `after` (the records), `arVisitIndex`, `atMs`, `surface` (`page` or
    `ar`).
  - `objectMoved(payload)` - `tourAuthoring/objectMoved`: `before`,
    `after`, `arVisitIndex`, `atMs`, `reticleOdomNue` (the reticle in the
    world group's frame), `basis`, `visitAlignment`, `usedAlignment` (the
    corrected one when `basis` is `code-corrected`), `sighting`,
    `refusedCorrection` and `zero` - the settle's set, so a replay
    recomputes the moved geo.
  - `objectDeleted(payload)` - `tourAuthoring/objectDeleted`: `object`,
    `hosted` (a tombstone the Finish applies, or only on this device),
    `arVisitIndex`, `atMs`, `surface`.
  - `objectDeleteUndone(payload)` (M4 review #5) -
    `tourAuthoring/objectDeleteUndone`: the same payload as the
    `objectDeleted` it undoes (the restored object, `hosted`, the visit,
    the time, the surface), so a replay pairs the two by the object's id.
  - `codeMeasured` gains `replaced` - the stored pose the explicit
    "Replace the code's saved position" replaced; absent for every other
    measurement, and in recordings since UI round 1 U3 (no explicit
    replace any more).
- The moved-code prompt's actions (authoring plan §3.6, D20, M5b; §7j
  #15) exist in recordings from before code book plan M6 only (the prompt
  was removed; `visitSettled`'s `codeSpots` logs the automatic rule):
  - `codeMovePrompted(payload)` - `tourAuthoring/codeMovePrompted`, once
    per refusal run: `levelId`, `arVisitIndex`, `atMs`, the refusal
    (`horizontalM`, `northM`/`eastM` - where the visit sees the code minus
    its saved position - `yawDeg`, `maxHorizontalM`) and how long it
    lasted (`fixes`, `seconds`, null without readable fix times).
  - `codeMoveAnswered(payload)` - `tourAuthoring/codeMoveAnswered`: the
    `answer` (`moved`, `second-copy`, `not-now`; an Undo of "moved" is a
    `not-now`), the spot, `replaced` (false since UI round 1 U3: a "moved"
    answer is applied by the settle) and `error`. `use-new-spot` and
    `tourAuthoring/codeReplaceUndone` (the immediate replace and its undo)
    exist in older recordings only.
- `visitSettled` gains `codePositions` (code book plan M5c): one entry per
  stored code the visit saw, in the shape below; `codePosition` is the
  first of them.
- `visitSettled` gains `codePosition` (UI round 1, U3;
  `code-position-settle.ts`): for a stored code the visit saw, the
  `decision` (keep with its reason, replace, move; `move-waits` in
  recordings from before M6 only; `undo` since M6), the
  `offsetM`, the `candidate` and `stored` qualities, whether it was
  `applied`, and `movedWithCode` - each earlier object an improved code
  took with it, `before` and `after`.
- Each creator carries `.type`, as RTK's do; the payload interfaces are
  module-private (knip), reachable as `Parameters<typeof objectPlaced>[0]`.
- `logAction`, `LogActionCreator`, `AlignmentMatrix` - exported since M1b
  for `tour-viewing-actions.ts`, the package's other log actions (one
  helper per package).

## Invariants & assumptions

- **No reducer, on purpose.** Dispatching one changes no state; the recording
  is the only place they exist. A reducer added later would make them
  ambiguous (the recording or the state?).
- **The prefix is derived, never typed twice.** The store persists
  `slicePrefixOf(objectPlaced.type)` (`tour-viewer-session.ts`); a rename here
  moves the persisted prefix with it.
- **JSON-safe payloads.** They are written to files as they are: tuples,
  plain records, numbers, strings, null. Poses and matrices are the library's
  tuples; the world group's matrix is `matrixWorld.toArray()`.
- **Dispatched at top level** (from the tap's handler, the mint's hash
  continuation, the finish's async body), never from inside another dispatch,
  so the persistence middleware's re-entrancy tripwire never fires and their
  recorded order follows what they depend on.
- **Not RTK's `createAction`** only because this package has no direct
  `@reduxjs/toolkit` dependency; adding one changes the lockfile, a root file
  that sends every commit gate to the full cascade.
- The `tourViewing/*` family lives in `tour-viewing-actions.ts` (M1b, the
  viewer recording), built with this module's `logAction`.

## Examples

```ts
arStore.dispatch(
  authoringFinished({
    levelId,
    levelIds: levels.map((l) => l.id),
    manifest: written,
    atMs: Date.now(),
  }),
);
```

## Tests

- `creator-setup.test.ts` ("the troubleshooting recording's log of a
  placement"): a placed pin logs its reticle in odometry, the store's and the
  group's matrices, the code's printed size, and a JSON-safe payload; with
  the world group yawed 90 degrees the logged reticle is the group-local
  position (not the world one, nor the opposite rotation), and the logged
  matrix maps it back onto the reticle.
- `creator-finish.test.ts` ("the troubleshooting recording's log of the
  finish"): the finish logs the manifest the rebuilt zip carries.
- `authoring-recording.test.ts`: a finish dispatched on the page between two
  AR visits is in the recorded stream.
- `playwright-tests/ar-mode.spec.js` (the recording e2e): `codeMeasured`,
  `objectPlaced` and `finished` are in the saved zip, in order.
- `authoring-settle.test.ts` ("editing placed objects", "re-measuring a
  stored code on purpose"): `objectEdited`, `objectMoved` (with the
  correction's inputs), `objectDeleted`, `objectDeleteUndone`, and `codeMeasured.replaced`.

- `visitSettled` gains `codeSpots` (code book plan M6 v5.1): every
  automatic code-spot decision of the settle, `{ levelId, decision }` as
  `code-spots.ts` returns it. That is a move, an undo, a second print
  seen, a confirmation, or nothing and why.
