# `ar-toast.ts`

## Purpose

A message the user can see while immersed. The only one.

## Why the app's existing error channel does not work here

The r509 review found the far-travel warning failing twice over, independently:

- **It was outside the DOM overlay.** `initAR` passes its container to WebXR as
  `domOverlay.root`, and the browser composites **only that subtree** over the
  camera feed. The demo's status line lives in the header, outside `#ar-root`,
  so a message written there is invisible for exactly as long as it is relevant.
- **It was erased before it could be painted.** `nonFatalError` sets
  `loading.phase = "error"`, and the warning was emitted in the same synchronous
  block that started the refetch — whose `fetchStarted` immediately replaces the
  phase with `"fetching"`. Both dispatches run their subscribers synchronously,
  so no frame is rendered in between.

It would also have read as "Failed: You are 2.1 km from…", because the error
channel was the only one available.

**The unit test at the time asserted that `warn` had been called, which it had.**
That is the shape to remember: a mock records the call, and the call reaching a
channel nobody can see is invisible to it.

## Public API

- `AR_TOAST_LINGER_MS` — 8000.
- `createArToast(root): ArToast` — `root` must be the SAME element passed to
  `initAR`.
- `ArToast` — `{ show(message), clear() }`. `show` replaces any current message
  and restarts the timer; `clear` is idempotent.

## Invariants & assumptions

- **Attached on `show`, removed on `clear` — never resident.** `#ar-root` is
  `position: fixed; inset: 0` and hidden only while `:empty`, so an element
  living there permanently would keep a full-viewport, click-eating layer over
  the whole page for the entire time AR is NOT running. That exact regression is
  recorded in `ar-mode.ts`, which is why the rule is stated rather than assumed.
- **`pointer-events: none`.** Same reason from the other direction: the toast
  must never eat a tap.
- **`append`, not `insertBefore`.** `initAR` puts its canvas at the front of the
  container; the toast has to paint over it.
- **`role="status"` / `aria-live="polite"`.** A drift warning is information,
  not an interruption — `assertive` would cut across whatever a screen reader is
  saying.
- **The timer restarts per message.** The warning repeats as the user walks;
  without this a second message would inherit the remainder of the first's timer
  and could vanish almost immediately.
- **It has its own visible edge and shadow**, because the backdrop is a camera
  feed of unknown brightness and a panel with no border dissolves into a
  light-coloured scene.

## Examples

```ts
const arToast = createArToast(el("ar-root"));
arToast.show("You are 2.4 km from where this AR session was anchored…");
// …on session end
arToast.clear();
```

## Tests

`ar-toast.test.ts` — the message lands inside the root, the root stays EMPTY
until there is something to say, the ARIA attributes, the auto-clear leaving the
root empty again, the timer restarting on a second message, `clear()`, and
`clear()` with nothing showing.
