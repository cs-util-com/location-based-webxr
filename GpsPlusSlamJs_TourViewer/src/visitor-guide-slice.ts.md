# visitor-guide-slice.ts

## Purpose

The visitor's guide state in the page's store (visitor plan
`GpsPlusSlamJs_Docs/docs/2026-10-18-2349-visitor-station-content-at-radius-plan.md`
§3 "State in Redux", cold review MEDIUM-4; root `CLAUDE.md`, the Redux rule):
the one station whose content shows, the "show all stations' content"
override, and whether the guide waits for a heading (`headingPending`, D34 of
the tour editor plan 2026-10-17-1816: the visitor's status line then asks for
a few steps). The reducer applies the pure presence rule
(`station-presence.ts`); the station guide dispatches a judged position only
when the answer changes.

## Public API

- `visitorGuideReducer` - mounted as `visitorGuide` by
  `createTourViewerStore` (`tour-viewer-session.ts`).
- `type VisitorGuideState` - `{ presentStationId: string | null;
showAllContent: boolean; headingPending: boolean }`, null/false/false at
  the start.
- Actions:
  - `presenceJudged({ candidates, accuracyM, codeLinedUp })` - a judged
    position (`type PresenceJudgement`; `accuracyM` is the judged accuracy,
    null for a code's position). `presentStationId` becomes:
    - above the accuracy ceiling (`tooWeakToGuide`):
      `presentAfterWeakFix(present, candidates, accuracyM)` - the exit only,
      never an entry or a takeover (PR review S1);
    - otherwise `nextPresentStation(present, candidates,
takeoverMarginM(accuracyM, codeLinedUp))`;
    - null candidates hold.
  - `presenceCleared()` - the AR session ended, or a code's station lost
    its code with nothing else to judge by (`station-guide.ts`);
  - `guideTourChanged()` - another tour (or none): back to the initial
    state, "show all" off (§3: not kept across tours);
  - `showAllContentSet(on)` - the switch. Its URL flag `?allstations=1`
    sets it at page start (`main.ts`); a visible control is an open
    question (it would put a control on the visitor's page);
  - `headingPendingSet(pending)` - the guide waits for a heading (D34);
    `guideTourChanged` resets it with the rest.
- `presenceAfter(state, judgement)` - the reducer's rule, for the guide's
  dispatch-on-change check (one rule, never restated).
- Selectors: `selectPresentStationId`, `selectShowAllContent`,
  `selectStationContentShown(state, stationId)` (present, or all are),
  `selectHeadingPending`.
- `showAllStationsFromSearch(search)` - whether the page's query asks for
  every station's content (`allstations=1` exactly).
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
store.dispatch(
  presenceJudged({ candidates, accuracyM: null, codeLinedUp: true }),
);
selectStationContentShown(store.getState(), "s2");
```

## Tests

- `visitor-guide-slice.test.ts` - the page's store carries the slice; the
  rule with the margin of the judged accuracy; a fix too weak to guide by
  only ends presence; hold and clear; "show all" and the tour change; the
  heading wait; the URL flag (only `1` counts).
- `station-guide.test.ts` ("the present station") - the guide's dispatches.
