# editor/view3d-failed-page.ts

## Purpose

The page the desktop editor shows where its 3D view cannot open: no
WebGL, its code not loaded, its graphics lost, or an error that stopped
it. The 3D view is the editor and the 2D map no longer stands in for it,
so this says plainly what happened and keeps the tour's File actions
within reach, so no work is stranded.

## Public API

- `VIEW3D_FAILED_PAGE.title` - "The 3D view cannot open" (the heading in
  `edit.html`).
- `failedPageReason(view)` - the `View3dFailure` the page shows for the
  store's `editorView` (`viewMode`, `view3dLoad`, `view3dFailure`), or
  `null`: only while the load has `failed` with a reason other than
  `empty`.
- `wireView3dFailedPage({ dom, covered, store, actions })` ->
  `{ dispose() }`:
  - `dom` - `View3dFailedPageDom` (structural): the root (`hidden`), the
    heading (`focus()`), the reason line (`textContent`) and the five
    buttons: `retry` (its label written too), `open`, `save`,
    `saveCopy`, `details`.
  - `covered` - what the page covers (the map, the rail, the card, the
    debug panel): made `inert` while it shows. The 3D view's own
    hand-back (`onShown(false)` in `edit-main.ts`) runs after this
    page's render when a shown view stops, so it keeps the map inert itself
    while a failure stands.
  - `store` - `getState().editorView` and `subscribe`.
  - `actions` - one per button (the page passes `viewSwitch.show3d`,
    File's Open… with its unsaved-work guard, Save, Save a copy…, Tour
    details…), plus `reload`: for `chunk` (code that did not load) the
    first button reads "Reload the page" and runs it, since the browser
    keeps a failed import's answer for the page's life and trying again in
    place cannot succeed. The page's `reload` asks first when work is
    unsaved, then holds back the browser's own leave prompt.
  - `VIEW3D_FAILED_PAGE` - its title and the first button's two labels.
  - `dispose()` stops following the store.

## Invariants & assumptions

- Driven by the store alone: shown while a load has failed, hidden again
  by a retry (`loading`), a shown view, or a tour closed or opened
  (`view2dRequested`).
- An `empty` tour never brings it up: only the temporary older view
  (`globe=0`) refuses one, and the map shows such a tour.
- The words are `view3dFailureText` (`view-switch.ts`); none speaks of the
  map.
- The heading takes the focus once, when the page shows, so a screen
  reader reads it; `covered` is written only when the page shows or goes,
  never while it stays hidden (the 3D view keeps the map inert itself
  while it shows, and the store changes on every edit).
- In `edit.html` the page sits under the top bar (whose File and View
  menus stay usable), over the map, the rail and the card, and under the
  dialogs and the toasts (`#view3d-failed` in `editor.css`).

## Examples

```ts
wireView3dFailedPage({
  dom,
  covered: [mapBox, rail, card],
  store,
  actions: { retry: () => viewSwitch.show3d(), open, save, saveCopy, details },
});
```

## Tests

- `view3d-failed-page.test.ts` - when it shows (each failure, not
  `empty`, not idle, loading or shown), its reason, the heading's focus,
  shown at once for a load already failed, `covered` inert only while it
  shows, each button's action, dispose; no failure's words speak of the
  map.
- `playwright-tests/editor3d-globe-default.spec.js` - with WebGL refused
  and with the view's code aborted: the page at 390x844, 844x390 and
  1440x900, every button in the window, Save a copy… downloading the
  tour, Try again, Tour details… and Open another tour….
- `playwright-tests/editor3d.spec.js` - the older view's failures said on
  the page.
