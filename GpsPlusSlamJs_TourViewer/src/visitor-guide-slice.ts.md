# visitor-guide-slice.ts

## Purpose

The visitor's guide state in the page's store (visitor plan
`GpsPlusSlamJs_Docs/docs/2026-10-18-2349-visitor-station-content-at-radius-plan.md`
§3 "State in Redux", cold review MEDIUM-4; root `CLAUDE.md`, the Redux rule):
the one station whose content shows and the "show all stations' content"
override. The reducer applies the pure presence rule (`station-presence.ts`);
the station guide dispatches a judged position only when the answer changes.

## Public API

- `visitorGuideReducer` - mounted as `visitorGuide` by
  `createTourViewerStore` (`tour-viewer-session.ts`).
- `type VisitorGuideState` - `{ presentStationId: string | null;
showAllContent: boolean }`, both null/false at the start.
- Actions:
  - `presenceJudged({ candidates, accuracyM })` - a judged position
    (`type PresenceJudgement`): `presentStationId` becomes
    `nextPresentStation(present, candidates, takeoverMarginM(accuracyM))`;
    null candidates hold;
  - `presenceCleared()` - the AR session ended;
  - `guideTourChanged()` - another tour (or none): back to the initial
    state, "show all" off (§3: not kept across tours);
  - `showAllContentSet(on)` - the switch (its UI and URL flag come with M2).
- `presenceAfter(state, judgement)` - the reducer's rule, for the guide's
  dispatch-on-change check (one rule, never restated).
- Selectors: `selectPresentStationId`, `selectShowAllContent`,
  `selectStationContentShown(state, stationId)` (present, or all are).
- `interface VisitorGuideStore` - what the guide needs of the store
  (`getState`, `dispatch`).

## Invariants & assumptions

- Plain data only: candidates are `{ id, distanceM, foundM, foundExitM }`.
  three.js groups and textures per station live in a side table keyed by
  station id (M2), never here.
- Not persisted: `visitorGuide/*` is not among the page's persisted
  prefixes, so the guide's dispatch from inside the store's subscriber
  cannot reorder a recording (lessons-learned: never dispatch a persisted
  action from `store.subscribe`).
- The guide dispatches at the end of its tick; the re-entered tick finds
  nothing to change.

## Examples

```ts
store.dispatch(presenceJudged({ candidates, accuracyM: null }));
selectStationContentShown(store.getState(), "s2");
```

## Tests

- `visitor-guide-slice.test.ts` - the page's store carries the slice; the
  rule with the margin of the judged accuracy; hold and clear; "show all"
  and the tour change.
- `station-guide.test.ts` ("the present station") - the guide's dispatches.
