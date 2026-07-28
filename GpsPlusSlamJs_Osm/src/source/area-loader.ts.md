# `source/area-loader.ts`

## Purpose

The one code path that loads fetch tiles, shared by the explicit prefetch API
and the movement trigger.

## Public API

- `ensureAreaLoaded(source, center: LatLng, radiusMetres, options?)` — the
  "download this area for offline use" entry point. Rate limits **throw**.
- `ensureWorkingSetLoaded(source, position: LatLng, options?)` — the movement
  trigger. Rate limits are **deferred**, not thrown.
- `loadTiles(source, tiles, options?)` — the shared primitive.
- `tilesWithin(center, radiusMetres)` — fetch tiles covering a radius.
- `chunkFor(position)` — the res-11 chunk a position scores in.

`EnsureAreaOptions`: `signal`, `onProgress`, `maxAgeMs`, `onRateLimit`.

`AreaLoadResult`: `{ loaded, deferred, failed }`.

## Invariants & assumptions

- **`maxAgeMs` only has an effect against a source that implements `ensureTile`.**
  `fetchOne` duck-checks for it and routes through it when present; a plain
  `OsmDataSource` has no notion of staleness, so the option is a silent no-op
  there. That is deliberate — it is how the staleness policy reaches
  `CachingSource` without `OsmDataSource` having to declare a capability only one
  implementation has — but it IS a conditional option, and a caller passing it to
  a bare source gets neither an error nor an effect.

- **One mechanism, two policies.** The prefetch and the movement trigger differ
  only in what a rate limit means, so that is a flag rather than a fork. They
  are the two callers most likely to want the same tile at the same instant, and
  two implementations would each need their own de-dup, rate-limit handling and
  abort plumbing — one of which would get it wrong.
- **`LatLng`, never `GpsCoord`.** The framework type would invert the dependency
  §4.2 forbids. They are structurally identical, so a bridge passes one through.
- **Deferred tiles are RETURNED by name.** A caller that cannot see what is
  missing cannot distinguish "nothing is mapped here" from "not fetched yet" —
  the ambiguity this package works to avoid. `deferred` is what to retry once
  `budget.msUntilAvailable()` has elapsed.
- **One bad tile never fails the area.** A relation that cannot be closed, or
  one instance having a bad day, costs that tile and nothing else. The
  alternative is that one unusual element blanks a 5 km² working set.
- **Aborts propagate; they are never recorded as per-tile failures.** An abort
  filed as a failure would look like a data problem and let the loop continue.
  The signal is checked before each tile **and after the last one**, so whether
  an aborted load rejects does not depend on how many tiles it happened to have.
- **Sequential, deliberately.** `OverpassSource` already bounds concurrency and
  de-duplicates in flight. Racing here would add nothing and would make the
  rate-limit path harder to reason about — the first refusal is a signal that
  the rest will be refused too, and a sequential loop can act on it.
- **Progress counts deferred and failed tiles too**, so a rate-limited download
  does not stall its own progress bar at 20 % and look hung.
- `tilesWithin` is deliberately generous (rings until the ring's inner edge
  passes the radius): over-fetching is the stated preference, and a prefetch one
  tile short at the edge is discovered by a user standing in a field with no
  signal.

## Examples

```ts
// Movement trigger: never stalls, reports what it could not get.
const { loaded, deferred } = await ensureWorkingSetLoaded(source, position);
if (deferred.length > 0) scheduleRetry(source.budget.msUntilAvailable());

// Explicit download: surfaces a rate limit so the UI can say so.
await ensureAreaLoaded(source, centre, 5_000, {
  signal,
  onProgress: ({ done, total }) => setLabel(`Downloading ${done}/${total}…`),
});
```

## Tests

`area-loader.test.ts` — both callers over one mechanism; the rate-limit
divergence (defer vs throw) including the partial case; deferred tiles returned
by name; per-tile failures isolated with their cause kept; aborts mid-loop, on
the last tile, and pre-aborted; monotonic progress ending at total even when
every tile was refused; and `tilesWithin` growth, centre inclusion and rejection
of a negative or non-finite radius.
