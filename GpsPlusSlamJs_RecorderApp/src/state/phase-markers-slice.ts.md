# `phase-markers-slice.ts`

## Purpose

Recorder slice for **phase markers**: numbered, timestamped annotations a walker drops into a recording with one tap of the "🏁 Phase" button, so the offline analysis of a test-protocol walk (walk to an object, hold, step to 1/2/4 m, circle it, view a flat picture at an angle...) reads the phases from the recording instead of guessing them from the pose track.

A marker is NOT a reference point. It carries no GPS fix and no pose, and nothing in alignment, fusion or the core library reads it. The persisted action is the record; the state only numbers the next tap and feeds the summary count.

## Recorded action (the zip format)

Each tap is persisted as one file in the session's `actions/`:

```json
{
  "type": "phaseMarkers/phaseMarked",
  "payload": { "number": 3, "timestamp": 1764000000000 }
}
```

- `number`: running integer from 1 within the recording.
- `timestamp`: epoch ms of the tap, the same domain as every other recorded action (GPS events, reference points, diagnostics notes).

Readers that do not know the type ignore it: RTK slices ignore unmatched types, the framework replay engine paces it as "no timestamp" (like `refPoints/addRefPointEntry`), and the core library never sees recorder slices.

## Public API

- `PhaseMarker`: `{ number, timestamp }`.
- `PhaseMarkersState`: `{ markers: PhaseMarker[] }`, mounted at `state.phaseMarkers` by [recorder-store.ts](recorder-store.ts.md).
- `phaseMarked(marker)`: action creator, type `phaseMarkers/phaseMarked`.
- `phaseMarkersReducer`.
- `selectPhaseMarkers(state)`: markers in recording order; a stable empty array when the slice is missing.
- `selectPhaseMarkerCount(state)`.
- `selectNextPhaseMarkerNumber(state)`: last number + 1, or 1.

## Invariants and defensive measures

- Numbers are integers >= 1 and strictly increasing; timestamps are finite and >= 0. Any other `phaseMarked` (a duplicate, a lower number, a malformed action read from a zip, a missing payload) is ignored, never thrown, so a replay cannot stop on it.
- The number travels in the payload (the handler reads `selectNextPhaseMarkerNumber` before dispatching), because the persisted action, not the state, is what offline readers see.
- No reset action: each recording and each replay gets a fresh store.

## Tests

- [phase-markers-slice.test.ts](phase-markers-slice.test.ts): action type, append, every rejected payload, missing slice.
- [phase-marker-handler.property.test.ts](../recording/phase-marker-handler.property.test.ts): numbers strictly increasing for any tap sequence, and the markers survive a serialise-and-replay round trip.
- [phase-marker-handler.test.ts](../recording/phase-marker-handler.test.ts): the real OPFS write, zip export and zip read round trip.
