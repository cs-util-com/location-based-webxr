# `loading-announcer.ts`

## Purpose

Decides WHEN the demo shows its loading surface, so that a long OSM fetch is
visible even when the header - and with it the status line - is collapsed away.
It owns the timing only; `loading-overlay.ts` owns what the user sees.

## Public API

- `createLoadingAnnouncer(options): LoadingAnnouncer`
  - `options.toast` - a `LoadingSurface` (`show`/`clear`). In the demo this is
    `loading-overlay.ts`, deliberately NOT the framework's `Toast`: a toast owns
    its own lifetime, and the whole point here is that the surface leaves when
    the DATA says so.
  - `options.delayMs` / `armTtlMs` - override the constants.
- `LoadingAnnouncer`
  - `arm()` - a user gesture happened.
  - `busyChanged(busy)` - wire to `latestOnly`'s `onBusyChange`.
  - `dataArrived()` - wire to the store's snapshot subscription, **guarded**
    (see the example): it means "the content is on screen", and the subscription
    also fires when the snapshot is blanked.
  - There is deliberately **no `dispose()`**. One was written and removed in the
    same session: the demo creates the announcer once and never tears it down,
    so its only justification - an AR session boundary - was a scenario that
    does not occur, and its test proved an API nothing calls.
- Exported: `ANNOUNCE_DELAY_MS` (1 s), `LOADING_MESSAGE`, and the
  `LoadingSurface` type. The bar's duration lives in `loading-overlay.ts`, since
  it is a property of the surface rather than of this decision.
- Module-private: `DEFAULT_ARM_TTL_MS` (5 s). Not an oversight - knip fails the
  root dead-code check on an export nobody imports, so a constant is exported
  when it gains a consumer and not before.

## Invariants & assumptions

- **The surface appears only for a refresh the USER started.** The walking agent
  and a moving GPS fix re-enter the same refresh cycle every few steps;
  announcing those would leave something on screen during exactly the activity
  the 3D view exists for. `refresh()` cannot tell who called it - every
  position-driven refresh arrives through one `positionChanged` subscriber - so
  intent is latched by `arm()` at the gesture and read here.
- **The latch is consumed once and expires.** Consumed by the countdown it
  starts, expired after `armTtlMs`. Without the expiry, a gesture that never
  produced a refresh would leave the latch set for some later automatic refresh
  to consume, announcing minutes later with nothing on screen to explain it.
- **The latch is read at BOTH edges of `busy`** - when it rises, and when a
  gesture arrives while it is already high. `latestOnly` reports no transition
  for a supersession, so a click landing twenty seconds into a fetch would
  otherwise get no feedback at all.
- **`busy` is the only honest "a refresh is running".** The store's
  `loading.phase` goes idle after the first of five rings (see
  `latest-only.ts.md`), so an indicator driven by it switches off in the middle
  of the wait.
- **Both hide paths are load-bearing, and neither is redundant.**
  `dataArrived()` is what makes the hide happen when the models are actually
  drawn - the call site sits after `drawScene` in the snapshot subscriber, and
  `busy` stays true through four more rings of widening. The falling edge of
  `busy` is the only signal a FAILED refresh produces, since it publishes no
  snapshot.
- **Every show is preceded by a clear.** The surface restarts its bar on a fresh
  attach, so showing over an already-visible overlay would continue the previous
  wait's drain instead of starting this one's. The call ORDER is unit-tested
  here; that a detach/attach restarts a CSS animation is the surface's business
  and is documented there.
- **No DOM, no injected clock.** The ambient `setTimeout` is used directly and
  the tests run on `vi.useFakeTimers()`.

## Examples

```ts
const overlay = createLoadingOverlay(el("scene"));
const announcer = createLoadingAnnouncer({ toast: overlay });
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

`loading-announcer.test.ts`, on fake timers against a recording surface: the
happy path and its clear-then-show ordering, silence when the refresh beats the
delay, silence for an unarmed (automatic) refresh, the immediate hide on data
arrival, the hide on the busy edge for a failed refresh, no re-show across the
four later rings, announcing a gesture made while a refresh is already running,
one gesture never announcing two refreshes, latch expiry swept over three TTLs,
a second gesture's latch not leaking to an automatic refresh, and the same
behaviour at 400 / 1000 / 2000 ms.
