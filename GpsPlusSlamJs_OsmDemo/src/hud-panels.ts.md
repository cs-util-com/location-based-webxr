# `hud-panels.ts`

## Purpose

The command bar's panels: the settings drawer, the status panel and the quick
sun slider share one place on screen, so at most one of them is open. A second
export, `attachBusyMark`, keeps the bar's settings button showing work that a
control inside the closed drawer is still doing.

## Public API

- `attachHudPanels({ panels, onChange? }): HudPanels`
  - `panels`: a record of `{ element, opener }` by name. `element.hidden` is
    the open state; `opener` is the bar button, given `aria-controls` and
    `aria-expanded`.
  - `onChange(open)`: called after every change with the open panel's name,
    or `undefined`.
  - `HudPanels`: `hide(name)` (closes the named panel if it is the open
    one; the drawer's own close button), `dispose()`. Panels open and close
    from their openers and Escape; the page reads the open one through
    `onChange` or the DOM.
  - Throws on an empty panel set and on an unknown panel name.
- `attachBusyMark({ root, mark }): () => void`
  - Sets `mark.dataset.busy` to `"true"` while `root` holds a `.layer-busy`
    element or a `[role="status"]` line with text, `"false"` otherwise; the
    returned function stops watching.

## Invariants & assumptions

- **Open/closed is view state only.** Nothing is stored, every load starts
  with all panels closed (so a phone starts folded), and no control's value
  passes through here: the store keeps values, the drawer only holds controls.
- **One Escape closes one layer.** The listener is on `window`, which sees a
  key after every `document` listener, and it skips an event whose
  `defaultPrevented` is set. The light dialog stacks over the drawer and
  answers its own Escape on `document` with `preventDefault`, so the first
  Escape closes the dialog and the second the drawer.
- **Opening moves focus into the panel.** The panel element itself gets
  `tabIndex = -1` and focus (`preventScroll`), because the panels come after
  the map and the scene in the page: without it Tab would walk every map
  control before reaching the panel a keyboard user just opened.
- **Focus returns to the opener** when it was inside the closing panel (or
  nowhere); focus that moved elsewhere on the page is left alone.
- **Errors never open a panel.** Every reporter toasts (`toast.ts`); nothing
  here reacts to errors, which is what lets the status live behind a button.
- **The busy mark reads the controls' own cues** rather than a second busy
  channel, so a new async control in the drawer is covered as long as it uses
  either cue. It observes `class` attributes, child lists and text.
- Placement, stacking and sizes are CSS in `index.html` (`.hud-panel`,
  `.hud-slot`, `.hud-pop`), which jsdom does not apply; the layout e2e holds
  them.

## Examples

```ts
const hud = attachHudPanels({
  panels: {
    settings: { element: el("settings-drawer"), opener: el("settings-open") },
    info: { element: el("info-panel"), opener: el("info-open") },
  },
});
attachBusyMark({ root: el("settings-drawer"), mark: el("settings-open") });
hud.hide("settings");
```

## Tests

- `hud-panels.test.ts` (jsdom): starting closed, one open at a time, the
  opener toggling, focus moved into the opened panel, `hide` with its
  `onChange` and on a closed panel, Escape with focus return, focus left elsewhere, a stacked
  layer's handled Escape left alone, other keys, bad names, dispose, a
  property over random action sequences (at most one visible, matching
  the last `onChange` and every `aria-expanded`), and the busy mark on and off for both
  cues plus dispose.
- The e2e suite drives the panels through `playwright-tests/fixtures.js`
  (`setting()` opens the drawer and the section, acts, closes) and holds the
  layout in `hud-layout.spec.js`.
