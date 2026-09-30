# tour-viewing-actions.ts

## Purpose

The `tourViewing/*` actions: what the VISITOR's pipeline dispatches so the
`?debug=1` viewer recording holds each scan lock, the votes it cast and each
placement WITH the inputs they used. Log-only - no reducer reads them (the
`tourAuthoring/*` and framework `diagnostics/note` precedent). Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1 ("`tourViewing/*`: each scan lock, the votes cast, each placement"), M1b.

## Public API

Every payload carries `arVisitIndex` (AR sessions ended before this one) and
`atMs` (epoch ms).

- `codeLocked(payload)` - `tourViewing/codeLocked`: `text`, `level` (the
  resolved level's `qr`: printed size, geo, mint quality; null when the tour
  has none for the code), `qrPoseWorld` (the lock's solve, raw WebXR
  odometry), `reprojectionErrorPx`, `scanGate` (the gate's kind when the lock
  arrived), `alignmentMatrix` (the store's, before the lock's votes).
- `votesCast(payload)` - `tourViewing/votesCast`: `text`, `votedLocks` (the
  code's budget spent so far), `votes` (each `{ latitude, longitude,
altitude, accuracyM, odomPosition }` as the fusion received it),
  `alignmentMatrix` (after the votes).
- `tourPlaced(payload)` - `tourViewing/placed`: `what` (`content` - the
  tour's `tour.json` objects; `capture-spots` - the recording's photos at
  their capture spots; `ring` - the photos around a code), `basis` (`geo`:
  from geo positions through the zero and the alignment at the scene root;
  `code`: around a locked code's geo), `count`, `zero`, `alignmentMatrix`,
  and per kind `code` (`text`, `geo`, `centerNue`), `join` (`fixes`,
  `gpsAccuracyMedianM`) or `skipped` (content ids that could not render).
- `type TourViewingAction` - any of the three.
- Built with `tour-authoring-actions.ts`'s `logAction` (one helper per
  package), each creator annotated with its `LogActionCreator` type.

## Invariants & assumptions

- **No reducer, on purpose.** Dispatching one changes no state; the recording
  is the only place they exist.
- **The prefix is derived, never typed twice.** The store persists
  `slicePrefixOf(codeLocked.type)` (`tour-viewer-session.ts`).
- **JSON-safe payloads**: tuples, plain records, numbers, strings, null
  (`viewing-log.test.ts` round-trips each through JSON).
- **Dispatched only while a recording runs**, by `viewing-log.ts`: a visitor
  without `?debug=1` and the switch never sees one.
- The raw stream already holds every locked frame (`qrDetected/*`) and every
  vote (`gpsData/recordGpsEvent`); these add what the raw stream cannot say:
  which lock cast which votes, and what a placement was computed against.

## Examples

```ts
store.dispatch(
  votesCast({
    text,
    votedLocks: 3,
    votes,
    alignmentMatrix,
    arVisitIndex: 0,
    atMs: Date.now(),
  }),
);
```

## Tests

`viewing-log.test.ts` (the payloads), `viewer-placement-viewing-log.test.ts`
(dispatched at the viewer pipeline's seams), `authoring-recording.test.ts`
(persisted into a `tour-viewing` recording), the Recorder's
`recording-loader.test.ts` ("a Tour Viewer viewing recording"), and end to end
`playwright-tests/ar-mode.spec.js` ("a visitor records only with ?debug=1 ...").
