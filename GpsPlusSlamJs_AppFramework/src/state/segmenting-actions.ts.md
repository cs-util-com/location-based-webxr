# segmenting-actions.ts

## Purpose

One-line: name the actions whose presence in a recording means the **odometry
frame moved**.

A tracking restart wipes the frame; a loop closure deforms the stored
trajectory. Either way, anything recorded in raw WebXR/odometry space — a
captured photo's pose, a QR code's solved pose — keeps its old coordinates
while the frame it was measured in has changed underneath it. Comparing or
averaging across that boundary yields a plausible-looking answer that is
simply wrong.

## Public API

- `SEGMENTING_ACTION_TYPES: readonly string[]`
- `isSegmentingActionType(type: string): boolean`

## Invariants & assumptions

- **One list, because two consumers depend on it** and they must agree: the
  tour viewer's capture-time geo join (which **declines** such a recording)
  and the recorder's QR sighting fold (which **segments** at the boundary). A
  copy that drifted would let one silently accept what the other refuses.
- It lists action TYPE strings rather than importing the action creators,
  because one consumer scans a recorded action stream where only the type
  survives.

## Tests

`segmenting-actions.test.ts` — the list's contents, and that the predicate
accepts exactly those types and rejects ordinary ones.
