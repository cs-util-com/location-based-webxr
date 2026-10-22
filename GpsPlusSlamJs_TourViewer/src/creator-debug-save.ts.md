# `creator-debug-save.ts` - the phone's "Save the debug data"

## Purpose

A Finish leaves the walk out of the tour file by default (debug-captures
plan `GpsPlusSlamJs_Docs/docs/2026-10-20-1159-debug-captures-and-codes-in-store-plan.md`,
M2 step 3, decision E2), and the file the creator puts at the link may be
the only copy they keep. The Done step therefore offers the walk as a file
of its own - the debug bundle (`debug-bundle.ts`) - above the host's
replace steps, behind a button (plan Q-F: a second automatic download may
be blocked outside a tap).

## Public API

- `CreatorDebugSaveDom` - `debugSave` (the block, `#debug-save`),
  `debugSaveText`, `debugSaveButton`, `debugSaveStatus` (a live region).
- `DEBUG_SAVE_LABELS` - the block's line, the button's idle, in-progress
  and after-a-save labels, and the status lines: `saved(filename)`,
  `notSaved` (the download did not start), `failed(reason)`.
- `wireCreatorDebugSave({ ctx, seams, dom }) -> CreatorDebugSave`:
  - `finished({ session, source, leftOut, tour })` - a Finish wrote the
    tour's file: `source` is the bytes it read (`FinishedTour.source`),
    `tour` the bundle's identity (a listed tour's series, the written
    title, the file's name). The block shows when `leftOut` and hides
    when the Finish kept the walk.
  - `reset()` - the tour closed: the block, its status and the kept bytes
    go; a save still running lands nothing.

## Invariants & assumptions

- **The bytes of the FIRST Finish of an open tour are kept**, never read
  again: a later Finish rebuilds from the previous Finish's file, which may
  lack the walk, and a tour opened from a link reads its cache or its URL,
  which after a replace on Drive is another file (plan M2 step 3).
  Kept until the tour closes (`creator-setup.ts` `resetFinishStep`);
  memory: one reference to a blob the page already held.
- The tour's bytes are untrusted: the bundle inflates them under the open
  session's budget.
- The async-UI rule: "Saving the debug data…" and disabled while the
  bundle is built and handed over (`seams.downloadZip`, the tour's own
  path); then where it went ("Save the debug data again") or why not, with
  the button back. A second tap while it runs starts nothing.
- A save that settles after the tour closed (`reset`, or a new
  `openGeneration`) writes nothing on screen.

## Examples

```ts
const debugSave = wireCreatorDebugSave({ ctx, seams, dom });
debugSave.finished({ session, source, leftOut: true, tour });
// the creator taps "Save the debug data": castle-debug.zip is handed over
```

## Tests

- `creator-debug-save.test.ts` - offered only after a Finish that left
  the walk out, and gone with the tour; the bundle of the first Finish's
  bytes under the tour's name, the newest title in its identity; the busy,
  saved, not-saved and failed states; a source without a recording; a
  tour closed while it was built.
- `creator-finish.test.ts` - composed through `wireCreatorSetup`: the
  Finish's saved file leaves the walk out, the tap hands over the bundle
  built from the bytes the Finish read, and the tour is read once.
- `playwright-tests/creator-stations.spec.js` - a recording tour's
  Finish, the block above the replace steps, and the downloaded bundle.
