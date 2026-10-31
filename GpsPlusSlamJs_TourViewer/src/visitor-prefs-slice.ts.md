# visitor-prefs-slice.ts

## Purpose

The visitor's view preference in the page's store: the value read from
the device at the page's start, and every choice made since. The renderer
(`viewer-placement.ts`) and the switch (`view-switch.ts`) read it here.

## Public API

- `visitorPrefsReducer` - mounted as `visitorPrefs` by
  `createTourViewerStore`.
- `visitorPrefsLoaded(value)` - the value read from the device (any
  shape, or null): `loadVisitorPrefs` at the page's start, and after each
  choice the merged value `storeVisitorChoice` returns.
- `visitorViewChosen({ kind, placement, view })` - a choice into the
  store's value alone; `view: null` takes the creator's choice again.
  Built by `withPreferredView`, so another app version's keys survive.
  The page uses `storeVisitorChoice` + `visitorPrefsLoaded` instead, so a
  choice also keeps the keys another tab wrote since the page started.
- `selectVisitorPrefs(state)` - the stored value (read it through
  `preferredView` / `shownView`).

## Invariants & assumptions

- Not recorded (no `visitorPrefs/*` prefix is persisted) and not reset by
  a tour change: the preference is the device's.
- The store, not `localStorage`, is the truth for the visit: a write that
  throws leaves the choice in force until the page closes.

## Examples

```ts
store.dispatch(visitorPrefsLoaded(loadVisitorPrefs(stepStore)));
// A choice: merged into a fresh read, saved, and the merged value stored.
const { value, kept } = storeVisitorChoice(
  stepStore,
  selectVisitorPrefs(store.getState()),
  "longText",
  "world",
  "lectern",
);
store.dispatch(visitorPrefsLoaded(value));
```

## Tests

- `visitor-prefs-slice.test.ts` - load, choose and clear keep other keys;
  another tour keeps the choice.
