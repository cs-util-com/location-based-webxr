# `toast-core.ts`

## Purpose

A transient, screen-reader-announced message in any container. **The one toast
mechanism in this workspace.** It began in `GpsPlusSlamJs_OsmDemo` and moved
here on 2026-08-24, when a review found four separate toasts across the repo
agreeing on nothing: one with no ARIA at all, one writing its text
synchronously, two toggling a class instead of attaching and detaching.

Callers keep their own PLACEMENT and LIFETIME; this owns the element, the ARIA
contract, the timer and the replace-and-restart semantics.

Import it deep: `gps-plus-slam-app-framework/utils/toast-core`. It is
deliberately NOT re-exported from the `/utils` barrel — that barrel feeds
`src/index.ts`'s `export *`, so re-exporting would put a UI primitive on the
package's root export surface, which is the maximal form of the cost DEC-H2
accepted reluctantly.

## Public API

- `createToast(root, options?) → Toast`
  - `root` — the element the toast is attached to while visible.
  - `options.className` — default `"toast"`. AR passes `"ar-toast"`.
  - `options.lingerMs` — default `DEFAULT_TOAST_LINGER_MS` (6 s). AR passes 8 s.
  - `options.id` — optional `id` on the element, for CSS or a test hook.
- `Toast.show(message, showOptions?)` — replaces any standing message and
  restarts the timer.
  - `showOptions.className` / `showOptions.lingerMs` override this toast's
    defaults **for one message only**. They exist so a caller with severities
    (the recorder's warning/error styling and its longer error linger) does not
    have to keep a second `Toast` per severity. The class is applied BEFORE the
    element is attached, so it never appears wearing the previous severity.
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
const toast = createToast(document.querySelector('#toast-root')!);
toast.show('No quest nearby — searched 7 tiles');
```

## Tests

- `toast-core.test.ts` — the empty-then-filled sequence (the only way to pin the
  deferral; a test checking only the final text passes for the silent version
  too), linger, replacement, same-task supersession, withdrawal beating a queued
  write, idempotent clear, single-element reuse, the custom class/linger, the
  per-message overrides and their reset on the next message, and the optional
  `id`.
  - The first eight of those moved here from `GpsPlusSlamJs_OsmDemo` **without a
    single edit**, which is the evidence that the move was a move and not a
    rewrite.
- `GpsPlusSlamJs_OsmDemo/src/ar-toast.test.ts` — unchanged, and still green
  against this implementation.

## Related

- `GpsPlusSlamJs_OsmDemo/src/ar-toast.ts` — the immersive-AR placement, a thin
  wrapper over this with an 8 s linger.
- `GpsPlusSlamJs_RecorderApp/src/ui/toast.ts` — the document-level singleton
  with severity styling, built on this.
- `GpsPlusSlamJs_Landing/src/egg-toast.ts` — a fourth toast that stays separate:
  that package deliberately does not depend on this one.
