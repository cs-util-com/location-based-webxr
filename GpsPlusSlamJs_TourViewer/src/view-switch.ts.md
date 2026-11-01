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

- `viewSwitchModel(blocks, stored, verdictOf?)` - pure: the model for a station's
  free blocks (`kind`, `placement`, `current` label, `chosen`,
  `preferred` (the stored choice or null), `rows` with `view`, `label`,
  `line`, `tag`, `disabled`, `on`), or null when no block is in a set.
  The FIRST block in a set describes the switch. `verdictOf(block)`
  gives a text's read-along verdict: the captions row is offered while a
  timing holds and greyed "needs a timing" otherwise, and the reading
  row's line becomes "The whole text in a sheet, the voice highlighted"
  for a text whose timing holds.
- `switchBlocks({ stations, presentId, contentPlaced })` - pure: the
  present station's free blocks once its content is set, else none (no
  station, an unknown id, content not set yet). `main.ts` passes
  `ctx.stationContent?.showsAny()` as `contentPlaced`, which is true from
  the moment the station's content is set, while a part may still be
  loading; so the switch never shows before the content is set, but may
  show before every part stands.
- `createViewSwitch({ host, read, choose, say })` - mounts the switch in
  `host`, hidden until `sync()` finds a model.
  - `read()` gives the present station's free blocks (none outside a
    station), the stored value and, optionally, `verdictOf`.
  - `choose(kind, placement, view | null)` stores the choice and returns
    whether the device keeps it.
  - `say(text)` tells the visitor: "Lectern from now on, for every long
    text on this phone.", "Lectern for this visit (this browser does not
    keep the choice).", "Back to the creator's choice: Reading.", or, when
    the clear was not kept, "Back to the creator's choice for this visit:
    Reading (this browser does not keep the choice)."
  - Returns `{ sync, close, dispose }`; `sync()` redraws only when the
    model changed, so the page calls it every frame (its model asks
    `bodyHasPictures`, which parses each body once); `close()` closes
    the menu (`main.ts` calls it in `hooks.stopStations`, at the end of an
    AR session and on a tour switch).

## Invariants & assumptions

- A choice applies to every block of that kind at that placement, each
  through `shownView`; when a station holds several long texts the first
  describes the switch, and a member greyed for it may still show another.
- A greyed member is a disabled button: it cannot be chosen.
- Picking the stored choice again only closes the menu: nothing is
  stored, said or drawn again (a rebuild would reset the station's
  parts).
- The menu closes on a choice, on Escape, on a tap outside it and on
  `close()`. It is a disclosure, not an ARIA menu (no arrow-key
  navigation is offered, so no menu roles promise it): the pill carries
  `aria-expanded` and `aria-controls` (the box's own id), each row is a
  plain button with `aria-pressed` for the view shown, and the footer's
  sentence and reset are plain content. After a pick, and on Escape, the
  focus goes back to the pill (the redraw removes the focused row).
- Placement (`view-switch.css`): fixed, 8 px right of the round Exit AR
  button, its centre on the button's centre (top 34 px; 14 px on a phone
  held sideways, as the button moves up), inside the safe area; z-index
  25, above the radar (20), below the toast and the Exit button (30).
  Shown only in a visitor's AR session.
- Its taps are the overlay's own: `cancelsXrSelect` exempts the whole
  `.view-switch` root from the AR select, so a tap on the menu's text or
  padding (not only its buttons) never reaches the world behind it.
- While the menu is open the switch cancels every `beforexrselect` on the
  document (capture), so the tap outside that closes it never reaches the
  world either. That tap's own select is also cancelled when the browser
  asks after its pointerdown (which closed the menu): the closing
  pointerdown marks its pointer; the mark holds while the finger is down
  and 250 ms after its pointerup or pointercancel (`CLOSING_TAP_GRACE_MS`:
  XR input arrives about once a camera frame, so the select may come
  after pointerup; 100 ms leaves three frames, 400 ms comes near a quick
  second tap), and goes with the first select it cancels. Each finger has
  its own mark, so another finger lifting does not clear it. Handled: a
  select before the closing pointerdown (the menu is still open; one up
  to 250 ms before it, `SELECT_BEFORE_TAP_MS`, is taken for that tap's
  own, so the pointerdown arms no mark; the same value as the grace, a
  constant of its own because it answers another question), while
  the finger is down, and up to 250 ms after it lifts. Not handled: a
  select later than that (it reaches the world), and which finger a
  select belongs to (a select carries no pointer, so it takes the oldest
  mark in force). A tap whose select comes BEFORE its pointerdown has it
  cancelled while the menu is still open; the pointerdown that follows
  within 250 ms of such a select arms no mark, which would otherwise
  outlive the tap and eat the next one. Residual: a tap on the open menu
  (a greyed row) and a tap outside within 250 ms of it, the outside
  tap's select coming after its pointerdown, lets that select through.
  The 250 ms is PROVISIONAL (100, 250 and 400 ms weighed); a phone
  delivering the closing select later, or that residual seen in use,
  would reopen it. `close()` drops every mark.
- A re-pick (the stored choice picked again) is compared with the page's
  store, not with a fresh read of the device: if another tab changed the
  device's value since the page started, the re-pick does not write the
  choice back. Accepted: it needs several tabs open at once, and the next
  real choice merges into a fresh read anyway (`storeVisitorChoice`).

## Examples

```ts
const sw = createViewSwitch({ host: arRoot, read, choose, say });
sw.sync(); // every frame
```

## Tests

- `view-switch.test.ts` (jsdom) - the model; hidden without a block in a
  set; a choice stored, the menu closed and the label and toast right; a
  refused write said as "for this visit", a refused clear too; a greyed
  member refused; the disclosure's attributes and the focus back on the
  pill; the stored choice picked again does nothing; the closing tap's
  select cancelled, and only that tap's, whichever of its select and
  pointerdown comes first and for a next tap 10-240 ms later; `close()`; `switchBlocks` waits
  for the placed content. Each test disposes its switch (an old one would
  go on listening on the document).
- `playwright-tests/view-switch.spec.js` - the choice across two tours,
  a throwing storage, and the layout at 390x844, 844x390 and 1440x900.
  The e2e loads the page per tour: a visitor's page has no in-page way to
  open another tour (the open form is a creator's). The in-page half is
  `viewer-placement-story-blocks.test.ts` "keeps the choice for the next
  tour opened in the same page".
