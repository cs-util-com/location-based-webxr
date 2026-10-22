# view-switch.ts

## Purpose

The desktop editor's view switch: the one button that opens the 3D view
over the map and closes it again. One page, two views: the tour, its
edits and the selection are the store's, so switching keeps them all.

## Public API

- `VIEW_SWITCH_LABELS` - the button's words: `idle` "3D view",
  `loading` "Loading 3D view…", `shown` "Map view".
- `VIEW_SWITCH_SHORT_LABELS` - a word per state for a phone-wide window
  (`idle` "3D", `loading` "…", `shown` "Map"), written to the button's
  `data-short`; `editor.css` shows it below 720 px in place of the label,
  so the top bar keeps every control inside the window. The full label
  stays the button's text, and its name for a screen reader.
- `view3dFailureText(reason)` - what the page says for a `View3dFailure`
  (`chunk`, `webgl`, `context-lost`, `empty`, `error`), in plain words,
  each ending with the map showing the tour; only `chunk` speaks of the
  connection.
- `createViewSwitch({ button, store, open, say, onShown? })` -> `ViewSwitch`:
  - `button` - a `ViewSwitchButton` (the parts of a button it uses);
  - `store` - reads `editorView`, dispatches the view actions
    (`editor-view.ts`);
  - `open(events)` - starts the 3D view and resolves with a
    `View3dHandle` (`dispose()`) once its first frame is drawn; reports a
    lost context through `events.contextLost()` and an error that stopped
    its drawing through `events.failed()` (`View3dEvents`), while it loads
    or once shown. The page's `open`
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
- **A failure's reason** is the error's `reason` when it is one of the
  five (`chunk` is the page's tag for an import that did not arrive);
  anything else - an error without a reason, an unknown one - is `error`,
  whose text does not blame the connection.
- **A view that stops** (`contextLost`, `failed`) while it loads ends the
  load on the map with its reason said, and the view that may still
  arrive for it is disposed; once shown, it leaves the view the same way.
  A view already left says nothing.
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
back once and opening again; a context lost while loading landing on
the map, said, its late view disposed; a shown view's error falling
back, said; a late view dropped and disposed; a shown
view closed with the tour; `onShown` called with the store already in
its mode on every way back; the short word for each state; no second
open while loading; the switch off without a tour. The page's use:
`playwright-tests/editor3d.spec.js`; the top bar at 390 px:
`playwright-tests/editor.spec.js` (every control inside the window).
