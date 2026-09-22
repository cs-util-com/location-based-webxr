# `loading-overlay.ts`

## Purpose

The surface that says "we are loading", centred on the 3D scene and visible
until something tells it the content has arrived.

## Public API

- `createLoadingOverlay(host, options?) → LoadingOverlay`
  - `host` must be a **positioned** element; the demo passes `#scene`, which is
    already `position: relative`.
  - `options.barMs` overrides `BAR_DURATION_MS` (the tests use it to stay fast).
- `LoadingOverlay` — `show(message)`, `clear()`, `dispose()`.
- `BAR_DURATION_MS` (15 s) — how long the bar takes to drain.

## Invariants & assumptions

- **It never takes itself down.** There is no linger and no dismissal timer.
  This is the difference that made it a module rather than a second
  `createToast` call: a median cold tile takes roughly twice the bar's 15 s, so
  a self-dismissing surface leaves exactly when the wait is at its worst. Owner
  verdict, 2026-09-22, after seeing the toast version.
- **It mounts inside the view it describes**, not in a page corner. The first
  version sat in `#toast-root` at the bottom left; the owner's correction was
  that it belongs over the 3D scene.
- **The bar claims "about this long", not "this long".** It drains once over
  `BAR_DURATION_MS`. If the load outlives it, `data-overrun="true"` switches the
  fill to a sweep — the change of behaviour IS the message ("slower than
  usual"). A restarting drain was rejected: it would silently promise another
  fifteen seconds that nothing can keep.
  - The switch is a `setTimeout` in this module rather than a chained CSS
    `animation-delay`. Two animations on one property, one of them delayed, is a
    subtlety nobody re-reads correctly; a timer is trivially testable on a fake
    clock.
  - `BAR_DURATION_MS` and the CSS `--t-loading-bar` must agree, and
    `loading-bar-duration.test.ts` is what holds them together.
- **A re-show starts over.** The element is detached and re-attached, which
  restarts the bar's animation and clears a stale `data-overrun`. Without it a
  second gesture would inherit the previous wait's drained bar.
- **`pointer-events: none`.** It covers the 3D view, and clicking that view is
  how a user retries a slow load.
- **Shape-compatible with the framework's `Toast`** (`show` / `clear`) on
  purpose, so `loading-announcer.ts` — which owns the WHEN and is tested to the
  corner on a fake clock — did not change when the surface moved.
- **The look lives in `design.css`**, per DEC-L2-14: `.loading-overlay`,
  `.loading-overlay-bar`, `.loading-overlay-fill` and their reduced-motion
  entry. This module owns structure and behaviour only.

## Examples

```ts
const overlay = createLoadingOverlay(el("scene"));
const announcer = createLoadingAnnouncer({ toast: overlay });
// the announcer decides when; the overlay only does as it is told
```

## Tests

`loading-overlay.test.ts` (jsdom, fake timers): it mounts inside the host, never
dismisses itself across an hour, marks itself overrunning once the bar has
drained, resets both bar and overrun on a re-show, stays gone after `clear()`
including when a pending overrun timer fires, and does not eat clicks.
