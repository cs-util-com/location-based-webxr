# `src/pick-gesture.ts`

## Purpose

Decides whether a pointer release is a pick at all, before `pick.ts` is asked
what was picked. Two questions with one answer: was the pointer still, and was it
the primary button (DEC-R13-8).

## Public API

- `PICK_MOVE_TOLERANCE_PX = 4` — how far the pointer may travel between press
  and release and still pick, as a Manhattan sum in CSS pixels.
- `PointerOrigin` — `{ x, y }`, where a `pointerdown` happened.
- `PickPointer` — `{ button, clientX, clientY }`. Deliberately not
  `PointerEvent`: these three fields are the whole of what the decision reads,
  and a test must be able to construct one without a DOM.
- `isPickGesture(down, up) → boolean` — never throws.

## Invariants & assumptions

- **The secondary button never picks** (R13-7, DEC-R13-8). Before this module,
  `building-view.ts` picked on `pointerup` without reading `event.button`, so a
  right-click ordered the NPC _and_ opened the browser's context menu. The
  channel is now reserved and empty — right-click does nothing app-specific, and
  the browser menu still appears, which is the accepted cost DEC-R13-8 states.
- **A touch tap needs no exemption.** Pointer Events specifies `button: 0` for a
  touch contact on `pointerdown` and `pointerup` alike, so the primary-button
  test admits touch and pen taps unchanged.
  - The alternative shape — `button === 0 || pointerType !== "mouse"` — is
    **wrong, not merely redundant**: a pen barrel-button press reports
    `button: 2` with `pointerType: "pen"` and would sail through as an order.
- **`button` is external data.** Anything that is not exactly `0` refuses,
  including the `-1` "no button changed" sentinel, so an unexpected value falls
  on the safe side rather than being read as primary.
- **No recorded press refuses rather than guesses.** `down === undefined` means a
  pointer entered the canvas already pressed, or the view re-armed between the
  events. Measuring against a guessed origin would make a drag starting
  off-canvas read as a tap.
- **The button is checked independently of `down`**, so the two guards cannot be
  reordered into one that lets a right-click through when no press was recorded.
- **The tolerance is a Manhattan sum, not a Euclidean distance** — unchanged from
  the value the view carried inline since W12, and the two axes share the budget
  rather than each getting it. It is a wobble budget, not a drag threshold:
  MapControls has already consumed anything that was really a pan.
- **The caller clears its origin whatever the answer.** `building-view.ts` sets
  `downAt = undefined` before consulting this module, so a refused right-click
  cannot leave a stale press for the next release to measure against.

## Examples

```ts
let downAt: PointerOrigin | undefined;
container.addEventListener("pointerdown", (event) => {
  downAt = { x: event.clientX, y: event.clientY };
});
container.addEventListener("pointerup", (event) => {
  const from = downAt;
  downAt = undefined;
  if (!isPickGesture(from, event)) return;
  onPick(resolvePick(/* … */));
});
```

## Tests

`pick-gesture.test.ts`: a still primary click; the secondary button refused (the
finding this module exists for); a touch tap accepted through the same
primary-button test; the middle/back buttons and the `-1` sentinel refused; a
drag past the tolerance refused and a wobble at exactly the tolerance accepted;
both axes summed against one budget; a release with no recorded press refused,
including when it is also a secondary release.

`playwright-tests/scene-3d.spec.js` › the right-click case is the end-to-end
half: a right-click on open ground does not move the agent, while a left-click
does.
