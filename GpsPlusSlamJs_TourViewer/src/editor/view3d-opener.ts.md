# view3d-opener.ts

## Purpose

The desktop editor's 3D view opener. The 3D view is the editor: the page
opens it when a tour opens (and again from the cannot-open page's Try
again), and closes it when the tour goes or another opens. The tour, its
edits and the selection are the store's, so the view owns none of them.

## Public API

- `VIEW3D_LOADING` - the status line's words while the view loads,
  "Loading 3D view…".
- `view3dFailureText(reason)` - what the page says for a `View3dFailure`
  (`chunk`, `webgl`, `context-lost`, `error`), in plain words, shown by
  `view3d-failed-page.ts` on a page of its own; only `chunk` says to
  reload the page (trying again in place gets the browser's kept import
  failure back).
- `createView3dOpener({ status, store, open, onShown? })` -> `View3dOpener`:
  - `status` - a `View3dStatus` (`textContent`, `hidden`), the bottom
    bar's load line: it says "Loading 3D view…" while the view loads and
    is hidden otherwise;
  - `store` - reads `editorView`, dispatches the view actions
    (`editor-view.ts`);
  - `open(events)` - starts the 3D view and resolves with a
    `View3dHandle` (`dispose()`) once its first frame is drawn; reports a
    lost context through `events.contextLost()` and an error that stopped
    its drawing through `events.failed()` (`View3dEvents`), while it loads
    or once shown. The page's `open` does the dynamic import, so this
    module never imports the 3D view;
  - `onShown(on)` - the view shown (`true`) or left (`false`), called last,
    with the store already in the state it announces (the page shows and
    hides the view box and its shell there).
- `View3dOpener`:
  - `open()` - open the 3D view; nothing while it loads or shows;
  - `close()` - leave the 3D view or its load (a tour closed, another
    opening).

## Invariants & assumptions

- **Async UI feedback (CLAUDE.md):** while the view loads the status line
  says "Loading 3D view…"; it is hidden once the view shows or the load
  fails, and a failure brings up the cannot-open page (the store's
  `view3dLoad: "failed"`).
- **A failure's reason** is the error's `reason` when it is one of the
  four (`chunk` is the page's tag for an import that did not arrive);
  anything else - an error without a reason, an unknown one - is `error`,
  whose text does not ask for a reload.
- **A view that stops** (`contextLost`, `failed`) while it loads ends the
  load as failed with its reason (`view3dFailed`), and the view that may
  still arrive for it is disposed; once shown, it leaves the view the same
  way. A view already left is ignored, so a doubled event ends it once.
- **Late answers are dropped:** each open has an attempt number; a view
  that arrives after the creator left the load (`close`) is disposed at
  once and never shown.
- **One view at most:** an open while loading or shown does nothing; the
  opener holds one handle and disposes it on every way out.

## Examples

```ts
const opener = createView3dOpener({
  status: document.querySelector("#view-loading")!,
  store,
  open: async (events) => {
    const { openGlobeEditor } = await import("../editor3d/editor3d-globe.js");
    return openGlobeEditor({ ...deps, events }, knobs);
  },
  onShown: (on) => {
    view3dBox.hidden = !on;
  },
});
opener.open();
```

## Tests

`view3d-opener.test.ts`: the load said, then the view, then closed; each
failure (a chunk, no WebGL, a lost context, an unknown reason) ending the
load as failed with its reason; a lost context ending a shown view once
and opening again; a context lost while loading ending the load as
failed, its late view disposed; a shown view's error ending it; a late
view dropped and disposed; a shown view closed once; `onShown` called
with the store already in its state on every way out; no second open
while loading or shown; the failure words. The page's use:
`playwright-tests/editor3d.spec.js` (a tour opening in 3D, the load
line, the failures) and `playwright-tests/editor3d-globe-default.spec.js`
(the cannot-open page).
