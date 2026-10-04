# `recording/zip-contributors.ts`

## Purpose

Builds the list of contributors every session ZIP is assembled from: reference
points, the QR anchor level, and the COLMAP reconstruction tree.

## Public API

- `buildZipContributors(runtime, deps): ZipExportContributor[]`
  - `runtime` — a `SessionRuntime`. Read for `currentSessionName`; **written**
    for `latestQrAnchorOutcomes` (see below).
  - `deps` — anything satisfying `ZipContributorDeps`.
- `ZipContributorDeps` — the narrow slice of `RecordingSessionDeps` this needs:
  `getStore`, `getQrSightingFeeder`, `getRecordingOptions`.

## Invariants & assumptions

- **It WRITES `runtime.latestQrAnchorOutcomes`**, through the QR contributor's
  `onOutcomes` callback. That is why it takes `runtime` rather than being a pure
  function of `deps`: the summary screen shows what each code was decided to be,
  including the refusals, which are invisible in the zip itself.
- **Its own module because it has TWO callers, far apart in the lifecycle**: the
  crash-safety sync armed in `handleStartRecording`, and the final export in
  `performStop`. Living in either would have made the other import it for a
  reason that reads like an accident.
- **The COLMAP contributor reads live state, never a re-parse of `actions/`** —
  poses via `selectFrameTilesInWebXR`, the session-constant `projectionMatrix`
  from the latest depth sample, and the shared occupancy grid. A from-scratch
  re-parse would be O(session²) over a recording, and this runs on **every**
  crash-safety sync rather than only at save.
- **`getMinConfidence` is read live**, per call, so a changed setting applies to
  the next sync or export — it keeps phantom behind-surface points out of the
  reconstruction.
- **A NARROW deps interface, not the whole bag.** Three of
  `RecordingSessionDeps`'s sixteen members. It documents what this actually
  depends on, and it keeps this module from importing
  `recording-session-handlers.ts`, which imports this one. A type-only cycle
  would survive `check:cycles` — dpdm runs with `-T`, so type imports are erased
  before the graph is built — and still be a real tangle.
  `RecordingSessionDeps` satisfies it structurally, so callers pass `deps`
  unchanged.

## Examples

```ts
const result = await exportScenarioSessionAsZip(scenarioName, sessionName, {
  contributors: buildZipContributors(runtime, deps),
});
```

## Tests

No direct tests. Its behaviour is covered through both call paths by
`recording-session-handlers.test.ts` (85 tests, none edited when this module was
extracted) and by the contributors' own suites —
`ref-points-zip-contributor`, `qr-level-zip-contributor` and
`colmap-zip-contributor` each test what they emit.

Worth knowing if you add a test here: the `onOutcomes` write into `runtime` is
the one piece of behaviour that is this module's rather than a contributor's, so
it is the thing a direct test should pin.
