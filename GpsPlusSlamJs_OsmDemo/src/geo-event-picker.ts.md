# `geo-event-picker.ts`

## Purpose

The dialog a SECOND press of the geo-event button opens: pick a day and a time,
search again, or take the current event off the map.

## Public API

- `new GeoEventPicker({ container, onSearch, onClear })` — builds its own
  contents into an empty `<aside>`.
  - `onSearch(requested: number)` — a chosen LOCAL instant, epoch ms.
  - `onClear()` — take the event down.
- `open(at: Date)` — show, with both boxes pre-filled from `at`.
- `close()`, `toggle(at: Date)`, `get isOpen(): boolean`.

### Error modes

Unparseable boxes do **not** search. The dialog stays open and shows "Pick a
date and a time first."; the message clears once a valid search goes through.

## Invariants & assumptions

- **The first press does not open it (G1).** "Find me an event now" stays one
  tap; the dialog answers the second press, which is when "when?" becomes a
  sensible question. Before this, a second press re-ran the identical search —
  exactly identical, since the event is a pure function of tile and quarter-hour
  — so within one slot it could not produce anything new. It read as a broken
  button.
- **Never falls back to `now`.** That is the tempting implementation and the
  worst outcome: a real event, at a time nobody asked for, under a dialog still
  showing the time they did ask for.
- **It also clears, and that is a user feature first.** The #271 e2e review
  recorded the marker as the one thing `resetUi` could not reset, "because no
  control and no store action removes it". W2 supplied the action; this is the
  control. A user who has found an event and wants the map back had no other way
  either.
- **Not a `<dialog>`.** `showModal()` traps focus and dims the page, which is
  right for a decision that blocks and wrong for this: the map underneath is
  what you consult while choosing a time. Follows `#hotkey-help` and `#details`,
  which are `hidden`-toggled `<aside>`s for the same reason.
- **The time box steps by 15 minutes**, matching the event grid. Every instant
  inside a quarter resolves to the same slot, so a finer step offers digits that
  silently do nothing.
- **Contents are built here, not in `index.html`.** The two inputs, the two
  buttons and the error line are one interaction; splitting them between markup
  and wiring is how a control ends up with no listener. Same division
  `attachLayerToggles` and `LegendView` use.

## Examples

```ts
const picker = new GeoEventPicker({
  container: el("geo-event-picker"),
  onSearch: (requested) => void findGeoEvent(requested),
  onClear: () => store.dispatch(actions.geoEventFound(undefined)),
});
// Second press, with an event already held:
picker.toggle(new Date(heldEvent.eventTime));
```

## Tests

`geo-event-picker.test.ts` — starts hidden, opens pre-filled, the 15-minute
step, a search reporting the instant from the boxes and closing, the refusal
(plus its message) when a box cannot be read, the message clearing on the next
valid search, clear-and-close, and the toggle.

`event-instant.test.ts` owns the date arithmetic underneath it, including the
local-versus-UTC parsing trap and the roll-over rejection.
