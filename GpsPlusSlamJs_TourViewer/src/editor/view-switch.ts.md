# view-switch.ts

## Purpose

The desktop editor's view switch: the one button that opens the 3D view
over the map and closes it again. One page, two views: the tour, its
edits and the selection are the store's, so switching keeps them all.

## Public API

- `VIEW_SWITCH_LABELS` - the button's words: `idle` "3D view",
  `loading` "Loading 3D view…", `shown` "Map view".
- `view3dFailureText(reason)` - what the page says for a `View3dFailure`
  (`chunk`, `webgl`, `context-lost`, `empty`), in plain words, each ending
  with the map showing the tour.
- `createViewSwitch({ button, store, open, say, onShown? })` -> `ViewSwitch`:
  - `button` - a `ViewSwitchButton` (the parts of a button it uses);
  - `store` - reads `editorView`, dispatches the view actions
    (`editor-view.ts`);
  - `open(events)` - starts the 3D view and resolves with a
    `View3dHandle` (`dispose()`) once its first frame is drawn; reports a
    later lost context through `events.contextLost()`. The page's `open`
    does the dynamic import, so this module never imports the 3D view;
  - `say(text)` - the page's toast;
  - `onShown(on)` - the view shown (`true`) or left (`false`), called last,
    with the store already in the mode it announces (the page hides and
    shows its map-only parts there, reading the store).
- `ViewSwitch`:
  - `close()` - leave the 3D view or its load (a tour closed, another
    opening);
  - `setEnabled(on)` - off while no tour is open.

## Invariants & assumptions

- **Async UI feedback (CLAUDE.md):** while the view loads the button says
  "Loading 3D view…", is disabled and carries `data-state="loading"`;
  shown it says "Map view" (`data-state="3d"`); a failure lands back on
  "3D view" (`data-state="2d"`) with the reason said once.
- **A failure's reason** is the error's `reason` when it is `webgl` or
  `empty`; anything else (a chunk that did not load, an unknown reason)
  is `chunk`. `context-lost` is never read from an error: only
  `events.contextLost` reports it.
- **Late answers are dropped:** each open has an attempt number; a view
  that arrives after the creator left the load (the button, `close`) is
  disposed at once and never shown. A lost context of a view no longer
  shown is ignored, so a doubled event says nothing twice.
- **One view at most:** a click while loading does nothing; the switch
  holds one handle and disposes it on every way back.

## Examples

```ts
const viewSwitch = createViewSwitch({
  button: document.querySelector("#view-switch")!,
  store,
  open: async (events) => {
    const { openEditor3d } = await import("../editor3d/editor3d-scene.js");
    return openEditor3d({ ...deps, events });
  },
  say: (text) => toast(text),
  onShown: (on) => {
    view3dBox.hidden = !on;
  },
});
```

## Tests

`view-switch.test.ts`: the loading state, then the view, then the map
again; each failure (a chunk, no WebGL, nothing placed, an unknown
reason) landing on the map with its text said; a lost context falling
back once and opening again; a late view dropped and disposed; a shown
view closed with the tour; `onShown` called with the store already in
its mode on every way back; no second open while loading; the switch off
without a tour. The page's use: `playwright-tests/editor3d.spec.js`.
