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
- **It flushes the accumulator first.** The visit in progress is not closed
  yet, and under recency weighting it is the one that counts MOST — stopping a
  recording right after a final scan would otherwise discard the best evidence
  in the session.
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
identity, with the name RELATIVE to the subdir; the visit in progress closed
before minting (a single open burst still produces a file); a foreign code
refused with a plain-words reason; a moved code refused; and both the written
position and the unweighted comparison reported.

The suite creates a store at module load — the documented licence-activation
path, and what production does at boot before any recording can be saved.
