# view-switch.ts

## Purpose

The visitor's view switch in AR (station blocks design §4; the look of the
prototype `public/prototypes/station-blocks-1-narrated-text/`, its
`#vswitch`). Inside a station, on a block whose creator's view is in an
interchangeable set, a pill names the view shown; its menu lists the
set's members with a line each, marks the creator's choice and the view
shown, greys a member that cannot show the block whole with its reason,
and offers "Use the creator's choice again" while a choice is stored.

## Public API

- `viewSwitchModel(blocks, stored)` - pure: the model for a station's
  free blocks (`kind`, `placement`, `current` label, `chosen`, `rows`
  with `view`, `label`, `line`, `tag`, `disabled`, `on`), or null when no
  block is in a set. The FIRST block in a set describes the switch.
- `createViewSwitch({ host, read, choose, say })` - mounts the switch in
  `host`, hidden until `sync()` finds a model.
  - `read()` gives the present station's free blocks (none outside a
    station) and the stored value.
  - `choose(kind, placement, view | null)` stores the choice and returns
    whether the device keeps it.
  - `say(text)` tells the visitor: "Lectern from now on, for every long
    text on this phone.", "Lectern for this visit (this browser does not
    keep the choice).", or "Back to the creator's choice: Reading."
  - Returns `{ sync, dispose }`; `sync()` redraws only when the model
    changed, so the page calls it every frame.

## Invariants & assumptions

- A choice applies to every block of that kind at that placement, each
  through `shownView`; when a station holds several long texts the first
  describes the switch, and a member greyed for it may still show another.
- A greyed member is a disabled button: it cannot be chosen.
- The menu closes on a choice, on Escape and on a tap outside it; the button carries
  `aria-haspopup` / `aria-expanded`, the menu `role="menu"`, each member
  `role="menuitemradio"` with `aria-checked`.
- Placement (`view-switch.css`): fixed, 8 px right of the round Exit AR
  button, its centre on the button's centre (top 34 px; 14 px on a phone
  held sideways, as the button moves up), inside the safe area; z-index
  25, above the radar (20), below the toast and the Exit button (30).
  Shown only in a visitor's AR session.
- Its taps are the overlay's own: buttons, which `cancelsXrSelect`
  already exempts from the AR select.

## Examples

```ts
const sw = createViewSwitch({ host: arRoot, read, choose, say });
sw.sync(); // every frame
```

## Tests

- `view-switch.test.ts` (jsdom) - the model; hidden without a block in a
  set; a choice stored, the menu closed and the label and toast right; a
  refused write said as "for this visit"; a greyed member refused.
- `playwright-tests/view-switch.spec.js` - the choice across two tours,
  a throwing storage, and the layout at 390x844, 844x390 and 1440x900.
