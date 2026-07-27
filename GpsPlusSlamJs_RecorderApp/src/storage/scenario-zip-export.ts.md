# scenario-zip-export.ts

## Purpose

Resolves the recorder's `scenarios/{name}/{session}/` OPFS layout to a session
directory handle and hands it to the framework's layout-agnostic
`exportSessionHandleAsZip`. **The framework owns the ZIP schema**
(`session.json` / `actions/` / `images/` + extension contributors); this module
owns only the scenario path resolution and the external-file write.

Carved out of the framework's `storage/zip-export.ts` scenario branch in Iter 7C
of the AppFramework/RecorderApp boundary migration, so the framework no longer
knows what a "scenario" is. See
[boundary analysis](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).

## Public API

- `exportScenarioSessionAsZip(scenarioName, sessionName, options?): Promise<ZipExportResult>`
  - Resolves the session handle, then delegates to the framework exporter.
  - **Throws** `Scenario "X" not found in OPFS storage` or `Session "Y" not found in scenario "X"` — deliberately layer-specific messages, not the raw `NotFoundError`.
- `syncScenarioSessionToExternalZip(fileHandle, scenarioName, sessionName, options?): Promise<ZipExportResult>`
  - Same export, then writes the blob to an external `FileSystemFileHandle`. Used for the periodic crash-safety sync during recording and the final sync at stop.
  - **Throws** the resolution errors above, or the underlying write error.

`ExportSessionAsZipOptions` / `ZipExportResult` are the framework's types, passed
through unchanged.

## Invariants & assumptions

- **Handles are re-acquired from `navigator.storage` on every call**, never cached — a stored handle can go stale across sessions/tabs.
- **The external write goes through `writeFileOrAbort`** (`gps-plus-slam-app-framework/storage/write-file-or-abort`), so a failed write aborts the temp instead of committing a partial ZIP over the user's previous export, and never leaks the handle's lock. Until 2026-07-27 this was a bare `createWritable`/`write`/`close` with **no abort guard at all** — the one drifted copy of a pattern that was correct in its three siblings.
- The periodic sync overwrites the same external file repeatedly, so a partial commit here would destroy the last good crash-safety copy. That is what makes the abort guard load-bearing rather than cosmetic.
- OPFS-only on the read side: the source session must live under `gps-plus-slam/scenarios/`.

## Examples

```ts
// One-off export to a blob (e.g. for a download link)
const { blob } = await exportScenarioSessionAsZip('parking-lot', 'session-3');

// Crash-safety sync to a user-picked file, called periodically while recording
await syncScenarioSessionToExternalZip(
  externalFileHandle,
  'parking-lot',
  'session-3'
);
```

## Tests

`scenario-zip-export.test.ts` — covers scenario/session resolution against a
mocked OPFS tree, both layer-specific error messages, delegation to the
framework exporter with the passed-through options, and the external-file sync
path.

The write lifecycle itself is covered where it lives, in the framework's
`write-file-or-abort.test.ts`.
