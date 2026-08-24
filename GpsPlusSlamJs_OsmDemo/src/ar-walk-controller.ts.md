# `ar-walk-controller.ts`

## Purpose

Holds the state the walk gate needs, for the lifetime of one AR session, and
fires the refetch when the gate opens.

## Why a module rather than two `let`s in `main.ts`

The decision is pure ([`ar-walking.ts`](ar-walking.ts.md)), but it needs three
pieces of state that have to agree: where the data in the scene was fetched for,
whether a pass is running, and where the session was anchored.

**State in `main.ts` is state no test can reach.** Milestone 1 of this plan
shipped three modules that were each correct in isolation with nothing asserting
they were connected, and four green gates passed all three.

## Public API

- `startArWalk({ origin, dataAt, refetch, warn }): ArWalk`
  - `origin` — the framework's `zero`, for the far-travel warning **only**.
  - `dataAt` — where the data currently in the scene was fetched for. **A
    separate parameter, and conflating it with `origin` was a real bug** (r509
    review): `zero` is the FIRST locate fix and immutable, while the scene's
    data was fetched for the store position, which a map click moves without
    touching `zero`. After "locate at A, click 2 km away, enter AR at A", every
    real fix was ~0 m from the seed — the gate never opened and AR showed the
    city from 2 km away, indefinitely and with no error.
  - `refetch(position)` — must drive BOTH `loadTerrain` and `refresh` from the
    position it is given, and must resolve when the whole pass is done. In
    `main.ts` it dispatches `positionChanged` and awaits `currentPass`.
  - `warn(message)` — must reach a surface visible **inside the AR overlay**;
    see [`ar-toast.ts`](ar-toast.ts.md) for why the app's status line is not
    one.
- `ArWalk` — `{ positionChanged(position), dispose() }`. `positionChanged` is
  synchronous and cheap; the work is fired, not awaited.

## Invariants & assumptions

- **The gate measures from the LAST REFETCH, not from `origin`.** That is the
  whole mechanism. Measuring from the session origin would refetch once at 100 m
  and then on _every_ subsequent fix, since each is also more than 100 m from
  the origin — the starvation case arriving by the opposite route.
- **ONE `refetch` for both calls, awaited together**, and that is a correctness
  requirement rather than tidiness. The worker joins terrain and mesh on **exact
  lat/lng equality**, so an ungated `loadTerrain` on a newer position than the
  gated `refresh` leaves `needsTerrainFor` permanently true and every build
  waits out the full 15 s terrain timeout (§2.6).
- **The gate reopens on `finally`, not `then`** — and the call is inside a
  `try`, because a `refetch` that throws SYNCHRONOUSLY would escape before that
  `finally` exists (r509 review). Either way a wedged gate means one failed
  fetch stops AR following the user for the rest of the session, with no error
  after the first.
- **The caller must settle on BOTH halves of the pass.** `main.ts` uses
  `Promise.allSettled`; `Promise.all` rejects on the first rejection, so a
  failing terrain load would settle the pass while the refresh was still running
  — reopening the gate so the next fix aborts the run that was about to publish,
  which is the one thing the gate exists to prevent.
- **The gate lives in `onLocated`, ABOVE the store dispatch** — not at the
  bottom of the position subscriber, where the first version put it (r509
  review). Gating only the fetch let every fix still pay for `mapView.centreOn`,
  a `history.replaceState`, a repaint of the desktop 2.8 km city on a second
  live GL context at 1 Hz, and — worst — a store position advancing past a
  position whose terrain was never loaded, which `demo-worker.ts` states as a
  safety invariant.
- **The reference advances even when the pass fails.** A judgement call, and it
  could reasonably go the other way. Holding it back would retry from the
  position the user has already left; the data they need is where they ARE.
- **The warning repeats on every qualifying refetch**, not once at the crossing.
  The number in the message is what the user's decision turns on and it is
  growing, so a single toast at 2 km is stale advice by 4 km. The cadence is
  bounded by the gate itself — at most one per 100 m of walking, roughly one per
  71 s.
- **`origin` is `zero`, not `anchors.origin`.** Different points. The warning is
  about drift from the GPS frame the alignment matrix is expressed against.
- **`dispose()` is required.** A fix arriving after teardown must not resample
  terrain against an AR datum the desktop view is no longer using — and
  `main.ts` calls it from the back-gesture path too, where nothing calls
  `ArMode.dispose()`.

## Examples

```ts
const walk = startArWalk({
  origin: { lat: zero.lat, lng: zero.lon },
  dataAt: selectOsmView(store.getState()).position,
  refetch: async (position) => {
    store.dispatch(actions.positionChanged(position));
    await currentPass; // what the subscriber just started
  },
  warn: (message) => arToast.show(message),
});
// …every fix, straight from `onLocated`, before anything else…
walk.positionChanged(position);
// …session ends, either way…
walk.dispose();
```

**AR entry runs one pass of its own**, outside the gate. The absolute datum is
baked into the building/tree/POI vertices by the worker's `update` handler; the
`terrain` handler only replaces the field. So a bare terrain reload moves the
ground plane — which AR does not draw — and leaves every building at the
window-centre datum. Without the entry pass the datum first applies after 100 m
of walking, and never for a user who stands still (r509 review).

## Tests

`ar-walk-controller.test.ts` — the threshold, ten small steps ignored, the
measure-from-last-refetch distinction, a second refetch after a further
threshold, the in-flight veto across three rapid crossings, the gate reopening
after a REJECTED pass and after a SYNCHRONOUS throw, the reference advancing
past a failure, gating from `dataAt` rather than `origin`, the warning firing
and staying quiet, the warning repeating with a growing number, and `dispose()`.

That `main.ts` actually calls any of it — including `frozen` on the anchor and
`stopWalking()` on the back gesture — is pinned by `ar-walk-wiring.test.ts`,
which is a source-text guard because `main.ts` cannot be unit-run and headless
Chromium cannot enter an XR session.
