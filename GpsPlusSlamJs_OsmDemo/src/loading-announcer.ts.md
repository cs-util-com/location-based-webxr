# `loading-announcer.ts`

## Purpose

Decides when the demo shows a "loading" toast, so that a long OSM fetch is
visible even when the header - and with it the status line - is collapsed away.

## Public API

- `createLoadingAnnouncer(options): LoadingAnnouncer`
  - `options.toast` - a `Toast`. **A separate instance from the error toast**;
    see the invariant below.
  - `options.delayMs` / `lingerMs` / `armTtlMs` - override the constants.
- `LoadingAnnouncer`
  - `arm()` - a user gesture happened.
  - `busyChanged(busy)` - wire to `latestOnly`'s `onBusyChange`.
  - `dataArrived()` - wire to the store's snapshot subscription, **guarded**
    (see the example): it means "the map now has something on it", and the
    subscription also fires when the snapshot is blanked.
  - There is deliberately **no `dispose()`**. One was written and removed in the
    same session: the demo creates the announcer once and never tears it down,
    so its only justification - an AR session boundary - was a scenario that
    does not occur, and its test proved an API nothing calls.
- Exported constants: `ANNOUNCE_DELAY_MS` (1 s), `LOADING_TOAST_LINGER_MS`
  (15 s), `LOADING_TOAST_MESSAGE`.
- Module-private: `DEFAULT_ARM_TTL_MS` (5 s) and `LOADING_TOAST_CLASS`. Not an
  oversight - knip fails the root dead-code check on an export nobody imports,
  so a constant is exported when it gains a consumer and not before.

## Invariants & assumptions

- **A toast appears only for a refresh the USER started.** The walking agent and
  a moving GPS fix re-enter the same refresh cycle every few steps; announcing
  those would leave a near-permanent toast on screen during exactly the activity
  the 3D view exists for. `refresh()` cannot tell who called it - every
  position-driven refresh arrives through one `positionChanged` subscriber - so
  intent is latched by `arm()` at the gesture and read here.
- **The latch is consumed once and expires.** Consumed by the countdown it
  starts, expired after `armTtlMs`. Without the expiry, a gesture that never
  produced a refresh would leave the latch set for some later automatic refresh
  to consume, popping a toast minutes later with nothing on screen to explain
  it.
- **The latch is read at BOTH edges of `busy`** - when it rises, and when a
  gesture arrives while it is already high. `latestOnly` reports no transition
  for a supersession, so a click landing twenty seconds into a fetch would
  otherwise get no feedback at all.
- **`busy` is the only honest "a refresh is running".** The store's
  `loading.phase` goes idle after the first of five rings (see
  `latest-only.ts.md`), so an indicator driven by it switches off in the middle
  of the wait.
- **Both hide paths are load-bearing, and neither is redundant.**
  `dataArrived()` is what makes the hide immediate - `busy` stays true through
  four more rings of widening, long after the map filled - and the falling edge
  of `busy` is the only signal a FAILED refresh produces, since it publishes no
  snapshot.
- **Every show is preceded by a clear.** `toast-core` reuses one element: on a
  replacement it neither re-appends it nor changes its class name, so the bar
  would keep draining on the FIRST show's schedule while the toast lived on the
  second's. Clearing detaches the element, and the next show re-attaches it.
  - **What is verified and what is not.** The call ORDER is unit-tested. That
    detaching and re-attaching restarts the CSS animation is how browsers
    behave in practice, but nothing here observes it: both calls happen in one
    task, with no forced reflow between them, and the reliable-by-spec form
    would be an explicit style flush this module cannot perform (it never
    touches the element). If it turns out not to restart, the consequence is a
    re-shown bar that drains early - cosmetic, and visible in the design
    system's catalog, which now carries the atom.
- **The loading toast is its own `Toast` instance.** The shared toast replaces
  rather than stacks, so sharing one with the error channel would let a loading
  announcement silently delete an error the user has not read.
  - **Consequence for tests, worth knowing before it bites:** `#toast-root` can
    now hold TWO `.toast` elements, so `#toast-root .toast` is no longer a
    strict-mode-safe locator. Several existing e2e use it unqualified; they pass
    today only because they gesture after a refresh has settled, where no
    loading toast can exist. A new test that expects one toast should target
    `#loading-toast` or use `.first()`.
- **No DOM, no injected clock.** The ambient `setTimeout` is used directly and
  the tests run on `vi.useFakeTimers()`, which is how `ar-toast.test.ts` already
  tests this project's other toast.

## Examples

```ts
const announcer = createLoadingAnnouncer({ toast: loadingToast });
const refresh = latestOnly(runRefresh, {
  onBusyChange: (busy) => announcer.busyChanged(busy),
});
mapView.map.on("click", () => announcer.arm());
subscribe(
  (view) => view.snapshot,
  // THE GUARD IS PART OF THE EXAMPLE. This subscription fires on any CHANGE,
  // and `placeChanged` / `fetchFailed` change the snapshot to `undefined`.
  // Unguarded, the site picker cancelled its own announcement: `arm()` starts
  // the countdown and the `placeChanged` dispatch on the next line reads as
  // data arriving. An earlier version of this example taught the wrong form.
  (snapshot) => {
    if (snapshot !== undefined) announcer.dataArrived();
  },
);
```

## Tests

`loading-announcer.test.ts`, on fake timers against a recording toast: the
happy path and its clear-then-show ordering, silence when the refresh beats the
delay, silence for an unarmed (automatic) refresh, the immediate hide on data
arrival, the hide on the busy edge for a failed refresh, no re-show across the
four later rings, announcing a gesture made while a refresh is already running,
one gesture never announcing two refreshes, latch expiry and its boundary, the
same behaviour at 400 / 1000 / 2000 ms, the bar restarting on a second gesture,
and `dispose()` dropping pending work.
