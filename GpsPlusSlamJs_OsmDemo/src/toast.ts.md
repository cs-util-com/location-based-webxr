# `toast.ts`

## Purpose

A transient, screen-reader-announced message in any container. Used twice: the
2D surface in the page (round two, N3) and the AR overlay's
(`ar-toast.ts`, which is now a thin wrapper).

## Public API

- `createToast(root, options?) → Toast`
  - `root` — the element the toast is attached to while visible.
  - `options.className` — default `"toast"`. AR passes `"ar-toast"`.
  - `options.lingerMs` — default `DEFAULT_TOAST_LINGER_MS` (6 s). AR passes 8 s.
- `Toast.show(message)` — replaces any standing message and restarts the timer.
- `Toast.clear()` — takes the message down now and cancels the timer. Idempotent,
  including before anything has been shown.
- `DEFAULT_TOAST_LINGER_MS`.

## Invariants & assumptions

Two of these are the whole reason this is a shared module rather than a snippet.
Both cost multiple review rounds in `ar-toast.ts`, and neither is visible in the
finished code — a second hand-written copy would have reproduced the bugs, not
the fixes.

- **The element is attached EMPTY and its text written in a LATER TASK.** A live
  region is announced when its content changes while it is in the accessibility
  tree; one inserted already carrying its text is commonly not announced at all.
  - Reordering the two statements within one task reads correctly and changes
    nothing: browsers do not rebuild the accessibility tree per DOM operation,
    they flush queued updates once at the end of the task. The separation has to
    be a **task boundary**.
  - `setTimeout`, not `requestAnimationFrame`. rAF is the tighter fit for "after
    a rendering step" but is throttled or paused in a background tab, and
    messages can be emitted with no rendering guaranteed — the frame-based
    version can silently never deliver.
- **Supersession and withdrawal are handled by CANCELLING the pending write,
  never by guarding inside it.** A guard on `isConnected` or a sequence number
  can never fire, because both `clear()` and a second `show()` cancel first.
  Such guards were deleted from `ar-toast.ts` rather than kept as belt and
  braces, because the sidecar had begun describing them as the mechanism — a
  description asserting something the code does not do, which is the same defect
  a live-region bug is, one level up.
- **One element is reused, attached on `show` and removed on `clear`.** For the
  AR root this is mandatory: `#ar-root` is `position: fixed; inset: 0` and hidden
  only while `:empty`, so a permanent child would keep a full-viewport,
  click-eating layer over the page whenever AR is not running. For the 2D root
  it is merely tidy; one rule for both is worth more than the saved DOM call.
- **`role="status"` / `aria-live="polite"`, never `alert`.** These are
  information, not interruptions, and an assertive region cuts across whatever a
  screen reader is currently saying.
- **`append`, not `insertBefore`** — in the AR root the XR canvas sits at the
  front of the container and the toast must paint over it.

## Example

```ts
const toast = createToast(document.querySelector("#toast-root")!);
toast.show("No quest nearby — searched 7 tiles");
```

## Tests

- `toast.test.ts` — the empty-then-filled sequence (the only way to pin the
  deferral; a test checking only the final text passes for the silent version
  too), linger, replacement, same-task supersession, withdrawal beating a queued
  write, idempotent clear, single-element reuse, and the custom class/linger.
- `ar-toast.test.ts` — unchanged, and still green against this implementation,
  which is the evidence that the generalisation was faithful.
