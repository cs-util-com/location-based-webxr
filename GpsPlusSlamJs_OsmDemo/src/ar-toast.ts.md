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
- **Attached in one task, populated in the NEXT.** A live region is announced
  when its content changes while it is in the accessibility tree; one inserted
  already carrying its text is commonly not announced at all.
  - **The obvious fix does not work and was shipped once.** Reordering the two
    statements — attach, then set text — reads correctly and is unobservable:
    browsers flush accessibility updates once at the end of the task rather than
    per DOM operation, so the AT still sees a region that appeared populated.
    **The separation has to be a task, not a statement.**
  - **`setTimeout`, not `requestAnimationFrame`**, though rAF is the tighter fit
    for "after a rendering step": rAF is throttled or paused in a background tab
    and `main.ts` can warn with no XR session running, so the frame-based
    version can silently never deliver.
  - **Withdrawal and supersession are handled by CANCELLING the pending timer**,
    in `clear()` and at the top of `show()`, so a withdrawn or superseded write
    never runs.
    - This line used to describe an `element.isConnected` check and a sequence
      number inside the callback as the mechanism. **Neither could ever fire** —
      the cancellation above them made the callback unreachable — so the sidecar
      was asserting something the code did not do, which is the same shape as
      the defect the deferral itself fixes. The guards are gone and this says
      what actually holds (r513 review).
  - **`clear()` empties the element as well as detaching it.** The element is
    reused across messages, so one still carrying the previous text would arrive
    populated on the next `show` and undo the whole deferral.
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

Plus the announcement block (r511, corrected in r513): the region **attaches
empty and stays empty for the rest of the task**, the text arrives in a later
task, a `clear()` in the gap does not resurrect it, the later of two messages in
one task wins, and a re-`show` after `clear` attaches empty rather than carrying
the old text.

**The test this replaced patched `root.append` to observe the text at attach
time** — a state no accessibility layer ever reaches, so it passed against code
that announced nothing. Same shape as the `warn` mock above, arriving from the
other direction: assert what the AT can observe, not what the code did.

## Generalised into `toast.ts` (round two, N3)

The mechanism no longer lives here. `createArToast` is now a thin wrapper over
`createToast` with `className: "ar-toast"` and an 8 s linger; the announcement
contract, the deferred text write and the cancellation rule are documented in
[`toast.ts.md`](./toast.ts.md).

**Why generalised rather than copied.** Round two needed a second toast for the
2D page, so that errors have a channel visible while the header is collapsed
(DEC-U10). The behaviour here took three review rounds to get right and none of
it is visible in the finished code — a hand-written second copy would have
reproduced the bugs rather than the fixes.

**What stays this file's business** is the argument above for why AR needs a
channel of its own at all: the header status line is outside `domOverlay.root`
and therefore not composited during an immersive session, and it is overwritten
within the same synchronous block that writes it. Both remain true.

The AR linger stays LONGER than the 2D default: a message in AR competes with
the camera feed and with the physical world for attention, and there is no
scrollback to recover it from.

`ar-toast.test.ts` is unchanged and still passes, which is the evidence that
the extraction preserved the behaviour.
