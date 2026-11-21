# editor/view3d-failed-page.ts

## Purpose

The page the desktop editor shows where its 3D view cannot open: no
WebGL, its code not loaded, its graphics lost, or an error that stopped
it. The 3D view is the editor and nothing stands in for it, so this says plainly what happened and keeps the tour's File actions
within reach, so no work is stranded.

## Public API

- `VIEW3D_FAILED_PAGE.title` - "The 3D view cannot open" (the heading in
  `edit.html`).
- `failedPageReason(view)` - the `View3dFailure` the page shows for the
  store's `editorView` (`view3dShown`, `view3dLoad`, `view3dFailure`),
  or `null`: only while the load has `failed` with a reason.
- `wireView3dFailedPage({ dom, store, actions, toasts })` ->
  `{ dispose() }`:
  - `dom` - `View3dFailedPageDom` (structural): the root (`hidden`,
    `style.setProperty`), the
    heading (`focus()`), the reason line (`textContent`) and the five
    buttons: `retry` (its label written too), `open`, `save`,
    `saveCopy`, `details`.
  - `store` - `getState().editorView` and `subscribe`.
  - `actions` - one per button (the page passes the opener's `open`,
    File's Open… with its unsaved-work guard, Save, Save a copy…, Tour
    details…), plus `reload`: for `chunk` (code that did not load) the
    first button reads "Reload the page" and runs it, since the browser
    keeps a failed import's answer for the page's life and trying again in
    place cannot succeed. The page's `reload` asks first when work is
    unsaved, then holds back the browser's own leave prompt.
  - `toasts` - `ToastStack`: the toasts' stack's `height()` and a
    `watch(changed)` returning a stop (the page passes a `ResizeObserver` on
    `#toasts`). Its height is written on the root as `--toasts-h` (whole
    px, 0 for an empty stack or a height that is not a positive number),
    at once and on every change.
  - `VIEW3D_FAILED_PAGE` - its title and the first button's two labels.
  - `dispose()` stops following the store and the toasts.

## Invariants & assumptions

- Driven by the store alone: shown while a load has failed, hidden again
  by a retry (`loading`), a shown view, or a tour closed or opened
  (`view3dClosed`).
- The words are `view3dFailureText` (`view3d-opener.ts`); none speaks of
  a map.
- The heading takes the focus once, when the page shows, so a screen
  reader reads it.
- Nothing behind it needs taking out of the Tab order: the 3D view box,
  the debug panel inside it, is hidden while the view does not show.
- In `edit.html` the page sits under the top bar (whose File and View
  menus stay usable) and under the
  dialogs and the toasts (`#view3d-failed` in `editor.css`). Its bottom
  padding is `max(72px, --toasts-h + 26px)` (64 px on a short screen), so
  the card stays clear of a stack of toasts however tall, and does not
  jump for a single line.

## Examples

```ts
wireView3dFailedPage({
  dom,
  store,
  toasts: { height: () => stack.offsetHeight, watch: observeSize(stack) },
  actions: { retry: () => opener.open(), open, save, saveCopy, details },
});
```

## Tests

- `view3d-failed-page.test.ts` - when it shows (each failure, not
  idle, loading or shown), its reason, the heading's focus, shown at once
  for a load already failed, each button's action, the toasts' height kept on the page and
  followed, dispose; no failure's words speak of the map.
- `playwright-tests/editor3d-globe-default.spec.js` - with WebGL refused
  and with the view's code aborted: the page at 390x844, 844x390 and
  1440x900, every button in the window and on top (bare, and under two
  toasts, a line and a save error), Save a copy… downloading the
  tour, Try again, Tour details… and Open another tour…; after lost
  graphics, only the page and the top bar in the Tab order; for code that did not load, "Reload the page" asking once over
  unsaved work.
- `playwright-tests/editor3d.spec.js` - the 3D view's failures said on
  the page.
