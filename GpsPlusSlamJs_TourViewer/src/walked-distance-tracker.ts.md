# walked-distance-tracker.ts

## Purpose

One-line: how far the author has walked in the running visit so far - the
odometry path length over the store's device fixes - folded incrementally
as the GPS list grows (review R1 and R3 of D33, authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§7p).

Why: SLAM drift grows with the distance walked, not with time. The settle
(`visit-settle.ts`) therefore measures "a note near a code event of this
visit" (R1) and "the sighting nearest a note" (R3) in walked metres; the
per-visit tracker (`visit-alignment-picks.ts`) stamps every event with this
number.

## Public API

- `createWalkedDistanceTracker(): WalkedDistanceTracker`
- `tracker.update({ gpsPositions, odometryPositions }): number` - the path
  length (m), folding only the fixes added since the last call.
  - `gpsPositions`: `selectGpsPositions`; `odometryPositions`:
    `selectOdometryPositions`, paired index for index (the store keeps them
    so).

## Invariants & assumptions

- **Device fixes only, through `deviceSamples`** (`visit-log.ts`), the one
  device-only filter of the store's history (DEC-H3): a synthetic code vote
  or an unknown source is skipped, and the step bridges the device fixes on
  either side.
- **Horizontal** (odometry north and east, indices 0 and 2); height is no
  walk.
- **Out-and-back counts in full**; it is a path length, not a displacement.
- **A new walk starts from 0** when the list is shorter than the last one or
  its first fix is another object (a store reset at a new AR entry; the
  store keeps the head's reference while appending).
- **Defensive:** a fix whose odometry does not read, or unpaired lists, adds
  no step; nothing throws.
- **Resolution:** one step per GPS fix (about 1 Hz, about 1.2 m at walking
  pace); an event between two fixes reads the earlier fix's length.
- **No odometry segments.** A tracking restart or loop closure would jump
  the odometry and add a spurious step; the Tour Viewer dispatches neither
  (`visit-alignment-picks.ts.md`, R8).

## Examples

```ts
const walked = createWalkedDistanceTracker();
const m = walked.update({
  gpsPositions: selectGpsPositions(state),
  odometryPositions: selectOdometryPositions(state),
});
```

## Tests

- `walked-distance-tracker.test.ts` - horizontal sum, out-and-back, votes
  and unknown sources skipped, incremental fold, a new list from scratch, an
  unreadable odometry bridged.
- `walked-distance-tracker.property.test.ts` - equals the from-scratch path
  length after every growing prefix.
