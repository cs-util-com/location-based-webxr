# gps-extent-tracker.ts

## Purpose

One-line: the GPS EXTENT of a session so far - the largest horizontal
distance between two of its device fixes - kept up to date incrementally as
the store's GPS list grows.

An alignment's yaw is unobservable until its fixes span a baseline, and the
fix COUNT does not say whether they do (a phone standing still for a minute
has sixty fixes). The extent does. The QR mint reads it as the maturity floor
of the alignment a code is composed through (`../ar/qr/qr-mint-alignment-tracker.ts`,
40 m, the shared `alignment-maturity.ts`) and as the uncertain-heading marker
of a minted level (`../ar/qr/qr-mint-level.ts`). The GPS anchor's
`'mature-alignment'` start-up and the Tour Viewer's authoring settle read it
for the same floor (D33).

## Public API

- `createGpsExtentTracker(): GpsExtentTracker`
- `tracker.update(points): number` - the extent (m) of `points`, folding only
  the fixes added since the last call.
  - `points` are store `GpsPoint`s, or anything with `id`, `timestamp`,
    `coordinates` (NUE metres, x north, y up, z east) and an optional
    `source`.
- `GpsExtentPoint` - that input shape.

## Invariants & assumptions

- **Horizontal only.** Height is no baseline for yaw.
- **Device fixes only.** A synthetic QR vote (`source: 'synthetic-qr'`) is a
  re-projection of an older code's anchor, not a walk; an unrecognised stamp
  is never rounded to device (`gpsPointSourceOf`). The same rule as the
  session metadata's coverage index.
- **Noise included.** At 5 m GPS accuracy a phone standing still spans 3-5 m;
  the measurements that set the floors bin by this same number
  (`qr-anchor-mint.start-at-code.test.ts` pins that the tracker and the
  fixture's own extent agree to 1 cm).
- **A new list starts over.** The store's list is append-only within one
  store; a list shorter than the last one, or whose first fix has another
  `id` or `timestamp`, is a new list (a Start Recording store swap, a
  tracking restart) and is folded from scratch.
- **Defensive:** a fix with a non-finite north or east coordinate is skipped,
  so one bad point cannot turn the extent into NaN for the rest of the
  session; a fix without `coordinates` at all is skipped too, never thrown
  on (the Tour Viewer folds the extent inside a store listener).
- **Cost:** O(n) per new fix (it is compared with every earlier device fix),
  so O(n^2) over a session: about 26 million distance computations over a
  two-hour recording at 1 Hz, spread over those two hours.

## Examples

```ts
const extent = createGpsExtentTracker();
// on every read of the alignment:
const gpsExtentM = extent.update(selectGpsPositions(store.getState()));
```

## Tests

- `gps-extent-tracker.test.ts` - horizontal distance with height ignored,
  device-only, incremental folding, starting over on a shrunk or replaced
  list, a non-finite coordinate skipped, a fix without coordinates skipped.
- `gps-extent-tracker.property.test.ts` - equals the brute-force extent after
  every growing prefix of random lists with synthetic points mixed in.
