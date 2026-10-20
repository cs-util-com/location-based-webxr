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

## Invariants & assumptions

- **The hand moves with the document's code actions**, one dispatch for
  both slices: `codeTaken` (the hand and its measurement, also an empty
  hand), `codeTakenFromDraft` (the hand), `codeLetGo` (both null),
  `codeSaved` and `codesRestored` (the hand their payload names),
  `codesForgotten` (both null). The document reducer reads the same
  payload's hand for its "the hand's text wins" rule, so the two slices
  can never disagree about the hand after an action.
- **What is cleared when:** a visit's end (`visitEnded`) clears only the
  sightings; a tour's close (`codesForgotten`) only the hand and its
  measurement - a tour cannot close inside a visit, so the sightings are
  left to the visit's end, as before the move.
- No history, no draft write, not persisted into the troubleshooting
  recording (not among `persistedExtraPrefixes`).
- Only `creator-codes.ts` dispatches these actions and reads the slice.
- Serializable state (arrays and plain objects), as the store's dev checks
  require.

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
  against the module as it was before the move, for any sequence of calls.
