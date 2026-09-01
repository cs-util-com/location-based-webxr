# qr-status-line.ts

## Purpose

One-line: the recorder's QR readout — whether a code is being seen, how many
times it has been visited, and how big the app thinks it is.

Until this existed the recorder showed **nothing** for QR: the detection
producer was built without a status callback and no QR string reached the HUD,
so the only feedback was a 3D cube that appears once a size has converged. A
field session where the detector never fired looked exactly like one where it
did, and the difference surfaced only at analysis time. The size it reports is
also the number an author checks against a tape measure (plan DEC-5).

## Public API

- `qrStatusLine(input): string | null` — one HUD line, or `null` when QR
  detection is off.
  - `input.enabled`, `input.latestText`, `input.latestId?`,
    `input.accumulator`.

## Invariants & assumptions

- **`null` means no row at all**, not a row saying "off". The HUD has to stay
  readable at arm's length outdoors; a permanent inert row is noise.
- **The visit in progress is counted.** The burst being looked at right now is
  not closed in the accumulator yet, so the count is `closed + 1` — reporting
  "0 visits" while staring at a code would read as a failure.
- **The turn between visits only appears once there is something to compare**
  (more than one closed sighting).
- **A tracking restart is called out in plain words**, because sightings
  either side of one are in different odometry frames and cannot be compared —
  saying so lets the author restart the recording instead of finishing a walk
  whose evidence will be declined.
- **The id may not be resolved yet** (deriving it is async): the line falls
  back to a neutral label rather than printing `undefined`.
- Plain language on purpose — read while standing at a wall, not at a desk.

## Examples

```ts
setQrStatus(
  qrStatusLine({
    enabled: true,
    latestText,
    latestId,
    accumulator: feeder.accumulator,
  })
);
```

## Tests

`qr-status-line.test.ts` — no row when disabled; the scanning state; the visit
in progress counted rather than reported as zero; the size readout; the turn
appearing only with visits to compare; the tracking-restart warning; and the
unresolved-id fallback never printing `undefined`.
