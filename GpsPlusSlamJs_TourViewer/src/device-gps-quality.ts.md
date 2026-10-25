# device-gps-quality.ts

## Purpose

The GPS quality of a stored GPS history, counted from the phone's own fixes
only: how many device fixes it holds and their median reported accuracy. A
scanned code's votes share the store's GPS history (sixteen synthetic points
per voted lock, each claiming the votes' fixed accuracy), so a count or a
median over every stored point would read a code seen indoors as a
well-aligned GPS session.

The one definition the Tour Viewer reads its GPS quality by:

- the visitor's GPS line and the "Continue with GPS only" escape
  (`ar-entry.ts` `sessionGpsQuality`, `viewer-placement.ts`
  `entryHasDeviceFix`);
- the creator's placement gate, its status line and the quality a newly
  measured code is stamped with (`creator-setup.ts` `authorAlignmentInfo`,
  read by `mintQrLevel`).

## Public API

- `deviceGpsQuality(positions: readonly GpsPoint[]): DeviceGpsQuality`
  - `fixes`: the number of device points (`gpsPointSourceOf(p) ===
GPS_POINT_SOURCE_DEVICE`; a point without a source stamp is the
    phone's, by the library's rule).
  - `accuracyM`: the median `latLongAccuracy` of the device points that
    state a usable one, or `null` when none does. The median is the upper
    middle element (`sorted[length >> 1]`), the value the visitor's line has
    always shown.
- `interface DeviceGpsQuality { fixes; accuracyM }`.

## Invariants & assumptions

- Pure: no store access, no clock; the caller passes the history it means
  (a creator passes the slice since its AR session started).
- Defensive about external data: a missing, non-finite, zero or negative
  accuracy states nothing about the fix's error and is left out of the
  median, while the fix still counts.
- Synthetic points of any source (a code's votes today) never change either
  number, wherever they sit in the history.

## Examples

```ts
const quality = deviceGpsQuality(selectGpsPositions(store.getState()));
if (quality.fixes === 0) {
  // indoors: only a code's votes, or nothing
}
```

## Tests

- `device-gps-quality.test.ts`: the count and the median, votes left out,
  unstamped points counted, unusable accuracies left out of the median.
- `device-gps-quality.property.test.ts`: whatever votes are mixed in, the
  result equals that of the device fixes alone.
- Composed: `creator-code-votes.test.ts` (a vote-only visit mints nothing
  and its quality counts no votes) and `ar-entry.test.ts` (the visitor's
  GPS line).
