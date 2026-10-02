# qr-level-zip-contributor.ts

## Purpose

One-line: write each fixed QR code's minted anchor into the recording zip as
`qr/<id>.json`, and report what happened to the ones it refused.

Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-D (DEC-1).

## Public API

- `QrAnchorOutcome` — what happened to one code, for the summary screen.
- `createQrLevelZipContributor(deps): ZipExportContributor`
  - `deps.getFeeder()` — the session's sighting fold, `null` when QR
    recording is off.
  - `deps.allowedHosts` — hosts whose codes we own.
  - `deps.nowIso()` — injected clock, so a run is reproducible in tests.
  - `deps.onOutcomes?` — receives the per-code verdicts.

## Invariants & assumptions

- **It reads maintained state and nothing else.** The framework calls
  contributors on **every 60-second crash-safety sync**, not only at save; the
  COLMAP contributor's own comment warns that a from-scratch re-parse of
  `actions/` there would be O(session²).
- **It reads the visit in progress without closing it**
  (`sightingsIncludingOpen`, never `flush()`). Under recency weighting the
  newest visit counts MOST, so a recording stopped right after a final scan
  must still include it; and because this runs on every crash-safety sync,
  flushing would split a visit that a sync lands in into two, both near full
  weight.
- **It hands the mint the alignment as it stands at THIS run**, or, for a
  code seen before a tracking restart or loop closure, the alignment its
  odometry segment closed with (`feeder.alignmentFor(segment)`, the segment
  of the code's newest sighting). The mint places every sighting through it,
  so a code scanned as the recording started (seen through an alignment
  with no walk behind it, whose yaw is arbitrary) gets the heading and
  position of the walked alignment. A level written at an early
  crash-safety sync can therefore differ from the one written at save even
  when no new sighting came in; the save is what the delivered zip carries.
- **Foreign codes are never minted.** Without that gate the recorder would
  write a real latitude and longitude for every WiFi sticker, menu code and
  parcel label the camera saw, into a zip the author then publishes. It is the
  same predicate that gates the network path — one rule, two call sites.
- **It returns the count of files WRITTEN**, so the framework's own file
  total stays accurate, and `0` for an empty source as the contract requires.
- **The file name comes from `qrLevelFileName`**, not from string
  concatenation here: the framework prepends the subdir, and a writer that
  built the name itself is how the two halves of the convention drift.
- **A refusal is reported, never swallowed.** In the zip, a declined code and
  a code that was never seen look identical — no file. The outcome list is
  what makes "your poster moved" visible.

## Examples

```ts
createQrLevelZipContributor({
  getFeeder: () => arSessionResources.qrSightingFeeder,
  allowedHosts: QR_LAUNCH_HOSTS,
  nowIso: () => new Date().toISOString(),
  onOutcomes: (outcomes) => {
    latestQrAnchorOutcomes = outcomes;
  },
});
```

## Tests

`qr-level-zip-contributor.test.ts` — the owned subdir; a session with QR off
contributing 0 without throwing; one level per fixed code named by its
identity, with the name RELATIVE to the subdir; the visit in progress
included in the mint (a single open burst still produces a file); a foreign code
refused with a plain-words reason; a moved code refused; and both the written
position and the unweighted comparison reported; and a code seen through a
quarter-turned alignment written with the heading of the alignment at save;
and a code seen at the start followed by a tracking restart, written
through the alignment its segment closed with (with a real feeder).

The suite creates a store at module load — the documented licence-activation
path, and what production does at boot before any recording can be saved.
