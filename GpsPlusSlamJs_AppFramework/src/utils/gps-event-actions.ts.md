# gps-event-actions.ts

## Purpose

The one place that knows both of the core's GPS actions (core 1.26):
`gpsData/recordGpsEvent` carries one observation, `gpsData/recordGpsEventBatch`
carries several that the store solves once (the Tour Viewer's code votes and
keep-alive ticks, authoring plan
[2026-09-28-0953](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
D18). Every reader of a recording that wants "the GPS events" goes through
it, so a fix inside a batch never vanishes from a reader (the M2e/M2f
milestone review #5 found three readers that knew only the single action).

## Public API

- `recordedGpsEventPayloads(action: unknown): readonly unknown[]` - the GPS
  event payloads `action` carries, in recorded order: `[payload]` for a
  `recordGpsEvent`, the batch's `events` for a `recordGpsEventBatch`, `[]`
  for anything else (another type, no payload, a batch without an `events`
  array, a non-object). A sparse batch yields its present entries. Never
  throws.
- `GPS_EVENT_ACTION_TYPES` - the two action types, for a reader that needs
  the TYPE rather than the events (the Recorder's timing page times one
  dispatch, i.e. one solve, of either).

## Invariants & assumptions

- **Entries are not validated.** Each reader checks the fields it reads, as
  it did for the single action, so its handling of a malformed fix is
  unchanged - now per event. (The core itself drops a malformed event of a
  batch alone, with a warning; a reader skipping it alone matches that.)
- **Equivalence:** a batch of n events reads as the n single actions it
  replaces (property-tested). What a reader collects from one-by-one
  dispatches it collects from the batch; what differs is only what depends
  on the NUMBER of solves (one per batch), which no reader here derives from
  the action list.
- Deep-imported (`gps-plus-slam-app-framework/utils/gps-event-actions`),
  never through the `/utils` barrel (DEC-H3).

## Users

- `state/replay-engine.ts` - replay pacing (`extractActionTimestamp`).
- `storage/zip-reader.ts` - the track preview (`loadGpsPathFromBlob`).
- The Tour Viewer's `recording-folders.ts` (`recordedFixes`, the session
  record's coverage) and the Recorder's timing page
  (`alignment-timing-run.ts`).
- `state/tracking-quality.ts` matches the batch by its type in its own
  input-action table (it reacts to the solve, not to the events).

## Examples

```ts
for (const event of recordedGpsEventPayloads(action)) {
  const point = (event as { rawGpsPoint?: { latitude?: unknown } }).rawGpsPoint;
  if (typeof point?.latitude === 'number') track.push(point.latitude);
}
```

## Tests

`gps-event-actions.test.ts` - the single action, a batch in order, every
non-GPS or malformed shape as `[]`, a sparse batch, and the property that a
batch of n reads as its n single actions.
