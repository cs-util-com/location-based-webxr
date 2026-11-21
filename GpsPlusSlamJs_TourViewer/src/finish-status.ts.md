# finish-status.ts

## Purpose

The phone's Finish as the tour document's save status says it. Pure
selectors over `TourDocumentState` (the shared `tourDocument` slice,
`tour-document.ts`); every reader of the Finish's state (the panel in
`creator-setup.ts`, the AR button and Done in `ar-entry.ts`, the
measuring, placement and object editing) reads through them, through
`ctx.tourDocument.state()`.

## Public API

- `finishRunning(state): boolean` - `save.by !== null`: the Finish holds
  the page's save slot. The phone has no other holder.
- `finishProgressLine(state): string` - `save.progress` as the panel's
  line (`FINISH_LABELS.reading(bytes)`, then
  `FINISH_LABELS.rebuilding(done, total)`); `""` while there is none.
- `finishErrorLine(state): string | null` -
  `FINISH_LABELS.failed(save.error)`, or null while no failure stands.
- `finishFailed(state): boolean` - `save.error !== null`: a failure
  stands (the AR button's "Close AR", Done refused, the leave guard).
- `createProgressGate(): (done, total) => boolean` - one per Finish:
  true only when the rebuild's whole percent changes, so at most 101
  rebuilding dispatches per Finish (0 % to 100 %), the last report
  (`done === total`) always let through. It exists because Redux calls
  every store subscriber on every dispatch; the reducer dropping a repeat
  keeps the state object but saves no wake-up. A total of 0 or less reads
  as 100 %.
- `finishWaitsForMeasurement(state): boolean` - `save.finishWaits`: Done
  was tapped while a code was measured, and the Finish starts once the
  measurement lands.

## Invariants & assumptions

- The fields are written only through the page's document handle
  (`creator-document.ts`: `finishClaimed`, `finishProgressed`,
  `finishReleased`, `finishWaits`), which `creator-finish.ts` and
  `creator-setup.ts` call.
- A failure stands until the next Finish claims the slot (the claim
  clears it) or the tour closes (`opened` and `closed` reset it). The
  phone dispatches no `saveDelivered`, whose reset of the error would let
  a failed Finish's own hand-over of its zip clear its failure.
- The slot and its progress survive a tour closed under a running Finish
  (`slotKept`), so the panel keeps saying it runs until it ends.
- No validation here: the reducers keep the fields well formed.

## Examples

```ts
const state = ctx.tourDocument.state();
if (finishRunning(state)) status.textContent = finishProgressLine(state);
else status.textContent = finishErrorLine(state) ?? readout;
```

## Tests

- `finish-status.test.ts`: each selector over states the reducers make;
  the progress gate lets exactly 101 reports through for 1,000 entries.
- `tour-document-save-status.property.test.ts`: the fields themselves
  under any mix of save actions.
- `creator-finish.test.ts` ("the Finish's status on the panel"): the
  panel through a whole Finish, a failure after the zip was handed over
  (no retry while nothing is left to write),
  and a tour closed mid-Finish.
