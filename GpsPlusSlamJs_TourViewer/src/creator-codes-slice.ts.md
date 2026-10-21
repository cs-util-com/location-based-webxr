# creator-codes-slice.ts

## Purpose

The `creatorCodes` slice of the page's store (debug-captures plan
`GpsPlusSlamJs_Docs/docs/2026-10-20-1159-debug-captures-and-codes-in-store-plan.md`,
M3a): the creator's code state that belongs to the page or to the running
AR visit, never to the tour - the code in hand, its fresh measurement, the
visit's sighting of it and the visit's latest sighting of every stored
code. The tour's codes (their texts, the measurement per code, what a
Finish wrote) are the tour document's (`tour-document.ts`, `codes`).

## Public API

- `CreatorCodesState` - `hand`, `handMeasurement`, `visitSighting`,
  `storedSightings` (`{ levelId, seen: { visit, sighting } }[]`, in the
  order the codes were first sighted; a code sighted again keeps its
  place, one forgotten and sighted again goes last).
- `creatorCodesReducer` (mounted by
  `createTourViewerStore` as `creatorCodes`), `selectCreatorCodes(root)`.
- `creatorCodesActions`: `sightingSeen(sighting)`,
  `sightingsForgotten({ levelId })`, `storedCodeSighted({ levelId, visit,
sighting })`, `visitEnded()`.
- `StoredSighting` - `{ visit, sighting }`.
- `onlyCreatorCodesChanged(before, after): boolean` - true when the
  `creatorCodes` slice is a new object and every other root slice is the
  same object (same set of keys); false for an unchanged state. The
  page's store subscribers (`creator-setup.ts`'s readout, `ar-entry.ts`'s
  visitor placement) skip such a dispatch: the sightings arrive about once
  per stable QR frame, and these subscribers do not read them.

## Invariants & assumptions

- **The hand moves with the document's code actions**, one dispatch for
  both slices: `codeTaken` (the hand and its measurement, also an empty
  hand), `codeTakenFromDraft` (the hand), `codeLetGo` (both null),
  `codeSaved`, `codesRestored` and `settleApplied` (the hand their
  payload names), `codesForgotten` (both null), `handReleased` (both
  null when the hand holds one of its codes: an undo took that code's
  saved text back, plan M3b). The document reducer reads the same
  payload's hand for its "the hand's text wins" rule, so the two slices
  can never disagree about the hand after an action.
- **What is cleared when:** a visit's end (`visitEnded`) clears only the
  sightings; a tour's close (`codesForgotten`) only the hand and its
  measurement - a tour cannot close inside a visit, so the sightings are
  left to the visit's end, as before the move.
- No history, no draft write, not persisted into the troubleshooting
  recording (not among `persistedExtraPrefixes`).
- Only `creator-codes.ts` dispatches these actions and reads the slice's
  data for the page; `creator-setup.ts` compares three of its fields by
  identity to decide whether its readout must re-render (see there).
- Serializable state (arrays and plain objects), as the store's dev checks
  require.
- **Everything that enters the store is deep-frozen** (Immer, inside
  `createSlice`), the payloads' objects included: a sighting and its
  `odomPose`, a measurement, a level text. A caller must not mutate an
  object after handing it to an action, nor one it read back (the facade
  returns the stored objects themselves); a pose to change is copied
  first. In place, the write throws in strict mode - every ES module is.
  No such caller exists today; `creator-codes-slice.test.ts` pins the
  freeze.

## Examples

```ts
store.dispatch(
  creatorCodesActions.storedCodeSighted({ levelId, visit, sighting }),
);
selectCreatorCodes(store.getState()).storedSightings;
```

## Tests

- `creator-codes.test.ts` - the characterization tests of the resets and
  the sightings, through the facade.
- `creator-codes-store.property.test.ts` - every observable of the facade
  against the module as it was before the move, for any sequence of calls
  (the tour document's opens, closes and undos, and late answers of older
  opens, among them).
- `creator-codes-slice.test.ts` - `onlyCreatorCodesChanged` over every
  subset of changed slices (property), an unchanged state, a slice added;
  and the freeze of what enters the slice (a sighting, its pose, the
  caller's own object).
  Its callers: `creator-setup.test.ts` ("the readout and a dispatch that
  changed only the creator's code state") and `ar-entry.test.ts` ("a
  dispatch that changed only the creator's code state places nothing").
